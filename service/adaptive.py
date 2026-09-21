"""Bounded retries split only incomplete windows; successful pieces remain cached."""

import json
from service.adapter import IncompleteOutput
from service.chunking import normalize, merge


def transcribe_window(
    directory, cache_key, index, offset, length, namespace, infer, progress, branch=1
):
    suffix = str(index) if branch == 1 else f"{index}-part-{branch}"
    saved = directory / f"chunk-{cache_key}-{suffix}.json"
    if saved.exists():
        return json.loads(saved.read_text("utf-8"))
    incomplete = directory / f"chunk-{cache_key}-{suffix}-incomplete.json"
    if not incomplete.exists():
        progress(offset, length)
        try:
            segments, raw = infer(offset, length)
        except IncompleteOutput as exc:
            incomplete.write_text(
                json.dumps(
                    {
                        "offset": offset,
                        "length": length,
                        "error": str(exc),
                        "raw": exc.raw,
                    },
                    ensure_ascii=False,
                ),
                "utf-8",
            )
        else:
            (directory / f"chunk-{cache_key}-{suffix}-raw.json").write_text(
                json.dumps(
                    {
                        "offset": offset,
                        "length": length,
                        "segments": segments,
                        "raw": raw,
                    },
                    ensure_ascii=False,
                ),
                "utf-8",
            )
            # Separate identities for uncertain speakers in each fallback window.
            identity = index if branch == 1 else 100000 + index * 1000 + branch
            try:
                normalized = normalize(segments, offset, length, identity, namespace)
            except (ValueError, TypeError) as exc:
                incomplete.write_text(
                    json.dumps(
                        {
                            "offset": offset,
                            "length": length,
                            "error": str(exc),
                            "raw": raw,
                        },
                        ensure_ascii=False,
                    ),
                    "utf-8",
                )
            else:
                result = {"segments": normalized, "raw": raw}
                _save(saved, result)
                return result
    if length <= 45 or branch >= 8:
        raise RuntimeError(
            "Model output remains incomplete after bounded smaller-window retries; inspect private raw output"
        )
    overlap = min(10, length / 10)
    first_length = length / 2 + overlap / 2
    second_offset = offset + length / 2 - overlap / 2
    first = transcribe_window(
        directory,
        cache_key,
        index,
        offset,
        first_length,
        namespace,
        infer,
        progress,
        branch * 2,
    )
    second = transcribe_window(
        directory,
        cache_key,
        index,
        second_offset,
        first_length,
        namespace,
        infer,
        progress,
        branch * 2 + 1,
    )
    result = {
        "segments": merge(first["segments"], second["segments"]),
        "raw": [first["raw"], second["raw"]],
    }
    _save(saved, result)
    return result


def _save(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False), "utf-8")
    temporary.replace(path)
