"""Score reviewed excerpts only. Model outputs are never treated as references.

Overlapping windows receive separate scores, not an aggregate headline metric.
"""

import math
import unicodedata


def normalize(text):
    return "".join(
        c
        for c in unicodedata.normalize("NFKC", text).casefold()
        if not c.isspace() and not unicodedata.category(c).startswith("P")
    )


def distance(reference, hypothesis):
    row = list(range(len(hypothesis) + 1))
    for i, left in enumerate(reference, 1):
        next_row = [i]
        for j, right in enumerate(hypothesis, 1):
            next_row.append(
                min(row[j] + 1, next_row[-1] + 1, row[j - 1] + (left != right))
            )
        row = next_row
    return row[-1]


def edit_details(reference, hypothesis):
    """Minimum-edit character alignment for auditable S/D/I error displays."""
    matrix = [list(range(len(hypothesis) + 1))]
    for i, left in enumerate(reference, 1):
        row = [i]
        for j, right in enumerate(hypothesis, 1):
            row.append(
                min(
                    matrix[i - 1][j] + 1,
                    row[-1] + 1,
                    matrix[i - 1][j - 1] + (left != right),
                )
            )
        matrix.append(row)
    i, j = len(reference), len(hypothesis)
    edits = []
    while i or j:
        if (
            i
            and j
            and reference[i - 1] == hypothesis[j - 1]
            and matrix[i][j] == matrix[i - 1][j - 1]
        ):
            i, j = i - 1, j - 1
            edits.append(("equal", reference[i], hypothesis[j]))
        elif i and j and matrix[i][j] == matrix[i - 1][j - 1] + 1:
            i, j = i - 1, j - 1
            edits.append(("substitution", reference[i], hypothesis[j]))
        elif i and matrix[i][j] == matrix[i - 1][j] + 1:
            i -= 1
            edits.append(("deletion", reference[i], ""))
        else:
            j -= 1
            edits.append(("insertion", "", hypothesis[j]))
    counts = {name: 0 for name in ("substitution", "deletion", "insertion")}
    spans = []
    for operation, ref, hyp in reversed(edits):
        if operation != "equal":
            counts[operation] += 1
        if spans and spans[-1]["operation"] == operation:
            spans[-1]["reference"] += ref
            spans[-1]["hypothesis"] += hyp
        else:
            spans.append({"operation": operation, "reference": ref, "hypothesis": hyp})
    return {"edit_distance": matrix[-1][-1], "counts": counts, "spans": spans}


