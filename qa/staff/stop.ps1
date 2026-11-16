$ErrorActionPreference = 'Stop'
& node "$PSScriptRoot/runtime.mjs" stop
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
