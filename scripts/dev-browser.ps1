param([string]$JulyAudio, [string]$AugustAudio)
$ErrorActionPreference = 'Stop'
$env:MEETING_DEV_BROWSER = '1'
if ($JulyAudio) { $env:MEETING_DEV_FIXTURE_JULY = (Resolve-Path -LiteralPath $JulyAudio).Path }
if ($AugustAudio) { $env:MEETING_DEV_FIXTURE_AUGUST = (Resolve-Path -LiteralPath $AugustAudio).Path }
if (-not $env:MEETING_DATA_DIR) {
  $env:MEETING_DATA_DIR = Join-Path $env:LOCALAPPDATA 'MeetingRecorder-dev-browser'
}
Set-Location (Split-Path $PSScriptRoot -Parent)
npm run dev
