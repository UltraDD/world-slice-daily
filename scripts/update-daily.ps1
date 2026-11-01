param([switch]$Force, [switch]$CollectOnly)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskNode = if ($env:WORLD_SLICE_NODE) { $env:WORLD_SLICE_NODE } else { (Get-Command node.exe).Source }
if ([version]((& $taskNode --version).TrimStart('v')) -lt [version]'24.22.1') { $taskNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not $CollectOnly -and -not $env:LLM_API_KEY) {
    $taskGatewayEnv = if ($env:WORLD_SLICE_GATEWAY_ENV) { $env:WORLD_SLICE_GATEWAY_ENV } else { Join-Path (Split-Path $taskRoot -Parent) 'ppt-beautify\local\sub2api\client-env-glm.ps1' }
    . $taskGatewayEnv
    $env:LLM_API_KEY = $env:OPENAI_API_KEY
}
$env:COLLECT_ENABLED='true'
if (-not $CollectOnly) { $env:MODEL_CALLS_ENABLED='true' }
$taskArgs = @('--env-file=.env', 'modules/creator-daily/scripts/run.ts')
if ($Force) { $taskArgs += '--force' }
if ($CollectOnly) { $taskArgs += '--collect-only' }
& $taskNode @taskArgs
exit $LASTEXITCODE
