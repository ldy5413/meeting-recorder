"""Evaluate local SenseVoice CPU inference in a new, private output directory.

Never uploads audio, modifies the meeting database, or overwrites a previous run.
--repeat-to produces explicitly synthetic endurance audio, not a new real meeting.
"""

import argparse
import html
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import sys
import threading
import time
import wave

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from service.lightweight_models import ASSETS, DEFAULT_MODELS, digest  # noqa: E402


def save(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), "utf-8")
    temporary.replace(path)


def decode_audio(audio, wav, offset=0, seconds=None, repeat_to=None):
    """Preserve packet time rather than concatenating decoded AAC samples."""
    probe = subprocess.run(
        [
            os.getenv("FFPROBE", "ffprobe"),
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(audio.resolve()),
        ],
        check=True,
        capture_output=True,
        timeout=60,
    )
    source_duration = float(json.loads(probe.stdout)["format"]["duration"])
    if not math.isfinite(source_duration) or source_duration <= offset:
        raise ValueError("Invalid source duration or clip offset")
    target_duration = repeat_to or min(
        seconds or source_duration, source_duration - offset
    )
    command = [os.getenv("FFMPEG", "ffmpeg"), "-nostdin", "-v", "error", "-n"]
    if repeat_to:
        command += ["-stream_loop", "-1"]
    command += ["-i", str(audio.resolve())]
    if offset:
        command += ["-ss", str(offset)]
    command += [
        "-t",
        str(target_duration),
        "-vn",
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-af",
        "aresample=16000:async=1:first_pts=0",
        "-c:a",
        "pcm_s16le",
        str(wav.resolve()),
    ]
    subprocess.run(command, check=True, capture_output=True, timeout=600)
    with wave.open(str(wav), "rb") as decoded:
        decoded_duration = decoded.getnframes() / decoded.getframerate()
    if abs(decoded_duration - target_duration) > 0.1:
        raise ValueError(
            "Decoded audio differs from requested source timeline by more than 100 ms"
        )
    return source_duration


