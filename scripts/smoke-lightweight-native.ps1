param(
    [Parameter(Mandatory = $true)][string]$Audio,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$Models = '.local/lightweight-asr/models',
    [string]$Runtime = '.local/lightweight-asr/native/sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-no-tts/bin'
)
$ErrorActionPreference = 'Stop'
$audioPath = (Resolve-Path -LiteralPath $Audio).Path
$modelPath = (Resolve-Path -LiteralPath $Models).Path
$runtimePath = (Resolve-Path -LiteralPath $Runtime).Path
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Output directory must be new' }
$outputPath = (New-Item -ItemType Directory -Path $OutputDirectory).FullName
$priorPath = $env:Path
try {
    # Isolate dependency lookup from installed Python/CUDA/FFmpeg environments.
    # Input must already be mono 16 kHz PCM16 WAV.
    $env:Path = "$runtimePath;$env:SystemRoot\System32;$env:SystemRoot"
    $asrArgs = @(
        "--sense-voice-model=$modelPath/sensevoice.int8.onnx",
        "--tokens=$modelPath/tokens.txt",
        "--silero-vad-model=$modelPath/silero.onnx",
        '--sense-voice-use-itn=true', '--sense-voice-language=auto',
        '--provider=cpu', '--num-threads=4', $audioPath
    )
    $asr = Start-Process -FilePath "$runtimePath/sherpa-onnx-vad-with-offline-asr.exe" -ArgumentList ($asrArgs | ForEach-Object { '"' + $_ + '"' }) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput "$outputPath/asr.stdout.txt" -RedirectStandardError "$outputPath/asr.stderr.txt"
    if ($asr.ExitCode -ne 0) { throw "Native ASR failed: $($asr.ExitCode)" }
    $speakerArgs = @(
        "--segmentation.pyannote-model=$modelPath/segmentation.onnx",
        "--embedding.model=$modelPath/wespeaker.onnx",
        '--segmentation.provider=cpu', '--embedding.provider=cpu',
        '--segmentation.num-threads=4', '--embedding.num-threads=4',
        '--clustering.cluster-threshold=0.5', $audioPath
    )
    $speakers = Start-Process -FilePath "$runtimePath/sherpa-onnx-offline-speaker-diarization.exe" -ArgumentList ($speakerArgs | ForEach-Object { '"' + $_ + '"' }) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput "$outputPath/speakers.stdout.txt" -RedirectStandardError "$outputPath/speakers.stderr.txt"
    if ($speakers.ExitCode -ne 0) { throw "Native diarization failed: $($speakers.ExitCode)" }
    @{
        status = 'complete'
        asrExitCode = $asr.ExitCode
        diarizationExitCode = $speakers.ExitCode
        sourceSha256 = (Get-FileHash -LiteralPath $audioPath -Algorithm SHA256).Hash.ToLowerInvariant()
        pathContainsPythonOrCuda = $false
        limitation = 'Native CLI smoke on development machine; not a clean Windows installation test or Electron integration.'
    } | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath "$outputPath/report.json"
} finally {
    $env:Path = $priorPath
}
