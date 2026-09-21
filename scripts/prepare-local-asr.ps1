$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$python = Join-Path $root '.local/local-asr-build/venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    py -3.12 -m venv (Join-Path $root '.local/local-asr-build/venv')
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 is required on the build machine.' }
}
& $python -m pip install -r service/requirements-local-build.txt
if ($LASTEXITCODE -ne 0) { throw 'Could not install the local ASR build dependencies.' }
& $python -u -X utf8 scripts/build-local-asr.py
if ($LASTEXITCODE -ne 0) { throw 'Could not build the bundled local ASR resources.' }
