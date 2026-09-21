"""Experimental, local CPU transcription. Not registered in the production API.

The Python layer measures the same sherpa-onnx native runtime that can be bundled
later. It does not establish packaged Electron or clean-machine compatibility.
"""

import bisect
import gc
import math
from pathlib import Path
import time
import uuid
import wave

from service.lightweight_models import verify

SAMPLE_RATE = 16000
VERSION = 1


class SpeakerTimeline:
    """Intersect token onsets with diarization turns; never infer names from text."""

    def __init__(self, turns):
        events = {}
        for turn in turns:
            start, end = float(turn["start"]), float(turn["end"])
            if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end):
                raise ValueError("Invalid speaker turn")
            speaker = str(turn["speaker"])
            events.setdefault(start, []).append((speaker, 1))
            events.setdefault(end, []).append((speaker, -1))
        self.times = sorted(events)
        self.labels = []
        counts = {}
        for timestamp in self.times:
            for speaker, delta in events[timestamp]:
                counts[speaker] = counts.get(speaker, 0) + delta
            active = [s for s, n in counts.items() if n > 0]
            self.labels.append(active[0] if len(active) == 1 else "unknown")

    def at(self, timestamp):
        index = bisect.bisect_right(self.times, timestamp) - 1
        return self.labels[index] if index >= 0 else "unknown"


def align_tokens(tokens, timestamps, start, end, timeline, namespace):
    """Preserve token text and expose uncertain/overlapping speakers as unknown.

    Token starts are CTC emission times. End times are approximate: next token
    onset, capped to 0.6 seconds after the current token and the VAD boundary.
    These are playback anchors, not forced-alignment or timestamp-accuracy scores.
    """
    if len(tokens) != len(timestamps):
        raise ValueError("Model token/timestamp lengths differ")
    if not (0 <= start < end and math.isfinite(end)):
        raise ValueError("Invalid speech boundary")
    points = [start + float(t) for t in timestamps]
    if any(
        not math.isfinite(t) or t < start or t > end + 0.1 for t in points
    ) or points != sorted(points):
        raise ValueError("Invalid model token timestamps")
    segments = []
    for index, (token, point) in enumerate(zip(tokens, points)):
        if not isinstance(token, str):
            raise ValueError("Invalid model token")
        point = min(point, end)
        if not token:
            continue
        speaker = timeline.at(point)
        next_point = points[index + 1] if index + 1 < len(points) else end
        token_end = min(end, point + 0.6, max(point, next_point))
        previous = segments[-1] if segments else None
        if (
            previous
            and previous["speaker"] == speaker
            and point - previous["end"] <= 1.0
            and point - previous["start"] < 15
            and not previous["text"].endswith(("。", "！", "？", ".", "!", "?"))
        ):
            previous["text"] += token
            previous["end"] = token_end
        else:
            segments.append(
                {
                    "id": str(uuid.uuid5(namespace, f"{start:.6f}:{index}")),
                    "start": point,
                    "end": token_end,
                    "speaker": speaker,
                    "text": token,
                }
            )
    for segment in segments:
        segment["text"] = segment["text"].strip()
    return [s for s in segments if s["text"]]


def diarize(wav, models, threads, progress, threshold=0.5, embedding_model=None):
    import numpy as np
    import sherpa_onnx as sherpa

    config = sherpa.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa.OfflineSpeakerSegmentationPyannoteModelConfig(
                model=str(models / "segmentation.onnx"), window_shift_ratio=0.1
            ),
            num_threads=threads,
            provider="cpu",
        ),
        embedding=sherpa.SpeakerEmbeddingExtractorConfig(
            model=str(embedding_model or models / "wespeaker.onnx"),
            num_threads=threads,
            provider="cpu",
        ),
        clustering=sherpa.FastClusteringConfig(num_clusters=-1, threshold=threshold),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    if not config.validate():
        raise ValueError("Invalid diarization configuration")
    engine = sherpa.OfflineSpeakerDiarization(config)
    with wave.open(str(wav), "rb") as source:
        samples = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2")
        samples = samples.astype(np.float32) / 32768.0
    last = -1

    def callback(done, total):
        nonlocal last
        percent = int(100 * done / max(1, total))
        if percent // 10 != last:
            progress(f"diarization {percent}%")
            last = percent // 10
        return 0

    result = engine.process(samples, callback=callback).sort_by_start_time()
    turns = [
        {
            "start": float(r.start),
            "end": float(r.end),
            "speaker": f"speaker-{r.speaker + 1}",
        }
        for r in result
    ]
    del samples, engine
    gc.collect()
    return turns


