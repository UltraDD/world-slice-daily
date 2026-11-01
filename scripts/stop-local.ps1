$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskState = Join-Path $taskRoot '.data/services.json'
if (Test-Path -LiteralPath $taskState) {
    $taskServices = Get-Content -LiteralPath $taskState -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($taskService in $taskServices) {
        $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($taskService.Pid)" -ErrorAction SilentlyContinue
        if ($taskProcess -and $taskProcess.CommandLine -like "*$taskRoot*") { Stop-Process -Id $taskService.Pid }
    }
    Remove-Item -LiteralPath $taskState
}
$taskPgBin = if ($env:WORLD_SLICE_PG_BIN) { $env:WORLD_SLICE_PG_BIN } else { Join-Path (Split-Path $taskRoot -Parent) 'ppt-beautify\local\sub2api\postgresql\pgsql\bin' }
& (Join-Path $taskPgBin 'pg_ctl.exe') -D (Join-Path $taskRoot '.data/postgres') stop -m fast
Write-Host 'World Slice Daily stopped.'
