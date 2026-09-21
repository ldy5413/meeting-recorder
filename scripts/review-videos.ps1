param([switch]$Browser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$reviewData = Join-Path $projectRoot '.local/video-validation'
if (-not (Test-Path -LiteralPath (Join-Path $reviewData 'library/library.sqlite'))) {
  throw 'Run the video validation scripts first to create the review library.'
}
$env:MEETING_DATA_DIR = $reviewData
if ($Browser) { $env:MEETING_DEV_BROWSER = '1' }
Set-Location -LiteralPath $projectRoot
npm run dev
