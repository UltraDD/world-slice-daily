param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskNode = if ($env:WORLD_SLICE_NODE) { $env:WORLD_SLICE_NODE } else { (Get-Command node.exe).Source }
if ([version]((& $taskNode --version).TrimStart('v')) -lt [version]'24.22.1') {
    $taskNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $taskNode)) { throw 'Node.js 24.22.1 or newer is required; set WORLD_SLICE_NODE.' }
$taskPgBin = if ($env:WORLD_SLICE_PG_BIN) { $env:WORLD_SLICE_PG_BIN } else { Join-Path (Split-Path $taskRoot -Parent) 'ppt-beautify\local\sub2api\postgresql\pgsql\bin' }
$taskData = Join-Path $taskRoot '.data'
$taskLogs = Join-Path $taskData 'logs'
New-Item -ItemType Directory -Path $taskLogs -Force | Out-Null
if (-not (Test-Path -LiteralPath '.env')) { throw 'Missing .env. Follow README.md to configure this local installation.' }

function Assert-OurListener([int]$Port, [string]$Expected) {
    $taskListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $taskListener) { return $false }
    $taskOwner = Get-CimInstance Win32_Process -Filter "ProcessId=$($taskListener.OwningProcess)"
    $taskCommand = $taskOwner.CommandLine.Replace('\','/')
    $taskExpected = $Expected.Replace('\','/')
    if ($taskCommand -notlike "*$taskExpected*") { throw "Port $Port belongs to another application." }
    return $true
}

$taskPgData = Join-Path $taskData 'postgres'
if (-not (Assert-OurListener 55433 $taskPgData)) {
    & (Join-Path $taskPgBin 'pg_ctl.exe') -D $taskPgData -l (Join-Path $taskLogs 'postgres.log') -o '-h 127.0.0.1 -p 55433' start
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the daily database.' }
}
& $taskNode --env-file=.env scripts/migrate.ts
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }

if (-not $SkipBuild -or -not (Test-Path -LiteralPath 'apps/web/build/server/index.js')) {
    $taskNpm = Join-Path (Split-Path (Get-Command npm.cmd).Source -Parent) 'node_modules\npm\bin\npm-cli.js'
    $env:PATH = (Split-Path $taskNode -Parent) + ';' + $env:PATH
    & $taskNode $taskNpm run build -w '@aihot/web'
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
}

$taskGatewayEnv = if ($env:WORLD_SLICE_GATEWAY_ENV) { $env:WORLD_SLICE_GATEWAY_ENV } else { Join-Path (Split-Path $taskRoot -Parent) 'ppt-beautify\local\sub2api\client-env-glm.ps1' }
if (-not $env:LLM_API_KEY) {
    if (-not (Test-Path -LiteralPath $taskGatewayEnv)) { throw 'Set LLM_API_KEY or WORLD_SLICE_GATEWAY_ENV to the local encrypted credential loader.' }
    . $taskGatewayEnv
    $env:LLM_API_KEY = $env:OPENAI_API_KEY
}

$taskServices = @()
foreach ($taskService in @(@{Name='api'; Port=13001; File='apps/api/src/main.ts'}, @{Name='worker'; Port=0; File='apps/worker/src/main.ts'})) {
    $taskFile = Join-Path $taskRoot $taskService.File
    if ($taskService.Port -and (Assert-OurListener $taskService.Port $taskFile)) {
        $taskExisting = Get-NetTCPConnection -LocalPort $taskService.Port -State Listen | Select-Object -First 1
        $taskServices += [pscustomobject]@{ Name=$taskService.Name; Pid=$taskExisting.OwningProcess }
        continue
    }
    $taskStateFile = Join-Path $taskData 'services.json'
    if ($taskService.Name -eq 'worker' -and (Test-Path -LiteralPath $taskStateFile)) {
        $taskOld = Get-Content -LiteralPath $taskStateFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $taskPreviousWorker = $taskOld | Where-Object Name -EQ 'worker' | Select-Object -First 1
        if ($taskPreviousWorker) {
            $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($taskPreviousWorker.Pid)" -ErrorAction SilentlyContinue
            if ($taskProcess -and $taskProcess.CommandLine -like "*$taskFile*") { $taskServices += $taskPreviousWorker; continue }
        }
    }
    $taskProcess = Start-Process -FilePath $taskNode -ArgumentList @("--env-file=`"$taskRoot\.env`"", "`"$taskFile`"") -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLogs ($taskService.Name+'.out.log')) -RedirectStandardError (Join-Path $taskLogs ($taskService.Name+'.err.log'))
    $taskServices += [pscustomobject]@{ Name=$taskService.Name; Pid=$taskProcess.Id }
}

# The web process receives no backend key, database connection string, or encrypted credential.
$taskSensitive = @{}
foreach ($taskEnvName in @([Environment]::GetEnvironmentVariables('Process').Keys | Where-Object { $_ -match '(_KEY|_SECRET|_TOKEN|_PASSWORD|DATABASE_URL)$' })) {
    $taskSensitive[$taskEnvName] = [Environment]::GetEnvironmentVariable($taskEnvName, 'Process')
    [Environment]::SetEnvironmentVariable($taskEnvName, $null, 'Process')
}
try {
    $env:WEB_PORT='13000'; $env:WEB_HOST='127.0.0.1'; $env:API_BASE_URL='http://127.0.0.1:13001'; $env:SITE_URL='http://127.0.0.1:13000'; $env:NODE_ENV='production'
    $taskWeb = Join-Path $taskRoot 'apps/web/server.ts'
    if (-not (Assert-OurListener 13000 $taskWeb)) {
        $taskProcess = Start-Process -FilePath $taskNode -ArgumentList @("`"$taskWeb`"") -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLogs 'web.out.log') -RedirectStandardError (Join-Path $taskLogs 'web.err.log')
        $taskServices += [pscustomobject]@{ Name='web'; Pid=$taskProcess.Id }
    } else {
        $taskExisting = Get-NetTCPConnection -LocalPort 13000 -State Listen | Select-Object -First 1
        $taskServices += [pscustomobject]@{ Name='web'; Pid=$taskExisting.OwningProcess }
    }
} finally {
    foreach ($taskEnvName in $taskSensitive.Keys) { [Environment]::SetEnvironmentVariable($taskEnvName, $taskSensitive[$taskEnvName], 'Process') }
}
$taskServices | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $taskData 'services.json') -Encoding UTF8
$taskDeadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $taskDeadline) {
    try { $taskHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:13000/api/health' -TimeoutSec 2; if ($taskHealth.ok) { Write-Host 'World Slice Daily: http://127.0.0.1:13000'; return } } catch { Start-Sleep -Milliseconds 500 }
}
throw 'The site did not become ready. Check .data/logs.'
