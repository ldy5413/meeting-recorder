"""Score complete public English runs, keeping reference text out of inference.

Long calls are scored after concatenating every chunk in original order. This
uses micro WER with the official Whisper normalizer, not AA's custom leaderboard
normalizer/aggregation. Basic lexical WER is retained to expose formatting effects.
"""

import argparse
import hashlib
import html
import importlib.metadata
import json
import os
from pathlib import Path
import re
import sys
import unicodedata


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def basic_words(text):
    text = unicodedata.normalize("NFKC", text).casefold().replace("’", "'")
    return re.findall(r"\w+(?:'\w+)*", text)


def word_errors(reference, hypothesis):
    from rapidfuzz.distance import Levenshtein

    edits = Levenshtein.editops(reference, hypothesis)
    counts = {name: 0 for name in ("replace", "delete", "insert")}
    for edit in edits:
        counts[edit.tag] += 1
    spans = [
        {
            "operation": op.tag,
            "reference": " ".join(reference[op.src_start : op.src_end]),
            "hypothesis": " ".join(hypothesis[op.dest_start : op.dest_end]),
        }
        for op in edits.as_opcodes()
    ]
    return {
        "errors": len(edits),
        "reference_words": len(reference),
        "counts": counts,
        "wer": len(edits) / len(reference) if reference else None,
        "spans": spans,
    }


def unique(rows, key):
    result = {}
    for row in rows:
        if row[key] in result:
            raise ValueError(f"Duplicate {key}")
        result[row[key]] = row
    return result


def score(corpus, reference, report, corpus_hash, normalizer):
    if reference.get("reference_kind") != "published_dataset":
        raise ValueError("Published dataset reference required")
    if report.get("status") != "complete":
        raise ValueError("Incomplete inference run")
    if (
        reference["corpus_sha256"] != corpus_hash
        or report["configuration"]["corpus_sha256"] != corpus_hash
    ):
        raise ValueError("Corpus hash mismatch")
    samples = unique(corpus["samples"], "id")
    outputs = unique(report["results"], "sample_id")
    requested = report["configuration"]["sample_ids"]
    if (
        set(samples) != set(outputs)
        or len(requested) != len(set(requested))
        or set(requested) != set(samples)
    ):
        raise ValueError("Evaluation requires all frozen samples exactly once")
    if set(reference["sample_audio_sha256"]) != set(samples):
        raise ValueError("Reference audio coverage mismatch")
    units = unique(reference["units"], "id")
    covered = [sid for unit in units.values() for sid in unit["sample_ids"]]
    if len(covered) != len(set(covered)) or set(covered) != set(samples):
        raise ValueError("Reference units must partition the entire corpus")
    for sid, sample in samples.items():
        if (
            outputs[sid]["decoded_sha256"] != sample["decoded_sha256"]
            or reference["sample_audio_sha256"][sid] != sample["decoded_sha256"]
        ):
            raise ValueError("Audio hash mismatch")
    rows = []
    for unit in units.values():
        ids = unit["sample_ids"]
        if not ids or not unit["text"].strip():
            raise ValueError("Empty reference unit")
        cursor = 0.0
        for sid in ids:
            sample = samples[sid]
            if sample["meeting_id"] != unit["id"] or sample["group"] != unit["group"]:
                raise ValueError("Unit membership mismatch")
            if abs(sample["start_seconds"] - cursor) > 1 / 16000:
                raise ValueError(
                    "Chunks must cover their full unit in order without gaps/overlap"
                )
            cursor += sample["duration_seconds"]
        hypothesis = " ".join(outputs[sid]["text"].strip() for sid in ids)
        normalized = word_errors(
            normalizer(unit["text"]).split(), normalizer(hypothesis).split()
        )
        basic = word_errors(basic_words(unit["text"]), basic_words(hypothesis))
        rows.append(
            {
                "id": unit["id"],
                "group": unit["group"],
                "sample_ids": ids,
                "duration_seconds": cursor,
                "inference_seconds": sum(
                    outputs[sid]["inference_seconds"] for sid in ids
                ),
                "reference": unit["text"],
                "hypothesis": hypothesis,
                "normalized": normalized,
                "basic": {k: v for k, v in basic.items() if k != "spans"},
            }
        )
    groups = {}
    for group in [*dict.fromkeys(r["group"] for r in rows), "all"]:
        selected = [r for r in rows if group == "all" or r["group"] == group]
        entry = {
            "units": len(selected),
            "chunks": sum(len(r["sample_ids"]) for r in selected),
            "duration_seconds": sum(r["duration_seconds"] for r in selected),
            "inference_seconds": sum(r["inference_seconds"] for r in selected),
        }
        for mode in ("normalized", "basic"):
            errors = sum(r[mode]["errors"] for r in selected)
            words = sum(r[mode]["reference_words"] for r in selected)
            if not words:
                raise ValueError("No reference words after normalization")
            entry[mode] = {
                "errors": errors,
                "reference_words": words,
                "wer": errors / words,
            }
        entry["real_time_factor"] = (
            entry["inference_seconds"] / entry["duration_seconds"]
        )
        groups[group] = entry
    return {"groups": groups, "rows": rows}


