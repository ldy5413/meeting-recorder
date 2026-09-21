"""Meeting-local speaker reconciliation from multiple acoustic samples per label.

Text and chunk-local speaker numbers are never used as identity evidence.
Embeddings stay in the job directory and are not shared between meetings.
"""

import hashlib
import heapq
import json
import math
import os
from pathlib import Path
import re
import subprocess
import wave

from service.adaptive import _save

MODEL_REPO = "Wespeaker/wespeaker-voxceleb-resnet34-LM"
MODEL_REVISION = "f0c48c298fd835726c27956a5d617bad7115627e"
MODEL_FILE = "voxceleb_resnet34_LM.onnx"
MODEL_SHA256 = "7bb2f06e9df17cdf1ef14ee8a15ab08ed28e8d0ef5054ee135741560df2ec068"
VERSION = 2


def non_speech(text):
    return bool(
        re.fullmatch(
            r"\s*\[(?:silence|music|noise|background noise|静音|音乐|噪音)\]\s*",
            text,
            re.IGNORECASE,
        )
    )


def digest(path):
    with open(path, "rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def model_path():
    path = Path(
        os.getenv(
            "MEETING_SPEAKER_MODEL",
            str(Path(__file__).resolve().parent.parent / ".local/models" / MODEL_FILE),
        )
    )
    if not path.is_file():
        raise RuntimeError(
            "缺少声纹模型，请在转录服务环境运行 python scripts/download-speaker-model.py"
        )
    if digest(path) != MODEL_SHA256:
        raise RuntimeError(
            "声纹模型校验失败，请重新运行 scripts/download-speaker-model.py"
        )
    return path


def unit(vector):
    values = [float(v) for v in vector]
    norm = math.sqrt(sum(v * v for v in values))
    if not values or not math.isfinite(norm) or norm < 1e-10:
        raise ValueError("Invalid speaker embedding")
    return [v / norm for v in values]


def cosine(a, b):
    if len(a) != len(b):
        raise ValueError("Inconsistent speaker embedding dimensions")
    return sum(x * y for x, y in zip(a, b))


def profile(vectors):
    """Discard outlying clips before averaging (e.g. a turn with an interruption)."""
    vectors = [unit(v) for v in vectors]
    if not vectors:
        return None
    medoid = max(vectors, key=lambda v: sum(cosine(v, w) for w in vectors))
    clean = [v for v in vectors if cosine(v, medoid) >= 0.5]
    return unit([sum(values) for values in zip(*clean)])


def reconcile(segments, embeddings, names=None, threshold=0.65):
    """Legacy label-level baseline retained for diagnostics and comparisons.

    Same-window merges require stronger acoustic evidence. Confirmed names that
    disagree cannot merge. Missing/short samples are explicitly unresolved.
    """
    if not math.isfinite(threshold) or not 0 < threshold <= 1:
        raise ValueError("Speaker threshold must be in (0, 1]")
    names = names or {}
    all_labels = list(dict.fromkeys(s["speaker"] for s in segments))
    labels = list(
        dict.fromkeys(s["speaker"] for s in segments if not non_speech(s["text"]))
    )
    vectors = {s: profile(embeddings.get(s, [])) for s in labels}
    windows = {}
    for label in labels:
        match = re.fullmatch(r"(chunk-\d+):speaker-.+", label)
        windows[label] = match[1] if match else None
    scores = {}
    for i, a in enumerate(labels):
        for b in labels[i + 1 :]:
            conflict = (
                names.get(a, "").strip()
                and names.get(b, "").strip()
                and names[a].strip() != names[b].strip()
            )
            scores[frozenset((a, b))] = (
                cosine(vectors[a], vectors[b])
                if vectors[a] is not None and vectors[b] is not None and not conflict
                else -1.0
            )
            if (
                windows[a] is not None
                and windows[a] == windows[b]
                and scores[frozenset((a, b))] < max(0.8, threshold)
            ):
                scores[frozenset((a, b))] = -1.0
    insufficient = [label for label in labels if vectors[label] is None]
    clusters = [[label] for label in labels if vectors[label] is not None]
    merges = []
    while True:
        best, pair = threshold, None
        for i, left in enumerate(clusters):
            for j in range(i + 1, len(clusters)):
                score = min(
                    scores[frozenset((a, b))] for a in left for b in clusters[j]
                )
                if score >= best:
                    best, pair = score, (i, j)
        if pair is None:
            break
        i, j = pair
        merges.append({"left": clusters[i][:], "right": clusters[j][:], "score": best})
        clusters[i].extend(clusters.pop(j))
    mapping = {label: "non-speech" for label in all_labels if label not in labels}
    mapping.update(
        {label: f"unresolved-{i}" for i, label in enumerate(insufficient, 1)}
    )
    for i, cluster in enumerate(clusters, 1):
        for label in cluster:
            mapping[label] = f"speaker-{i}"
    return {
        "segments": [
            {
                **s,
                "speaker": "non-speech"
                if non_speech(s["text"])
                else mapping[s["speaker"]],
            }
            for s in segments
        ],
        "speaker_resolution": {
            "version": 1,
            "model": MODEL_REPO,
            "model_sha256": MODEL_SHA256,
            "threshold": threshold,
            "original_count": len(all_labels),
            "resolved_count": len(clusters),
            "unresolved_count": len(insufficient),
            "non_speech_segments": sum(non_speech(s["text"]) for s in segments),
            "mapping": mapping,
            "insufficient_audio": insufficient,
            "merges": merges,
        },
    }


def sample_ranges(segments):
    """Choose up to five clean, separated turns per local speaker, 2–8 seconds."""
    groups = {}
    for s in segments:
        groups.setdefault(s["speaker"], [])
        if non_speech(s["text"]):
            continue
        start, end = s["start"] + 0.2, s["end"] - 0.2
        # Subtract other speakers' annotated turns to avoid overlapping voices.
        ranges = [(start, end)]
        for other in segments:
            if (
                other["speaker"] == s["speaker"]
                or other["end"] <= start
                or other["start"] >= end
            ):
                continue
            pieces = []
            for a, b in ranges:
                if other["end"] <= a or other["start"] >= b:
                    pieces.append((a, b))
                else:
                    pieces.extend(
                        ((a, min(b, other["start"])), (max(a, other["end"]), b))
                    )
            ranges = pieces
        for a, b in ranges:
            if b - a >= 2:
                length = min(8, b - a)
                middle = (a + b) / 2
                groups[s["speaker"]].append((middle - length / 2, middle + length / 2))
    selected = {}
    for label, ranges in groups.items():
        chosen = []
        for a, b in sorted(ranges, key=lambda r: (-(r[1] - r[0]), r[0])):
            if all(b <= c or a >= d for c, d in chosen):
                chosen.append((round(a, 4), round(b, 4)))
            if len(chosen) == 5:
                break
        selected[label] = chosen
    return selected


def turn_samples(segments):
    """One bounded sample per turn; overlap can match a voice but cannot seed it."""
    samples = {}
    speech = [s for s in segments if not non_speech(s["text"])]
    for s in speech:
        start, end = s["start"] + 0.1, s["end"] - 0.1
        ranges = [(start, end)]
        for other in speech:
            if other["speaker"] == s["speaker"]:
                continue
            pieces = []
            for a, b in ranges:
                if other["end"] <= a or other["start"] >= b:
                    pieces.append((a, b))
                else:
                    pieces.extend(
                        ((a, min(b, other["start"])), (max(a, other["end"]), b))
                    )
            ranges = pieces
        a, b = max(ranges, key=lambda r: r[1] - r[0], default=(start, start))
        clean = b - a >= 0.8
        if not clean:
            a, b = start, end
        if b - a < 0.8:
            continue
        length = min(8, b - a)
        middle = (a + b) / 2
        samples[s["id"]] = {
            "start": round(middle - length / 2, 4),
            "end": round(middle + length / 2, 4),
            "clean": clean,
        }
    return samples


def _average_clusters(vectors, names, threshold):
    """Average-link AHC with hard name constraints and a quadratic score cache."""
    clusters = {i: [i] for i in range(len(vectors))}
    identities = {i: {names[i]} - {""} for i in clusters}
    scores, queue = {}, []
    for i in clusters:
        for j in range(i):
            score = cosine(vectors[i], vectors[j])
            scores[j, i] = score
            if score >= threshold and len(identities[i] | identities[j]) <= 1:
                heapq.heappush(queue, (-score, j, i))
    next_id = len(clusters)
    while queue:
        _, i, j = heapq.heappop(queue)
        if i not in clusters or j not in clusters:
            continue
        left, right = clusters.pop(i), clusters.pop(j)
        combined = identities[i] | identities[j]
        for k in clusters:
            score = (
                scores.pop(tuple(sorted((i, k)))) * len(left)
                + scores.pop(tuple(sorted((j, k)))) * len(right)
            ) / (len(left) + len(right))
            scores[k, next_id] = score
            if score >= threshold and len(combined | identities[k]) <= 1:
                heapq.heappush(queue, (-score, k, next_id))
        scores.pop((i, j))
        clusters[next_id] = left + right
        identities[next_id] = combined
        next_id += 1
    return list(clusters.values())


def reconcile_turns(
    segments, embeddings, samples, names=None, threshold=0.65, expected_speakers=None
):
    """Discover recurring voices, then match turns to fixed voice prototypes.

    Weak assignments never update prototypes. A reliable existing label can
    carry its uncertain turns, but a clear acoustic match can split that label.
    A supplied count only relaxes consolidation of supported voices; it never
    forces unrelated voices together or turns missing audio into an identity.
    """
    if not math.isfinite(threshold) or not 0 < threshold <= 1:
        raise ValueError("Speaker threshold must be in (0, 1]")
    if expected_speakers is not None and (
        type(expected_speakers) is not int or not 1 <= expected_speakers <= 50
    ):
        raise ValueError("Expected speakers must be an integer between 1 and 50")
    names = {k: v.strip() for k, v in (names or {}).items() if v.strip()}
    speech = [s for s in segments if not non_speech(s["text"])]
    by_id = {s["id"]: s for s in speech}
    vectors = {
        sid: unit(v) for sid, v in embeddings.items() if v is not None and sid in by_id
    }
    duration = {sid: s["end"] - s["start"] for sid, s in samples.items()}
    seeds = [
        s["id"]
        for s in speech
        if s["id"] in vectors and samples[s["id"]]["clean"] and duration[s["id"]] >= 2
    ]
    # Bound AHC memory on long recordings while representing rare input labels.
    buckets = {}
    for sid in seeds:
        buckets.setdefault(by_id[sid]["speaker"], []).append(sid)
    for bucket in buckets.values():
        bucket.sort(key=lambda sid: -duration[sid])
    seeds = [
        bucket[i]
        for i in range(max(map(len, buckets.values()), default=0))
        for bucket in buckets.values()
        if i < len(bucket)
    ][:1200]
    clusters = _average_clusters(
        [vectors[sid] for sid in seeds],
        [names.get(by_id[sid]["speaker"], "") for sid in seeds],
        max(0.45, threshold - 0.1),
    )
    candidates = []
    for cluster in clusters:
        members = [seeds[i] for i in cluster]
        identity = {names.get(by_id[sid]["speaker"], "") for sid in members} - {""}
        candidates.append(
            {
                "members": members,
                "vector": profile([vectors[sid] for sid in members]),
                "names": identity,
                "seconds": sum(duration[sid] for sid in members),
            }
        )
    cores = [
        c
        for c in candidates
        if (len(c["members"]) >= 3 and c["seconds"] >= 8) or c["names"]
    ]
    if not cores:
        # Short recordings may not contain three turns by any participant.
        cores = candidates
    cores.sort(key=lambda c: (-len(c["members"]), -c["seconds"]))
    consolidated = []
    for core in cores:
        compatible = [
            c
            for c in consolidated
            if len(c["names"] | core["names"]) <= 1
            and cosine(c["vector"], core["vector"]) >= threshold
        ]
        if compatible:
            target = max(compatible, key=lambda c: cosine(c["vector"], core["vector"]))
            target["members"].extend(core["members"])
            target["names"] |= core["names"]
            # Keep the larger, fixed prototype: no weak transitive chaining.
        else:
            consolidated.append(core)
    cores = consolidated
    guided_merges = []
    while expected_speakers is not None and len(cores) > expected_speakers:
        choices = [
            (cosine(a["vector"], b["vector"]), i, j)
            for i, a in enumerate(cores)
            for j, b in enumerate(cores)
            if i < j and len(a["names"] | b["names"]) <= 1
        ]
        score, i, j = max(choices, default=(-1, 0, 0))
        if score < max(0.5, threshold - 0.15):
            break
        guided_merges.append({"score": score})
        cores[i]["members"].extend(cores[j]["members"])
        cores[i]["names"] |= cores[j]["names"]
        cores.pop(j)
    assignments, matches = {}, {}
    minimum = max(0.5, threshold - 0.15)
    for s in speech:
        sid, label = s["id"], s["speaker"]
        ranking = sorted(
            [
                (cosine(vectors[sid], c["vector"]), i)
                for i, c in enumerate(cores)
                if sid in vectors
                and len(c["names"] | ({names[label]} if label in names else set())) <= 1
            ],
            reverse=True,
        )
        score, best = ranking[0] if ranking else (-1, None)
        margin = score - (ranking[1][0] if len(ranking) > 1 else -1)
        required = minimum
        if sid in samples and (duration[sid] < 2 or not samples[sid]["clean"]):
            required = max(required, 0.6)
        assignments[sid] = best if score >= required and margin >= 0.1 else None
        if assignments[sid] is not None and label in names:
            cores[best]["names"].add(names[label])
        matches[sid] = {
            "score": score if ranking else None,
            "margin": margin if ranking else None,
            "method": "acoustic" if assignments[sid] is not None else "unresolved",
        }
    # Preserve uncertain turns only when their existing label has repeated,
    # overwhelmingly consistent evidence. Never let these votes train a voice.
    groups = {}
    for s in speech:
        groups.setdefault(s["speaker"], []).append(s["id"])
    for members in groups.values():
        votes = {}
        for sid in members:
            if assignments[sid] is not None and samples[sid]["clean"]:
                target = assignments[sid]
                votes[target] = votes.get(target, 0) + 1
        if not votes:
            continue
        target = max(votes, key=votes.get)
        support = votes[target]
        if support < 3 or support / sum(votes.values()) < 0.9:
            continue
        if support / len(members) < 0.5:
            continue
        for sid in members:
            if assignments[sid] is None:
                assignments[sid] = target
                matches[sid]["method"] = "retained_label"
    ids, unresolved, segment_mapping, label_mapping = {}, {}, {}, {}
    output = []
    for s in segments:
        if non_speech(s["text"]):
            label = "non-speech"
        elif assignments[s["id"]] is None:
            label = unresolved.setdefault(
                s["speaker"], f"unresolved-{len(unresolved) + 1}"
            )
        else:
            label = ids.setdefault(assignments[s["id"]], f"speaker-{len(ids) + 1}")
        segment_mapping[s["id"]] = label
        label_mapping.setdefault(s["speaker"], set()).add(label)
        output.append({**s, "speaker": label})
    return {
        "segments": output,
        "speaker_resolution": {
            "version": VERSION,
            "model": MODEL_REPO,
            "model_sha256": MODEL_SHA256,
            "threshold": threshold,
            "expected_speakers": expected_speakers,
            "count_matches": expected_speakers is None or len(ids) == expected_speakers,
            "original_count": len(label_mapping),
            "resolved_count": len(ids),
            "unresolved_count": len(unresolved),
            "unresolved_segments": sum(a is None for a in assignments.values()),
            "retained_label_segments": sum(
                m["method"] == "retained_label" for m in matches.values()
            ),
            "non_speech_segments": len(segments) - len(speech),
            "mapping": {
                k: next(iter(v)) for k, v in label_mapping.items() if len(v) == 1
            },
            "segment_mapping": segment_mapping,
            "matches": matches,
            "guided_merges": guided_merges,
        },
    }


class Encoder:
    def __init__(self, path):
        import onnxruntime as ort
        import torch

        self.torch = torch
        torch.set_num_threads(2)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(
            str(path), sess_options=options, providers=["CPUExecutionProvider"]
        )

    def encode(self, pcm):
        import numpy as np
        from torchaudio.compliance.kaldi import fbank

        # Official WeSpeaker frontend: 16 kHz PCM scale, 80-bin Kaldi filterbank,
        # 25 ms Hamming windows, 10 ms hop, per-clip mean normalization.
        waveform = self.torch.from_numpy(
            np.frombuffer(pcm, dtype="<i2").astype(np.float32)
        )
        if waveform.numel() < 12800 or waveform.square().mean().sqrt().item() < 10:
            return None
        with self.torch.inference_mode():
            features = fbank(
                waveform.unsqueeze(0),
                num_mel_bins=80,
                frame_length=25,
                frame_shift=10,
                dither=0,
                sample_frequency=16000,
                window_type="hamming",
                use_energy=False,
            )
            features -= features.mean(dim=0)
        result = self.session.run(["embs"], {"feats": features.unsqueeze(0).numpy()})[0]
        return unit(result.reshape(-1))


def resolve_speakers(
    audio,
    segments,
    directory,
    progress=lambda _: None,
    names=None,
    expected_speakers=None,
):
    directory = Path(directory)
    ranges = turn_samples(segments)
    if not ranges:
        result = reconcile_turns(
            segments, {}, ranges, names, expected_speakers=expected_speakers
        )
        _save(directory / "speaker-resolution.json", result["speaker_resolution"])
        return result
    progress("校验声纹模型")
    path = model_path()
    fingerprint = {
        "version": VERSION,
        "audio": digest(audio),
        "model": MODEL_SHA256,
        "ranges": ranges,
    }
    key = hashlib.sha256(json.dumps(fingerprint, sort_keys=True).encode()).hexdigest()[
        :20
    ]
    cache = directory / f"speaker-embeddings-{key}.json"
    vectors = json.loads(cache.read_text("utf-8")) if cache.exists() else {}
    pending = [sid for sid in ranges if sid not in vectors]
    if pending:
        progress("准备声纹音频")
        wav = directory / "speakers.wav"
        try:
            subprocess.run(
                [
                    os.getenv("FFMPEG", "ffmpeg"),
                    "-nostdin",
                    "-y",
                    "-v",
                    "error",
                    "-i",
                    str(audio),
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-c:a",
                    "pcm_s16le",
                    str(wav),
                ],
                check=True,
                capture_output=True,
                timeout=600,
            )
            encoder = Encoder(path)
            with wave.open(str(wav), "rb") as source:
                for sid in pending:
                    progress(f"提取声纹 {len(vectors) + 1}/{len(ranges)}")
                    start, end = ranges[sid]["start"], ranges[sid]["end"]
                    vector = None
                    if start * 16000 < source.getnframes():
                        source.setpos(int(start * 16000))
                        vector = encoder.encode(
                            source.readframes(int((end - start) * 16000))
                        )
                    vectors[sid] = vector
                    _save(cache, vectors)
        finally:
            wav.unlink(missing_ok=True)
    progress("统一整场会议说话人")
    result = reconcile_turns(
        segments,
        vectors,
        ranges,
        names,
        threshold=float(os.getenv("MEETING_SPEAKER_THRESHOLD", "0.65")),
        expected_speakers=expected_speakers,
    )
    _save(directory / "speaker-resolution.json", result["speaker_resolution"])
    return result
