param(
    [Parameter(Mandatory = $true)][string]$Audio,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$Candidates = '.local/lightweight-asr/candidates',
    [string]$Runtime = '.local/lightweight-asr/native/sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-no-tts/bin'
)
$ErrorActionPreference = 'Stop'
$audioPath = (Resolve-Path -LiteralPath $Audio).Path
$candidatePath = (Resolve-Path -LiteralPath $Candidates).Path
$runtimePath = (Resolve-Path -LiteralPath $Runtime).Path
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Output directory must be new' }
$outputPath = (New-Item -ItemType Directory -Path $OutputDirectory).FullName
$priorPath = $env:Path
$results = @()
try {
    $env:Path = "$runtimePath;$env:SystemRoot\System32;$env:SystemRoot"
    foreach ($engine in @('qwen3', 'funasr')) {
        $manifestPath = Join-Path $candidatePath "$engine-manifest.json"
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($entry in $manifest.files.PSObject.Properties) {
            if ($entry.Name -match '\.onnx$|/tokenizer/|/Qwen3-0.6B/') {
                $modelFile = [IO.Path]::GetFullPath((Join-Path $candidatePath $entry.Name))
                if (-not $modelFile.StartsWith($candidatePath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe model path' }
                if ((Get-FileHash -LiteralPath $modelFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value.sha256) { throw 'Model hash mismatch' }
            }
        }
        if ($engine -eq 'qwen3') {
            $model = Join-Path $candidatePath 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25'
            $modelArgs = @(
                "--qwen3-asr-conv-frontend=$model/conv_frontend.onnx",
                "--qwen3-asr-encoder=$model/encoder.int8.onnx",
                "--qwen3-asr-decoder=$model/decoder.int8.onnx",
                "--qwen3-asr-tokenizer=$model/tokenizer",
                '--qwen3-asr-max-total-len=1024',
                '--qwen3-asr-max-new-tokens=512'
            )
        } else {
            $model = Join-Path $candidatePath 'sherpa-onnx-funasr-nano-int8-2025-12-30'
            $modelArgs = @("--funasr-nano-encoder-adaptor=$model/encoder_adaptor.int8.onnx", "--funasr-nano-llm=$model/llm.int8.onnx", "--funasr-nano-embedding=$model/embedding.int8.onnx", "--funasr-nano-tokenizer=$model/Qwen3-0.6B", '--funasr-nano-itn=true', '--funasr-nano-max-new-tokens=512')
        }
        $arguments = $modelArgs + @('--provider=cpu', '--num-threads=4', $audioPath)
        $watch = [Diagnostics.Stopwatch]::StartNew()
        $process = Start-Process -FilePath "$runtimePath/sherpa-onnx-offline.exe" -ArgumentList ($arguments | ForEach-Object { '"' + $_ + '"' }) -WindowStyle Hidden -PassThru -RedirectStandardOutput "$outputPath/$engine.stdout.txt" -RedirectStandardError "$outputPath/$engine.stderr.txt"
        # Retain a process handle before polling; Windows PowerShell otherwise
        # loses ExitCode when the process is reaped between Refresh/WaitForExit.
        $null = $process.Handle
        $peak = 0L
        while (-not $process.WaitForExit(100)) {
            $process.Refresh()
            $peak = [Math]::Max($peak, $process.PeakWorkingSet64)
            if ($watch.Elapsed.TotalSeconds -gt 180) {
                $process.Kill()
                throw "Native $engine exceeded short-clip timeout"
            }
        }
        $process.WaitForExit()
        $watch.Stop()
        if ($process.ExitCode -ne 0) { throw "Native $engine failed: $($process.ExitCode)" }
        $results += @{ engine = $engine; exitCode = $process.ExitCode; elapsedSeconds = $watch.Elapsed.TotalSeconds; sampledPeakProcessBytes = $peak; manifestSha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() }
        Write-Output "Native $engine complete"
    }
    @{
        status = 'complete'
        results = $results
        sourceSha256 = (Get-FileHash -LiteralPath $audioPath -Algorithm SHA256).Hash.ToLowerInvariant()
        pathContainsPythonOrCuda = $false
        limitation = 'Development-machine native short-clip smoke, not an installer, clean Windows or 16 GB machine test.'
    } | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath "$outputPath/report.json"
} catch {
    @{ status = 'failed'; results = $results; error = $_.Exception.Message } | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath "$outputPath/report.json"
    throw
} finally {
    $env:Path = $priorPath
}
