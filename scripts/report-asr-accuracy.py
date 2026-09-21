"""Create a private, auditable accuracy report from a frozen human review."""

import argparse
import html
import json
import os
from pathlib import Path
import sys
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from service.lightweight_models import digest  # noqa: E402
from service.lightweight_scoring import edit_details, normalize, score_corpus  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("--report", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    corpus = json.loads(args.corpus.read_text("utf-8"))
    reference = json.loads(args.reference.read_text("utf-8-sig"))
    corpus_hash = digest(args.corpus)
    samples = {s["id"]: s for s in corpus["samples"]}
    meetings = {m["id"]: m for m in corpus["meetings"]}
    refs = {r["sample_id"]: r for r in reference["samples"]}
    for sample in samples.values():
        wav = (args.corpus.parent / sample["audio"]).resolve()
        if (
            not wav.is_relative_to(args.corpus.parent.resolve())
            or digest(wav) != sample["decoded_sha256"]
        ):
            raise ValueError("Corpus audio path/hash mismatch")
    groups = {}
    for path in args.report:
        report = json.loads(path.read_text("utf-8"))
        score_corpus(corpus, report, reference, corpus_hash)
        config = report["configuration"]
        label = config["engine"] + (" + 会议关键词" if config.get("hotwords") else "")
        stage = config.get("evaluation_stage", "pre-reference baseline")
        group = groups.setdefault(
            (label, stage),
            {"label": label, "stage": stage, "results": [], "sources": []},
        )
        group["results"].extend(report["results"])
        group["sources"].append(
            {"path": str(path), "sha256": digest(path), "configuration": config}
        )
    scored = []
    for group in groups.values():
        combined = {
            "status": "complete",
            "configuration": {
                "corpus_sha256": corpus_hash,
                "sample_ids": [s["sample_id"] for s in group["results"]],
            },
            "results": group["results"],
        }
        result = score_corpus(corpus, combined, reference, corpus_hash)
        outputs = {s["sample_id"]: s for s in group["results"]}
        for sample_score in result["samples"]:
            sid = sample_score["sample_id"]
            alignment = edit_details(
                normalize(refs[sid]["reference_text"]), normalize(outputs[sid]["text"])
            )
            if alignment["edit_distance"] != sample_score["edit_distance"]:
                raise ValueError("Error alignment differs from scoring")
            sample_score.update(
                alignment=alignment,
                reference_text=refs[sid]["reference_text"],
                hypothesis_text=outputs[sid]["text"],
            )
        chars = sum(s["reference_characters"] for s in result["samples"])
        errors = sum(s["edit_distance"] for s in result["samples"])
        scored.append(
            {
                "label": group["label"],
                "stage": group["stage"],
                "sources": group["sources"],
                **result,
                "pooled": {
                    "reference_characters": chars,
                    "edit_distance": errors,
                    "character_error_rate": errors / chars if chars else None,
                    "samples": len(result["samples"]),
                    "warning": "Development and holdout pooled; not independent validation",
                },
            }
        )
    args.output.mkdir(parents=True, exist_ok=False)
    summary = {
        "corpus_sha256": corpus_hash,
        "reference_sha256": digest(args.reference),
        "reference_confirmation": reference.get("supplemental_confirmation"),
        "reviewed_with_outputs_revealed": sum(
            s.get("outputs_revealed") is True and s.get("reviewed") is True
            for s in reference["samples"]
        ),
        "results": scored,
        "scope": "Human-reviewed fixed excerpts. CER ignores whitespace/punctuation only; speaker and timestamp accuracy are unmeasured.",
    }
    (args.output / "scores.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), "utf-8"
    )
    esc = html.escape
    rows, details = [], []

    def rate(value):
        return "—" if value is None else f"{100 * value:.2f}%"

    for group in scored:
        columns = [esc(group["label"])]
        for split in ("development", "holdout"):
            stats = group["splits"].get(split)
            columns.append(
                "—"
                if stats is None
                else f"{rate(stats['character_error_rate'])}<small>{stats['edit_distance']} / {stats['reference_characters']} 字 · {stats['reviewed_samples']}/{stats['total_split_samples']} 段</small>"
            )
        columns.append(
            f"{rate(group['pooled']['character_error_rate'])}<small>{group['pooled']['samples']} 段；合并值</small>"
        )
        columns.append(
            "初始固定对比"
            if group["stage"] == "pre-reference baseline"
            else "查看参考后复测"
        )
        rows.append("<tr>" + "".join(f"<td>{c}</td>" for c in columns) + "</tr>")
        blocks = []
        for row in sorted(group["samples"], key=lambda r: -r["edit_distance"]):
            sample = samples[row["sample_id"]]
            left, right = [], []
            for span in row["alignment"]["spans"]:
                for items, key in ((left, "reference"), (right, "hypothesis")):
                    word = esc(span[key])
                    if span["operation"] != "equal":
                        word = f"<mark>{word or '∅'}</mark>"
                    items.append(word)
            wav = (args.corpus.parent / sample["audio"]).resolve()
            audio = quote(
                os.path.relpath(wav, args.output.resolve()).replace(os.sep, "/"),
                safe="/",
            )
            counts = row["alignment"]["counts"]
            blocks.append(
                f'<article><h3>{esc(meetings[sample["meeting_id"]]["title"])} · {sample["source_offset_seconds"]:.1f}s · {esc(sample["split"])}</h3><p>{row["edit_distance"]} 处编辑 / {row["reference_characters"]} 字；替换 {counts["substitution"]}，漏字 {counts["deletion"]}，多字 {counts["insertion"]}</p><audio controls preload="none" src="{esc(audio)}"></audio><div class="pair"><div><b>人工参考</b><p>{"".join(left) or "（无声）"}</p></div><div><b>模型输出</b><p>{"".join(right) or "（空）"}</p></div></div></article>'
            )
        details.append(
            f"<details><summary>{esc(group['label'])}：逐段差异与回听</summary>{''.join(blocks)}</details>"
        )
    page = f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; media-src 'self' file:; connect-src 'none'"><title>人工核对后的 ASR 实测</title><style>*{{box-sizing:border-box}}body{{margin:0;background:#f3f5f7;color:#202730;font:16px/1.7 system-ui,'Microsoft YaHei',sans-serif}}main{{max-width:1200px;margin:auto;padding:28px 20px}}section,details{{background:white;border:1px solid #d9e0e7;border-radius:10px;padding:20px;margin:18px 0}}h1{{font-size:27px}}h3{{font-size:17px}}.table{{overflow:auto}}table{{width:100%;border-collapse:collapse}}td,th{{padding:12px;border-bottom:1px solid #e1e5eb;text-align:left;white-space:nowrap}}small{{display:block;color:#596778}}summary{{cursor:pointer;font-weight:600}}article{{padding:18px 0;border-bottom:1px solid #dce1e8}}.pair{{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:20px}}.pair p{{overflow-wrap:anywhere}}mark{{background:#ffe1dc;color:#842a1b;border-radius:3px;padding:1px}}audio{{width:100%;max-width:500px}}.note{{color:#596778}}</style><main><h1>人工核对后的 ASR 实测</h1><section><p>以下为字符错误率 CER，越低越好。目标“95%”对应 CER ≤ 5%。字符准确度如按 1 − CER 表示，只描述这些核对片段。</p><p>开发集与保留集分别统计；合并值不能代替保留集达标。核对时已显示过机器稿，因此不是盲标。静音段按用户补充确认计入，原始核对文件保留不变。</p><div class="table"><table><thead><tr><th>模型</th><th>开发集 CER</th><th>保留集 CER</th><th>合并 CER</th><th>评估阶段</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div><p class="note">评分去除标点、空白并统一大小写；保留数字和英文拼写。没有用语义改写抵消错字。说话人、时间戳、纪要质量及未来录音的准确率另行评估。</p></section>{"".join(details)}<p class="note">所有音频与结果保留本机。机器可读结果：scores.json。</p></main></html>"""
    (args.output / "index.html").write_text(page, "utf-8")
    print(args.output / "index.html")


if __name__ == "__main__":
    main()
