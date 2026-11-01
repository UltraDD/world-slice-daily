$ErrorActionPreference = 'Stop'
$taskCredential = Join-Path (Split-Path $PSScriptRoot -Parent) '.data/admin-password.credential.xml'
$taskSecret = Import-Clixml -LiteralPath $taskCredential
$taskPointer = [IntPtr]::Zero
try {
    $taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
    Set-Clipboard -Value ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer))
} finally { if ($taskPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer) } }
Write-Host 'Admin password copied.'
