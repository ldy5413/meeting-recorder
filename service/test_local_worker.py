import pytest

from service.lightweight import SpeakerTimeline
from service.local_worker import run, speaker_for_interval, speech_pieces


def test_segment_speaker_does_not_claim_mixed_speech_as_one_person():
    timeline = SpeakerTimeline(
        [
            {"start": 0, "end": 5, "speaker": "speaker-1"},
            {"start": 5, "end": 10, "speaker": "speaker-2"},
        ]
    )
    assert speaker_for_interval(0, 10, timeline) == "unknown"
    assert speaker_for_interval(0, 5, timeline) == "speaker-1"
    assert list(speech_pieces(0, 10, timeline)) == [(0, 5), (5, 10)]


def test_overlapping_speakers_remain_unknown():
    timeline = SpeakerTimeline(
        [
            {"start": 0, "end": 5, "speaker": "speaker-1"},
            {"start": 0, "end": 5, "speaker": "speaker-2"},
        ]
    )
    assert speaker_for_interval(0, 5, timeline) == "unknown"


def test_invalid_language_never_selects_a_fallback_model():
    with pytest.raises(ValueError, match="Invalid task/language"):
        run({"language": "auto", "task": "transcribe"})
