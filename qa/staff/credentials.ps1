$ErrorActionPreference = 'Stop'
$qaCredentialsPath = Join-Path $PSScriptRoot '.private/credentials.json'
if (-not (Test-Path -LiteralPath $qaCredentialsPath)) { throw 'Chay start.ps1 truoc de tao credential QA rieng.' }
# This interactive viewer is only opened when the user invokes this script.
Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + $qaCredentialsPath + '"') -WindowStyle Normal