def score_corpus(corpus, report, reference, corpus_hash):
    """Score fixed complete clips, including explicit silence and missing outputs.

    A passing sample CER describes this reviewed subset only, never all future
    meetings. No candidate or saved application transcript can act as gold.
    """
    if (
        reference.get("reference_kind") != "human"
        or not reference.get("reviewer", "").strip()
    ):
        raise ValueError("Named human review is required")
    if (
        reference.get("corpus_sha256") != corpus_hash
        or report["configuration"]["corpus_sha256"] != corpus_hash
    ):
        raise ValueError("Corpus fingerprint mismatch")
    if report.get("status") != "complete":
        raise ValueError("Candidate run is incomplete")

    def unique(items, key):
        values = {}
        for item in items:
            if item[key] in values:
                raise ValueError("Duplicate sample ID")
            values[item[key]] = item
        return values

    samples = unique(corpus["samples"], "id")
    outputs = unique(report["results"], "sample_id")
    reviews = unique(reference["samples"], "sample_id")
    if set(outputs) - set(samples) or set(reviews) - set(samples):
        raise ValueError("Unknown sample ID")
    requested = report["configuration"]["sample_ids"]
    if len(requested) != len(set(requested)) or set(requested) != set(outputs):
        raise ValueError("Missing or unexpected candidate output")
    rows = []
    for sid in requested:
        sample, output = samples[sid], outputs[sid]
        if output["decoded_sha256"] != sample["decoded_sha256"]:
            raise ValueError("Candidate audio fingerprint mismatch")
        review = reviews.get(sid)
        if review is None or review.get("reviewed") is not True:
            continue
        if review.get("decoded_sha256") != sample["decoded_sha256"]:
            raise ValueError("Reference audio fingerprint mismatch")
        if review.get("unintelligible") is True:
            continue
        ref = normalize(review["reference_text"])
        if not ref and review.get("no_speech") is not True:
            raise ValueError("Empty gold requires explicit no-speech review")
        if ref and review.get("no_speech") is True:
            raise ValueError("No-speech review contains speech text")
        hypothesis = normalize(output["text"])
        errors = distance(ref, hypothesis)
        rows.append(
            {
                "sample_id": sid,
                "meeting_id": sample["meeting_id"],
                "split": sample["split"],
                "reference_characters": len(ref),
                "edit_distance": errors,
                "character_error_rate": errors / len(ref) if ref else None,
                "silence_insertions": len(hypothesis) if not ref else 0,
            }
        )
    if not rows:
        raise ValueError("No usable reviewed samples; accuracy remains pending")
    groups = {}
    for split in dict.fromkeys(samples[s]["split"] for s in requested):
        selected = [r for r in rows if r["split"] == split]
        expected = [s for s in corpus["samples"] if s["split"] == split]
        characters = sum(r["reference_characters"] for r in selected)
        errors = sum(r["edit_distance"] for r in selected)
        complete = {r["sample_id"] for r in selected} == {s["id"] for s in expected}
        cer = errors / characters if characters else None
        groups[split] = {
            "reviewed_samples": len(selected),
            "total_split_samples": len(expected),
            "all_split_samples_reviewed_and_evaluated": complete,
            "reference_characters": characters,
            "edit_distance": errors,
            "character_error_rate": cer,
            "meets_sample_cer_5pct": bool(complete and cer is not None and cer <= 0.05),
        }
    return {
        "samples": rows,
        "splits": groups,
        "normalization": "NFKC, casefold, remove whitespace/punctuation; retain numbers/symbols; no semantic or numeric rewriting",
        "scope": "Fixed reviewed excerpts only. Does not establish full-meeting, speaker, timestamp, summary or future-recording accuracy.",
        "accuracy_status": "Sample CER only; population-level 95% not established",
    }


def score(report, reference):
    if reference.get("reference_kind") != "human":
        raise ValueError("An explicitly human-reviewed reference is required")
    if (
        reference.get("sourceSha256") != report["source_sha256"]
        or reference.get("decodedSha256") != report["decoded_sha256"]
    ):
        raise ValueError(
            "Reference does not match the evaluated source and decoded audio"
        )
    results = []
    duration = report["metrics"]["duration_seconds"]
    for sample in reference["samples"]:
        if sample.get("reviewed") is not True:
            continue
        start, end = float(sample["start"]), float(sample["end"])
        if not (
            math.isfinite(start) and math.isfinite(end) and 0 <= start < end <= duration
        ):
            raise ValueError("Invalid reference time range")
        text = normalize(sample["reference_text"])
        if not text:
            raise ValueError("Reviewed samples require nonempty reference text")
        tokens = []
        for window in report["raw"]:
            if len(window["tokens"]) != len(window["timestamps"]):
                raise ValueError("Invalid model token timestamps")
            tokens.extend(
                token
                for token, timestamp in zip(window["tokens"], window["timestamps"])
                if start <= window["start"] + timestamp < end
            )
        hypothesis = normalize("".join(tokens))
        edits = distance(text, hypothesis)
        results.append(
            {
                "start": start,
                "end": end,
                "reference_characters": len(text),
                "edit_distance": edits,
                "character_error_rate": edits / len(text),
            }
        )
    if not results:
        raise ValueError("No reviewed samples; accuracy remains pending")
    return {
        "samples": results,
        "normalization": "Unicode NFKC, casefold, remove whitespace and punctuation; retain numbers and symbols",
        "scope": "Reviewed excerpts only; selection uses approximate CTC token onsets. No full-meeting, speaker or timestamp accuracy claim.",
    }
