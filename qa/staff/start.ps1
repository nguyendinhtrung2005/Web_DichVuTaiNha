$ErrorActionPreference = 'Stop'
& node "$PSScriptRoot/runtime.mjs" start
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
