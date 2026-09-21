"""Deterministic chunk boundaries and conservative overlap de-duplication."""

import math
import re
import uuid


def windows(duration: float, length: float = 2700, overlap: float = 20):
    if (
        not math.isfinite(duration)
        or duration <= 0
        or not 0 <= overlap < length <= 3600
    ):
        raise ValueError("Invalid duration/chunk settings")
    offset = 0.0
    while offset < duration:
        yield offset, min(length, duration - offset)
        if offset + length >= duration:
            return
        offset += length - overlap


def normalize(raw: list, offset: float, length: float, chunk: int, namespace: str):
    if not isinstance(raw, list) or any(not isinstance(item, dict) for item in raw):
        raise ValueError("Invalid model segment structure")
    result = []
    for i, item in enumerate(raw):
        start = float(item.get("start_time", item.get("start", -1)))
        end = float(item.get("end_time", item.get("end", -1)))
        text = item.get("text", "")
        speaker = item.get("speaker_id", item.get("speaker", "unknown"))
        if (
            not all(math.isfinite(t) for t in (start, end))
            or start < 0
            or start > length
            or end < start
            or end > length + 2
        ):
            raise ValueError("Invalid model timestamps")
        if not isinstance(text, str):
            raise ValueError("Invalid model text")
        if not text.strip():
            continue
        result.append(
            {
                "id": str(uuid.uuid5(uuid.UUID(namespace), f"{chunk}:{i}")),
                "start": offset + start,
                "end": offset + min(end, length),
                "speaker": f"chunk-{chunk + 1}:speaker-{speaker}",
                "text": text,
            }
        )
    return result


def merge(previous: list, incoming: list):
    """Only remove identical text with matching overlapping time intervals.

    Uncertain near-matches and speakers are deliberately preserved for correction.
    This avoids deleting repeated words in unrelated turns.
    """
    result = list(previous)
    for item in incoming:
        text = re.sub(r"[\W_]+", "", item["text"].casefold())
        duplicate = False
        for old in reversed(previous):
            if old["end"] < item["start"] - 3:
                continue
            overlap = min(old["end"], item["end"]) - max(old["start"], item["start"])
            span = max(
                0.01, min(old["end"] - old["start"], item["end"] - item["start"])
            )
            if (
                overlap / span >= 0.5
                and text
                and text == re.sub(r"[\W_]+", "", old["text"].casefold())
            ):
                duplicate = True
                break
        if not duplicate:
            result.append(item)
    return sorted(result, key=lambda s: (s["start"], s["end"], s["id"]))