def transcribe(
    wav,
    models,
    source_hash,
    threads=4,
    progress=print,
    speakers=True,
    speaker_threshold=0.5,
):
    import numpy as np
    import sherpa_onnx as sherpa

    models = Path(models)
    if threads < 1:
        raise ValueError("threads must be positive")
    if not math.isfinite(speaker_threshold) or not 0 < speaker_threshold < 2:
        raise ValueError("Invalid speaker clustering threshold")
    verify(models)
    with wave.open(str(wav), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (
            1,
            2,
            SAMPLE_RATE,
        ):
            raise ValueError("Expected mono 16 kHz PCM16 WAV")
        duration = source.getnframes() / SAMPLE_RATE
    if duration <= 0:
        raise ValueError("Empty audio")
    started = time.monotonic()
    turns = (
        diarize(wav, models, threads, progress, speaker_threshold) if speakers else []
    )
    diarization_seconds = time.monotonic() - started
    timeline = SpeakerTimeline(turns)
    progress("loading SenseVoice INT8 (CPU)")
    recognizer = sherpa.OfflineRecognizer.from_sense_voice(
        model=str(models / "sensevoice.int8.onnx"),
        tokens=str(models / "tokens.txt"),
        num_threads=threads,
        provider="cpu",
        language="auto",
        use_itn=True,
    )
    config = sherpa.VadModelConfig()
    config.silero_vad.model = str(models / "silero.onnx")
    config.silero_vad.min_silence_duration = 0.5
    config.silero_vad.max_speech_duration = 20
    config.sample_rate = SAMPLE_RATE
    config.num_threads = 1
    config.provider = "cpu"
    vad = sherpa.VoiceActivityDetector(config, buffer_size_in_seconds=60)
    namespace = uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"sensevoice:{VERSION}:{source_hash}:{speakers}:{speaker_threshold}",
    )
    raw, segments = [], []

    def drain():
        while not vad.empty():
            speech = vad.front
            start = speech.start / SAMPLE_RATE
            end = min(duration, start + len(speech.samples) / SAMPLE_RATE)
            if start >= duration:
                vad.pop()
                continue
            stream = recognizer.create_stream()
            stream.accept_waveform(SAMPLE_RATE, speech.samples)
            recognizer.decode_stream(stream)
            result = stream.result
            text = result.text
            tokens, timestamps = list(result.tokens), list(result.timestamps)
            raw.append(
                {
                    "start": start,
                    "end": end,
                    "text": text,
                    "tokens": tokens,
                    "timestamps": timestamps,
                }
            )
            if text.strip():
                if not tokens:
                    raise ValueError("Nonempty transcript has no token timestamps")
                segments.extend(
                    align_tokens(tokens, timestamps, start, end, timeline, namespace)
                )
            vad.pop()

    with wave.open(str(wav), "rb") as source:
        frames = 0
        last = -1
        while pcm := source.readframes(512):
            samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
            frames += len(samples)
            if len(samples) < 512:
                samples = np.pad(samples, (0, 512 - len(samples)))
            vad.accept_waveform(samples)
            drain()
            percent = int(100 * frames / source.getnframes())
            if percent // 10 != last:
                progress(f"transcription {percent}%")
                last = percent // 10
        vad.flush()
        drain()
    return {
        "segments": segments,
        "speaker_turns": turns,
        "raw": raw,
        "metrics": {
            "duration_seconds": duration,
            "diarization_seconds": diarization_seconds,
            "asr_seconds": time.monotonic() - started - diarization_seconds,
            "vad_windows": len(raw),
            "speaker_count": len({s["speaker"] for s in turns}),
            "unknown_segments": sum(s["speaker"] == "unknown" for s in segments),
        },
        "configuration": {
            "version": VERSION,
            "runtime": sherpa.__version__,
            "provider": "cpu",
            "threads": threads,
            "language": "auto",
            "use_itn": True,
            "max_speech_seconds": 20,
            "speakers": speakers,
            "clustering_threshold": speaker_threshold,
            "timestamp_method": "CTC token onsets; approximate token ends capped at 0.6 s",
            "context_support": False,
        },
    }
