$ErrorActionPreference = 'Stop'
& node "$PSScriptRoot/runtime.mjs" status
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
