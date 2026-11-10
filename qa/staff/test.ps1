param([switch]$SkipBrowser)
$ErrorActionPreference = 'Stop'
if ($SkipBrowser) { & node "$PSScriptRoot/runtime.mjs" test --skip-browser }
else { & node "$PSScriptRoot/runtime.mjs" test }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
