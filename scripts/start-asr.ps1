param(
  [int]$Port = 8765,
  [int]$ChunkSeconds = 300,
  [ValidateSet('none','4bit')][string]$Quantization = '4bit'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$env:VIBEVOICE_MODEL = Join-Path $projectRoot '.local/models/VibeVoice-ASR'
$env:VIBEVOICE_REVISION = 'd0c9efdb8d614685062c04425d91e01b6f37d944'
$env:VIBEVOICE_DEVICE = 'cuda'
$env:VIBEVOICE_QUANTIZATION = $Quantization
$env:VIBEVOICE_ATTENTION = 'sdpa'
$env:VIBEVOICE_CHUNK_SECONDS = [string]$ChunkSeconds
$env:VIBEVOICE_ENCODER_SEGMENT_SECONDS = '20'
$env:VIBEVOICE_OFFLOAD_SPEECH = '1'
$env:VIBEVOICE_MAX_TOKENS = '8192'
$env:VIBEVOICE_GENERATION_SECONDS = '600'
$env:MEETING_ASR_DATA = Join-Path $projectRoot '.local/asr-data'
$env:HF_HOME = Join-Path $projectRoot '.local/hf-cache'
$env:HF_HUB_DISABLE_TELEMETRY = '1'
$env:PYTHONUNBUFFERED = '1'
$env:PYTHONIOENCODING = 'utf-8'
& (Join-Path $projectRoot '.venv/Scripts/python.exe') -m uvicorn service.app:app --host 127.0.0.1 --port $Port
