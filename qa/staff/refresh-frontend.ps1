$ErrorActionPreference = 'Stop'
& node "$PSScriptRoot/runtime.mjs" refresh-frontend
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
