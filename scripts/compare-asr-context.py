"""Run a paired, local ASR context experiment with identical audio and settings."""

import hashlib
import json
import os
from pathlib import Path
import time

root = Path(__file__).resolve().parent.parent
os.environ.update(
    {
        "VIBEVOICE_MODEL": str(root / ".local/models/VibeVoice-ASR"),
        "HF_HOME": str(root / ".local/hf-cache"),
        "VIBEVOICE_DEVICE": "cuda",
        "VIBEVOICE_QUANTIZATION": "4bit",
        "VIBEVOICE_MAX_TOKENS": "8192",
        "VIBEVOICE_GENERATION_SECONDS": "600",
    }
)
from service.adapter import VibeVoice  # noqa: E402 - environment must be configured first

audio = root / ".local/asr-smoke-july.wav"
context = "材料研究讨论。关键词：XRD、无定形峰、氧化硅、碳化硅、电解。"
backend = VibeVoice()
results = []
for label, info in [("without", ""), ("with", context)]:
    started = time.monotonic()
    segments, raw = backend.transcribe(audio, context_info=info)
    text = "\n".join(str(s.get("Content", s.get("text", ""))) for s in segments)
    results.append(
        {
            "label": label,
            "context_info": info,
            "seconds": time.monotonic() - started,
            "segments": segments,
            "raw": raw,
            "term_counts": {
                term: text.count(term)
                for term in ["XRD", "无定形", "氧化硅", "碳化硅", "电解", "风", "峰"]
            },
        }
    )
    print(f"Completed {label}", flush=True)
output = {
    "audio_sha256": hashlib.sha256(audio.read_bytes()).hexdigest(),
    "results": results,
    "note": "Term occurrences compare spelling only; they are not a word-error-rate or accuracy improvement measurement.",
}
(root / ".local/asr-context-comparison.json").write_text(
    json.dumps(output, ensure_ascii=False, indent=2), "utf-8"
)
print(
    json.dumps(
        [{"label": r["label"], "term_counts": r["term_counts"]} for r in results],
        ensure_ascii=True,
    )
)