def review_page(output, report, baseline):
    """Local playback and paired excerpts, with no external scripts or requests."""
    duration = report["metrics"]["duration_seconds"]
    starts = {round(duration * f, 1) for f in (0, 0.2, 0.4, 0.6, 0.8)}
    unknown = next((s for s in report["segments"] if s["speaker"] == "unknown"), None)
    if unknown:
        starts.add(max(0, round(unknown["start"] - 3, 1)))
    rows = []
    for start in sorted(starts):
        end = min(duration, start + 30)

        def excerpt(segments):
            return (
                "<br>".join(
                    html.escape(
                        f"[{s['start']:.1f}s {s.get('speaker', '?')}] {s['text']}"
                    )
                    for s in segments
                    if s["end"] > start and s["start"] < end
                )
                or "（无输出）"
            )

        rows.append(
            f'<section><button data-start="{start}" data-end="{end}">'
            f'回听 {start:.1f}–{end:.1f} 秒</button><div class="pair">'
            f"<article><h3>SenseVoice · 本次结果</h3>{excerpt(report['segments'])}</article>"
            f"<article><h3>VibeVoice · 历史机器结果，非标准答案</h3>{excerpt(baseline)}</article>"
            '</div><label>人工逐字稿（听后填写，不要直接复制机器输出）<textarea class="reference" '
            f'data-start="{start}" data-end="{end}" placeholder="只填写上述回听范围内实际说出的文字；可留空"></textarea></label>'
            '<label><input class="reviewed" type="checkbox"> 已听完并核对这段逐字稿</label>'
            '<label>其他核对记录<textarea class="notes" placeholder="术语错字、换人错误、回听偏移"></textarea></label></section>'
        )
    page = """<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>轻量转录 · 本地对照核验</title><style>
body{font:16px/1.7 system-ui,sans-serif;background:#f4f5f7;color:#20262d;max-width:1300px;margin:32px auto;padding:0 24px}
section{background:white;border:1px solid #dfe3e7;border-radius:12px;padding:24px;margin:20px 0}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:30px}article{overflow-wrap:anywhere}
button{padding:10px 18px;background:#263847;color:white;border:0;border-radius:6px;cursor:pointer}
textarea{display:block;width:98%;min-height:90px;font:inherit}audio{width:100%;position:sticky;top:0}
label{display:block;margin-top:12px}
h3{font-size:16px}p{color:#526170}.metrics{display:flex;flex-wrap:wrap;gap:16px}
.metric{background:white;border-radius:8px;padding:12px 20px}.metric strong{display:block;font-size:22px}
@media(max-width:750px){.pair{grid-template-columns:1fr}}
</style><h1>轻量转录 · 本地对照核验</h1>
<p>录音与文字仅在本机读取。历史机器转录不是人工金标准；未核对的样本不能计为准确率通过。
说话人编号仅限本次录音；unknown 表示无法确定或多人重叠。时间戳为模型估计。离开前请导出核对记录。</p>
<audio id="audio" controls src="audio.wav"></audio><div>METRICS</div>ROWS
<button id="export">导出人工核对记录</button><script>
const audio=document.getElementById('audio');let stopAt=Infinity;
document.querySelectorAll('button[data-start]').forEach(b=>b.onclick=()=>{
 audio.currentTime=Number(b.dataset.start);stopAt=Number(b.dataset.end);audio.play();
});audio.ontimeupdate=()=>{if(audio.currentTime>=stopAt){audio.pause();stopAt=Infinity;}};
document.getElementById('export').onclick=()=>{
 const samples=Array.from(document.querySelectorAll('section')).map(s=>{const t=s.querySelector('.reference');return {start:Number(t.dataset.start),end:Number(t.dataset.end),reference_text:t.value,reviewed:s.querySelector('.reviewed').checked,notes:s.querySelector('.notes').value};});
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({reference_kind:'human',sourceSha256:'SOURCE_HASH',decodedSha256:'DECODED_HASH',samples},null,2)],{type:'application/json'}));
 a.download='manual-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};</script></html>"""
    metrics = report["metrics"]
    cards = [("音频时长", f"{duration / 60:.1f} 分钟")]
    if "elapsed_seconds" in metrics:
        cards.append(("本次处理耗时", f"{metrics['elapsed_seconds'] / 60:.1f} 分钟"))
    if "peak_process_rss_bytes" in metrics:
        cards.append(
            ("进程内存峰值", f"{metrics['peak_process_rss_bytes'] / 1e6:.0f} MB")
        )
    cards.append(("识别质量", "待人工核对"))
    summary = (
        '<div class="metrics">'
        + "".join(
            f'<div class="metric">{label}<strong>{value}</strong></div>'
            for label, value in cards
        )
        + "</div>"
    )
    page = page.replace("METRICS", summary)
    page = page.replace("ROWS", "\n".join(rows)).replace(
        "SOURCE_HASH", report["source_sha256"]
    )
    page = page.replace("DECODED_HASH", report.get("decoded_sha256", ""))
    (output / "review.html").write_text(page, "utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--models", type=Path, default=DEFAULT_MODELS)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--no-speakers", action="store_true")
    parser.add_argument("--speaker-threshold", type=float, default=0.5)
    parser.add_argument("--offset", type=float, default=0)
    parser.add_argument("--seconds", type=float)
    parser.add_argument("--repeat-to", type=float)
    parser.add_argument(
        "--baseline",
        type=Path,
        help="Local historical JSON with segments; not ground truth",
    )
    args = parser.parse_args()
    if not args.audio.is_file():
        parser.error("audio must be an existing local file")
    if args.threads < 1 or not math.isfinite(args.offset) or args.offset < 0:
        parser.error("Invalid threads/offset")
    if not math.isfinite(args.speaker_threshold) or not 0 < args.speaker_threshold < 2:
        parser.error("Invalid speaker clustering threshold")
    for value in (args.seconds, args.repeat_to):
        if value is not None and (not math.isfinite(value) or value <= 0):
            parser.error("Duration must be positive and finite")
    if args.repeat_to and (args.seconds or args.offset or args.baseline):
        parser.error("Synthetic repetition cannot be combined with clips or baseline")
    import psutil

    # Exclusive directory creation also protects the source, prior reports and DBs.
    args.output.mkdir(parents=True, exist_ok=False)
    process = psutil.Process()
    stop = threading.Event()
    samples = []

    def sample():
        while not stop.is_set():
            children = 0
            for child in process.children(recursive=True):
                try:
                    children += child.memory_info().rss
                except psutil.Error:
                    pass
            samples.append(
                {
                    "seconds": round(time.monotonic() - started, 2),
                    "rss_bytes": process.memory_info().rss,
                    "child_rss_bytes": children,
                }
            )
            stop.wait(0.1)

    started = time.monotonic()
    monitor = threading.Thread(target=sample, daemon=True)
    monitor.start()
    report = {
        "status": "running",
        "source_sha256": digest(args.audio),
        "synthetic_repeat": bool(args.repeat_to),
        "offset_seconds": args.offset,
    }
    try:
        wav = args.output / "audio.wav"
        report["source_duration_seconds"] = decode_audio(
            args.audio, wav, args.offset, args.seconds, args.repeat_to
        )
        report["decode_policy"] = (
            "v2: honor packet timestamps with aresample async=1:first_pts=0; bound to probed source/clip duration"
        )
        report["decoded_sha256"] = digest(wav)
        decode_seconds = time.monotonic() - started
        from service.lightweight import transcribe

        report.update(
            transcribe(
                wav,
                args.models,
                report["decoded_sha256"],
                args.threads,
                lambda s: print(s, flush=True),
                not args.no_speakers,
                args.speaker_threshold,
            )
        )
        segments = report["segments"]
        duration = report["metrics"]["duration_seconds"]
        valid = (
            len({s["id"] for s in segments}) == len(segments)
            and all(0 <= s["start"] <= s["end"] <= duration for s in segments)
            and all(a["start"] <= b["start"] for a, b in zip(segments, segments[1:]))
        )
        if not valid:
            raise ValueError("Output segment integrity check failed")
        raw_text = "".join("".join(r["text"].split()) for r in report["raw"])
        segment_text = "".join("".join(s["text"].split()) for s in segments)
        if raw_text != segment_text:
            raise ValueError("Speaker alignment changed the recognized text")
        elapsed = time.monotonic() - started
        memory = process.memory_info()
        report["metrics"].update(
            {
                "elapsed_seconds": elapsed,
                "decode_seconds": decode_seconds,
                "real_time_factor": elapsed / duration,
                "peak_process_rss_bytes": max(
                    getattr(memory, "peak_wset", 0),
                    memory.rss,
                    max(s["rss_bytes"] for s in samples),
                ),
                "peak_sampled_process_tree_rss_bytes": max(
                    s["rss_bytes"] + s["child_rss_bytes"] for s in samples
                ),
                "model_bytes": sum(a["bytes"] for a in ASSETS.values()),
                "segments": len(segments),
            }
        )
        report.update(
            {
                "status": "complete",
                "integrity_passed": True,
                "recognized_text_preserved": True,
                "accuracy_evaluation": "pending human reference; no CER, DER or timestamp accuracy claimed",
                "models": ASSETS,
                "environment": {
                    "platform": platform.platform(),
                    "processor": platform.processor(),
                    "logical_cpus": psutil.cpu_count(),
                    "physical_cpus": psutil.cpu_count(logical=False),
                    "ram_bytes": psutil.virtual_memory().total,
                    "python": platform.python_version(),
                    "torch_imported": "torch" in sys.modules,
                },
            }
        )
        baseline = []
        if args.baseline:
            data = json.loads(args.baseline.read_text("utf-8"))
            baseline = data if isinstance(data, list) else data["segments"]
            baseline = [
                {**s, "start": s["start"] - args.offset, "end": s["end"] - args.offset}
                for s in baseline
            ]
            report["baseline_sha256"] = digest(args.baseline)
        review_page(args.output, report, baseline)
        print(json.dumps(report["metrics"], ensure_ascii=True), flush=True)
    except BaseException as error:
        report.update(status="failed", error=f"{type(error).__name__}: {error}")
        raise
    finally:
        stop.set()
        monitor.join(timeout=2)
        save(args.output / "report.json", report)
        save(args.output / "memory.json", samples)


if __name__ == "__main__":
    main()