def render(summary, corpus, root, output):
    esc = html.escape
    names = {
        "test-clean": "清晰英语朗读",
        "test-other": "较难英语朗读",
        "earnings22": "财报会议长音频",
        "all": "全部样本",
    }
    model_names = {"qwen3": "Qwen3-ASR 0.6B INT8", "sensevoice": "SenseVoiceSmall INT8"}
    parts = [
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
        "<title>英语 ASR 实测</title><style>body{font:16px/1.65 system-ui,sans-serif;max-width:1120px;margin:30px auto;padding:0 20px;color:#183047;background:#f4f7fb}h1{line-height:1.25}table{border-collapse:collapse;width:100%;background:white}td,th{border-bottom:1px solid #ddd;padding:10px;text-align:left}section,details{background:white;padding:18px;margin:18px 0;border-radius:12px}summary{cursor:pointer;font-weight:600}p{overflow-wrap:anywhere}.table{overflow:auto}del{background:#ffe1e1;color:#842929}ins{background:#d8f5e4;color:#125736;text-decoration:none}audio{width:100%;max-width:520px}.muted{color:#53697d}a{color:#1763a6}</style>",
        "<h1>英语 ASR：公开参考稿实测</h1>",
        "<p>CPU · 4 线程 · 无提示词 · 自动语言识别。固定 73 位朗读者各 2 段，以及 2 份财报电话会议长音频。使用数据集提供的完整文件，其中一份是上游裁剪版。参考稿与推理输入分离；没有按识别结果筛样本。</p>",
        "<p>主指标为词错误率 WER（越低越好），采用官方 Whisper 英语规范化，统一数字、缩写与部分拼写，去除部分口头语；另列仅处理大小写/标点的词错误率。按参考词数合并。此处不是 AA 官方榜单分数，也不是整个 LibriSpeech 测试集分数。</p>",
        '<div class="table"><table><thead><tr><th>模型 / 场景</th><th>音频分钟</th><th>词数</th><th>规范化 WER</th><th>基础 WER</th><th>推理秒数</th></tr></thead><tbody>',
    ]
    for engine, result in summary["models"].items():
        for group, g in result["groups"].items():
            parts.append(
                f"<tr><td>{esc(model_names.get(engine, engine))}<br>{names[group]}</td><td>{g['duration_seconds'] / 60:.2f}</td><td>{g['normalized']['reference_words']}</td><td><b>{g['normalized']['wer']:.2%}</b></td><td>{g['basic']['wer']:.2%}</td><td>{g['inference_seconds']:.1f}</td></tr>"
            )
    parts.append("</tbody></table></div><section><h2>速度与内存</h2>")
    for engine, result in summary["models"].items():
        p = result["performance"]
        parts.append(
            f"<p>{esc(model_names.get(engine, engine))}：加载 {p['model_load_seconds']:.2f} 秒，进程峰值 {p['peak_process_rss_bytes'] / 1e9:.2f} GB，RTF {result['groups']['all']['real_time_factor']:.3f}。</p>"
        )
    parts.append(
        '<p class="muted">i7-14700HX / 64 GiB 开发机，强制 CPU 4 线程。纯推理时间不含下载、音频解码、切段与评分；不是 16 GB 目标机或安装包验收。未评估说话人身份与重叠讲话。</p></section>'
    )
    samples = {s["id"]: s for s in corpus["samples"]}
    parts.append(
        "<h2>错误明细</h2><p>每组展示词错误最多的 10 个参考单元；完整明细保存在 scores.json。电话会议按整场评分，回听链接按原顺序列出全部片段。红色为参考中的替换/漏词，绿色为模型替换/多出的词。</p>"
    )
    for engine, result in summary["models"].items():
        for group in names:
            if group == "all":
                continue
            rows = sorted(
                (r for r in result["rows"] if r["group"] == group),
                key=lambda r: r["normalized"]["errors"],
                reverse=True,
            )[:10]
            for row in rows:
                parts.append(
                    f"<details><summary>{esc(model_names.get(engine, engine))} · {esc(row['id'])} · WER {row['normalized']['wer']:.2%} ({row['normalized']['errors']}/{row['normalized']['reference_words']})</summary>"
                )
                for sid in row["sample_ids"]:
                    sample = samples[sid]
                    link = Path(
                        os.path.relpath(root / sample["audio"], output)
                    ).as_posix()
                    parts.append(
                        f'<p><span>{sample["start_seconds"]:.1f}s</span> <audio controls preload="none" src="{esc(link, quote=True)}"></audio></p>'
                    )
                parts.append("<p>")
                for span in row["normalized"]["spans"]:
                    if span["operation"] == "equal":
                        parts.append(esc(span["reference"]) + " ")
                    else:
                        if span["reference"]:
                            parts.append(f"<del>{esc(span['reference'])}</del> ")
                        if span["hypothesis"]:
                            parts.append(f"<ins>{esc(span['hypothesis'])}</ins> ")
                parts.append("</p></details>")
    parts.append(
        '<section><h2>来源与可复现性</h2><p><a href="https://openslr.org/12/">LibriSpeech / CC BY 4.0</a>；<a href="https://huggingface.co/datasets/ArtificialAnalysis/Earnings22-Cleaned-AA">Earnings22-Cleaned-AA / 人工校订参考</a>；<a href="https://github.com/openai/whisper/tree/86098128c0b4f24f0e2aa2994de830614b474227/whisper/normalizers">固定版本 Whisper normalizer</a>。</p><p>evaluation-plan.json 在推理前固定抽样与评分方案，references.json 记录来源版本和音频哈希。长音频按 18–28 秒内最低能量处切段，无重叠、不丢音频；拼接全部结果再按整场参考评分。切段错误也计入 WER。公开数据可能出现在模型训练中，且这里仅选两场电话会议，结果不能代替真实英语会议验收。</p></section></html>'
    )
    (output / "index.html").write_text("".join(parts), "utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("--report", action="append", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = args.corpus.resolve().parent
    reference_path = root / "references.json"
    corpus = json.loads(args.corpus.read_text("utf-8"))
    reference = json.loads(reference_path.read_text("utf-8"))
    for name, expected in reference["normalizer_sha256"].items():
        path = (root / "whisper_normalizers" / name).resolve()
        if not path.is_relative_to(root) or digest(path) != expected:
            raise ValueError("Normalizer hash mismatch")
    for sample in corpus["samples"]:
        path = (root / sample["audio"]).resolve()
        if not path.is_relative_to(root) or digest(path) != sample["decoded_sha256"]:
            raise ValueError("Frozen audio changed")
    sys.path.insert(0, str(root))
    from whisper_normalizers import EnglishTextNormalizer

    normalizer = EnglishTextNormalizer()
    summary = {
        "corpus_sha256": digest(args.corpus),
        "reference_sha256": digest(reference_path),
        "normalizer_revision": reference["plan"]["normalizer_revision"],
        "scoring": "micro WER, official Whisper EnglishTextNormalizer (unmodified)",
        "scorer_sha256": digest(Path(__file__)),
        "packages": {
            p: importlib.metadata.version(p)
            for p in ("regex", "more-itertools", "rapidfuzz")
        },
        "models": {},
    }
    for report_path in args.report:
        report = json.loads(report_path.read_text("utf-8"))
        engine = report["configuration"]["engine"]
        if engine in summary["models"]:
            raise ValueError("Duplicate model report")
        result = score(corpus, reference, report, summary["corpus_sha256"], normalizer)
        result["report_sha256"] = digest(report_path)
        result["configuration"] = report["configuration"]
        result["performance"] = {
            k: report[k] for k in ("model_load_seconds", "peak_process_rss_bytes")
        }
        summary["models"][engine] = result
        print(engine, json.dumps(result["groups"], indent=2))
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / "scores.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), "utf-8"
    )
    render(summary, corpus, root, args.output.resolve())


if __name__ == "__main__":
    main()
