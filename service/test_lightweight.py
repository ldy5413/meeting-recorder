"""Contract tests for the experimental CPU path, without downloading any models."""

import importlib.util
from pathlib import Path
import shutil
import subprocess
import uuid
import wave

import pytest

from service.lightweight import SpeakerTimeline, align_tokens
from service.lightweight_models import ASSETS, verify
from service.lightweight_scoring import distance, edit_details, score, score_corpus

NAMESPACE = uuid.UUID("db3f8a2a-7575-4df8-8fcb-6512cc1ee3ab")


@pytest.fixture
def benchmark():
    spec = importlib.util.spec_from_file_location(
        "benchmark_lightweight",
        Path(__file__).resolve().parent.parent / "scripts/benchmark-lightweight.py",
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def turn(start, end, speaker):
    return {"start": start, "end": end, "speaker": speaker}


def test_speakers_at_boundaries_gaps_and_overlaps():
    timeline = SpeakerTimeline(
        [turn(1, 3, "a"), turn(2, 4, "b"), turn(4, 5, "c"), turn(6, 7, "d")]
    )
    assert [timeline.at(t) for t in (0, 1, 2, 3, 4, 5, 6, 7)] == [
        "unknown",
        "a",
        "unknown",
        "b",
        "c",
        "unknown",
        "d",
        "unknown",
    ]


def test_overlapping_windows_of_same_speaker_are_not_two_people():
    timeline = SpeakerTimeline([turn(0, 3, "a"), turn(1, 4, "a")])
    assert timeline.at(2) == timeline.at(3.5) == "a"


def test_preserves_tokens_across_speaker_change_and_absolute_offset():
    timeline = SpeakerTimeline([turn(10, 11, "a"), turn(11, 14, "b")])
    segments = align_tokens(
        ["氧", "化", "硅", "。"], [0, 0.5, 1, 1.5], 10, 12, timeline, NAMESPACE
    )
    assert "".join(s["text"] for s in segments) == "氧化硅。"
    assert [s["speaker"] for s in segments] == ["a", "b"]
    assert [(s["start"], s["end"]) for s in segments] == [(10, 11), (11, 12)]
    assert len({s["id"] for s in segments}) == 2
    assert segments == align_tokens(
        ["氧", "化", "硅", "。"], [0, 0.5, 1, 1.5], 10, 12, timeline, NAMESPACE
    )


def test_long_silence_is_not_assigned_to_previous_token():
    segments = align_tokens(
        ["好", "继续"], [0, 5], 0, 7, SpeakerTimeline([]), NAMESPACE
    )
    assert len(segments) == 2
    assert segments[0]["end"] == 0.6
    assert all(s["speaker"] == "unknown" for s in segments)


def test_punctuation_splits_without_dropping_it():
    segments = align_tokens(
        ["可以", "。", "Next", " step", "."],
        [0, 0.3, 0.6, 0.9, 1.2],
        0,
        2,
        SpeakerTimeline([turn(0, 2, "a")]),
        NAMESPACE,
    )
    assert [s["text"] for s in segments] == ["可以。", "Next step."]


@pytest.mark.parametrize(
    "timestamps", [[0], [0.5, 0], [0, float("nan")], [0, float("inf")], [-1, 0], [0, 3]]
)
def test_invalid_timestamp_output_fails_instead_of_fabricating_alignment(timestamps):
    with pytest.raises(ValueError):
        align_tokens(["a", "b"], timestamps, 0, 2, SpeakerTimeline([]), NAMESPACE)


def test_model_verification_rejects_partial_download(tmp_path):
    (tmp_path / "tokens.txt").write_text("partial", "utf-8")
    with pytest.raises(ValueError, match="incomplete"):
        verify(tmp_path, ["tokens.txt"])


def test_model_verification_rejects_same_size_corruption(tmp_path):
    (tmp_path / "tokens.txt").write_bytes(b"x" * ASSETS["tokens.txt"]["bytes"])
    with pytest.raises(ValueError, match="SHA-256"):
        verify(tmp_path, ["tokens.txt"])


def test_review_escapes_transcripts_and_labels_baseline_as_machine_output(
    tmp_path, benchmark
):
    segment = {
        "start": 0,
        "end": 1,
        "speaker": "unknown",
        "text": '<script>alert("private")</script>',
    }
    benchmark.review_page(
        tmp_path,
        {
            "source_sha256": "0" * 64,
            "segments": [segment],
            "metrics": {"duration_seconds": 5},
        },
        [segment],
    )
    page = (tmp_path / "review.html").read_text("utf-8")
    assert "&lt;script&gt;" in page
    assert '<script>alert("private")</script>' not in page
    assert "非标准答案" in page
    assert 'src="audio.wav"' in page
    assert "https://" not in page


@pytest.mark.skipif(
    not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="FFmpeg required"
)
def test_decode_preserves_packet_gap_and_clip_offset(tmp_path, benchmark):
    source = tmp_path / "packet-gap.mka"
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=16000:duration=2",
            "-af",
            "asetpts=PTS+if(gte(T\\,1)\\,0.25/TB\\,0)",
            "-c:a",
            "pcm_s16le",
            str(source),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    whole, clip = tmp_path / "whole.wav", tmp_path / "clip.wav"
    duration = benchmark.decode_audio(source, whole)
    assert duration == pytest.approx(2.25, abs=0.02)
    with wave.open(str(whole), "rb") as decoded:
        assert decoded.getnframes() / 16000 == pytest.approx(duration, abs=0.02)
        decoded.setpos(int(1.1 * 16000))
        assert decoded.readframes(1600) == b"\0" * 3200
    benchmark.decode_audio(source, clip, offset=0.5, seconds=0.7)
    with wave.open(str(clip), "rb") as decoded:
        assert decoded.getnframes() / 16000 == pytest.approx(0.7, abs=0.001)
        assert any(decoded.readframes(1000))


def scoring_fixture():
    report = {
        "source_sha256": "source",
        "decoded_sha256": "decoded",
        "metrics": {"duration_seconds": 4},
        "raw": [
            {
                "start": 1,
                "tokens": ["无", "定", "形", "风", "。"],
                "timestamps": [0, 0.1, 0.2, 0.3, 0.4],
            }
        ],
    }
    reference = {
        "reference_kind": "human",
        "sourceSha256": "source",
        "decodedSha256": "decoded",
        "samples": [
            {"start": 1, "end": 2, "reference_text": "无定形峰。", "reviewed": True}
        ],
    }
    return report, reference


def test_score_counts_spelling_error_and_ignores_punctuation():
    report, reference = scoring_fixture()
    result = score(report, reference)
    assert result["samples"][0]["character_error_rate"] == 0.25
    assert result["samples"][0]["edit_distance"] == 1


def test_score_rejects_unreviewed_or_mismatched_audio():
    report, reference = scoring_fixture()
    reference["samples"][0]["reviewed"] = False
    with pytest.raises(ValueError, match="No reviewed samples"):
        score(report, reference)
    reference["samples"][0]["reviewed"] = True
    reference["decodedSha256"] = "different clip"
    with pytest.raises(ValueError, match="does not match"):
        score(report, reference)


def test_score_uses_absolute_token_times_without_aggregating_overlapping_samples():
    report, reference = scoring_fixture()
    reference["samples"] = [
        {"start": 1, "end": 1.2, "reference_text": "无定", "reviewed": True}
    ] * 2
    result = score(report, reference)
    assert len(result["samples"]) == 2
    assert all(s["character_error_rate"] == 0 for s in result["samples"])
    assert "character_error_rate" not in result


@pytest.fixture
def corpus_scoring():
    corpus = {
        "samples": [
            {
                "id": "a",
                "meeting_id": "meeting",
                "split": "holdout",
                "decoded_sha256": "audio-a",
            },
            {
                "id": "b",
                "meeting_id": "meeting",
                "split": "holdout",
                "decoded_sha256": "audio-b",
            },
        ]
    }
    report = {
        "status": "complete",
        "configuration": {"corpus_sha256": "corpus", "sample_ids": ["a", "b"]},
        "results": [
            {
                "sample_id": "a",
                "decoded_sha256": "audio-a",
                "text": "无定形风，12 nm。",
            },
            {"sample_id": "b", "decoded_sha256": "audio-b", "text": "谢谢"},
        ],
    }
    reference = {
        "reference_kind": "human",
        "reviewer": "test fixture",
        "corpus_sha256": "corpus",
        "samples": [
            {
                "sample_id": "a",
                "decoded_sha256": "audio-a",
                "reference_text": "无定形峰，12 nm。",
                "reviewed": True,
            },
            {
                "sample_id": "b",
                "decoded_sha256": "audio-b",
                "reference_text": "",
                "reviewed": True,
                "no_speech": True,
            },
        ],
    }
    return corpus, report, reference


def test_corpus_scores_silence_hallucinations_as_insertions(corpus_scoring):
    result = score_corpus(*corpus_scoring, "corpus")
    total = result["splits"]["holdout"]
    assert total["all_split_samples_reviewed_and_evaluated"]
    assert total["reference_characters"] == 8
    assert total["edit_distance"] == 3
    assert total["character_error_rate"] == 3 / 8
    assert not total["meets_sample_cer_5pct"]
    assert result["samples"][1]["silence_insertions"] == 2


def test_corpus_does_not_pass_a_cherry_picked_subset(corpus_scoring):
    corpus, report, reference = corpus_scoring
    report["results"][0]["text"] = reference["samples"][0]["reference_text"]
    reference["samples"][1]["reviewed"] = False
    result = score_corpus(corpus, report, reference, "corpus")["splits"]["holdout"]
    assert result["character_error_rate"] == 0
    assert not result["all_split_samples_reviewed_and_evaluated"]
    assert not result["meets_sample_cer_5pct"]


@pytest.mark.parametrize("target", ["report", "reference", "corpus"])
def test_corpus_rejects_mismatched_fingerprints(corpus_scoring, target):
    corpus, report, reference = corpus_scoring
    if target == "report":
        report["results"][0]["decoded_sha256"] = "wrong"
    elif target == "reference":
        reference["samples"][0]["decoded_sha256"] = "wrong"
    else:
        reference["corpus_sha256"] = "wrong"
    with pytest.raises(ValueError, match="fingerprint mismatch"):
        score_corpus(corpus, report, reference, "corpus")


def test_corpus_rejects_missing_and_duplicate_outputs(corpus_scoring):
    corpus, report, reference = corpus_scoring
    report["results"].append(report["results"][0])
    with pytest.raises(ValueError, match="Duplicate"):
        score_corpus(corpus, report, reference, "corpus")
    report["results"] = report["results"][:1]
    with pytest.raises(ValueError, match="Missing"):
        score_corpus(corpus, report, reference, "corpus")


def test_corpus_rejects_machine_references_and_implicit_silence(corpus_scoring):
    corpus, report, reference = corpus_scoring
    reference["reference_kind"] = "machine"
    with pytest.raises(ValueError, match="human"):
        score_corpus(corpus, report, reference, "corpus")
    reference["reference_kind"] = "human"
    reference["samples"][1]["no_speech"] = False
    with pytest.raises(ValueError, match="Empty gold"):
        score_corpus(corpus, report, reference, "corpus")


def test_corpus_keeps_unintelligible_samples_in_coverage_denominator(corpus_scoring):
    corpus, report, reference = corpus_scoring
    reference["samples"][1]["unintelligible"] = True
    result = score_corpus(corpus, report, reference, "corpus")["splits"]["holdout"]
    assert result["reviewed_samples"] == 1
    assert result["total_split_samples"] == 2
    assert not result["all_split_samples_reviewed_and_evaluated"]


@pytest.mark.parametrize(
    "reference,hypothesis",
    [
        ("无定形峰", "无定形风"),
        ("abcdef", "axcdqef"),
        ("oneonone", "王王王"),
        ("", "幻觉"),
        ("漏字", ""),
        ("aaaaab", "baaab"),
        ("", ""),
    ],
)
def test_error_display_reconstructs_both_texts_and_minimal_edit_cost(
    reference, hypothesis
):
    result = edit_details(reference, hypothesis)
    assert "".join(s["reference"] for s in result["spans"]) == reference
    assert "".join(s["hypothesis"] for s in result["spans"]) == hypothesis
    assert (
        sum(result["counts"].values())
        == result["edit_distance"]
        == distance(reference, hypothesis)
    )
