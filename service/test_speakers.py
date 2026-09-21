import json
import math
import sqlite3
import uuid
from types import SimpleNamespace

import pytest

from service.speakers import reconcile, sample_ranges, profile
from service.speakers import reconcile_turns, turn_samples


def segment(label, start=0, end=5, text="speech"):
    return {
        "id": str(uuid.uuid4()),
        "start": start,
        "end": end,
        "speaker": label,
        "text": text,
    }


def test_permuted_speaker_ids_reconcile_across_chunks_and_fallback_windows():
    a, b, c, d = [
        "chunk-1:speaker-0",
        "chunk-1:speaker-1",
        "chunk-2:speaker-1",
        "chunk-100003:speaker-0",
    ]
    original = [segment(a), segment(b, 5, 10), segment(c, 10, 15), segment(d, 15, 20)]
    result = reconcile(
        original, {a: [[1, 0]], b: [[0, 1]], c: [[0.99, 0.01]], d: [[0.02, 0.98]]}
    )
    labels = [s["speaker"] for s in result["segments"]]
    assert labels[0] == labels[2] != labels[1] == labels[3]
    for old, new in zip(original, result["segments"]):
        assert {k: v for k, v in old.items() if k != "speaker"} == {
            k: v for k, v in new.items() if k != "speaker"
        }
    assert original[0]["speaker"] == a


def test_silence_is_not_a_person_and_missing_audio_is_unresolved():
    items = [
        segment("chunk-1:speaker-unknown", text="[Silence]"),
        segment("chunk-2:speaker-unknown", text="[Silence]"),
        segment("short", end=1),
    ]
    result = reconcile(items, {})
    assert [s["speaker"] for s in result["segments"]] == [
        "non-speech",
        "non-speech",
        "unresolved-1",
    ]
    assert result["speaker_resolution"]["resolved_count"] == 0
    assert result["speaker_resolution"]["unresolved_count"] == 1
    # An unknown label containing real speech is not classified as silence.
    mixed = reconcile(
        [segment("unknown"), segment("unknown", text="[Silence]")],
        {"unknown": [[1, 0]]},
    )
    assert [s["speaker"] for s in mixed["segments"]] == ["speaker-1", "non-speech"]


def test_confirmed_names_and_complete_link_prevent_false_merges():
    labels = ["a", "b", "c"]
    items = [segment(s) for s in labels]
    vectors = {s: [[math.cos(t), math.sin(t)]] for s, t in zip(labels, [0, 0.7, 1.4])}
    result = reconcile(items, vectors)
    assert result["speaker_resolution"]["resolved_count"] == 2
    result = reconcile(
        items[:2], {"a": [[1, 0]], "b": [[1, 0]]}, {"a": "Alice", "b": "Bob"}
    )
    assert result["speaker_resolution"]["resolved_count"] == 2


def test_same_chunk_requires_stronger_evidence_but_can_fix_fragmentation():
    a, b = "chunk-1:speaker-0", "chunk-1:speaker-1"
    items = [segment(a), segment(b)]
    assert (
        reconcile(items, {a: [[1, 0]], b: [[0.7, 0.714]]})["speaker_resolution"][
            "resolved_count"
        ]
        == 2
    )
    assert (
        reconcile(items, {a: [[1, 0]], b: [[0.95, 0.05]]})["speaker_resolution"][
            "resolved_count"
        ]
        == 1
    )


def test_profiles_reject_invalid_vectors_and_outlying_turns():
    assert profile([[1, 0], [1, 0.01], [0, 1]])[0] > 0.99
    for vector in [[], [0, 0], [float("nan"), 1]]:
        with pytest.raises(ValueError):
            profile([vector])


def test_samples_exclude_short_silence_and_overlap_and_remain_bounded():
    items = [
        segment("a", 0, 20),
        segment("b", 4, 8),
        segment("silent", 21, 30, "[Silence]"),
        segment("short", 31, 32),
    ]
    ranges = sample_ranges(items)
    assert ranges["silent"] == ranges["short"] == []
    assert all(b - a <= 8 and (b <= 4 or a >= 8) for a, b in ranges["a"])
    assert (
        len(sample_ranges([segment("a", i * 20, i * 20 + 10) for i in range(20)])["a"])
        == 5
    )


def test_speaker_only_worker_does_not_construct_asr(tmp_path, monkeypatch):
    from service import worker, adapter

    job_id = str(uuid.uuid4())
    (tmp_path / job_id).mkdir()
    items = [segment("a")]
    job = {
        "id": job_id,
        "status": "running",
        "task": "speakers",
        "input_segments": items,
        "speaker_names": {"a": "Alice"},
        "expected_speakers": 6,
    }
    db = sqlite3.connect(tmp_path / "jobs.sqlite")
    db.execute("CREATE TABLE jobs(id TEXT PRIMARY KEY, data TEXT)")
    db.execute("INSERT INTO jobs VALUES (?,?)", (job_id, json.dumps(job)))
    db.commit()
    monkeypatch.setattr(
        worker.subprocess,
        "run",
        lambda *a, **kw: SimpleNamespace(stdout='{"format":{"duration":10}}'),
    )
    monkeypatch.setattr(adapter, "VibeVoice", lambda: pytest.fail("ASR must not load"))

    def resolve(audio, segments, directory, progress, names, expected_speakers):
        assert segments == items and names == {"a": "Alice"}
        assert expected_speakers == 6
        progress("matching")
        return reconcile(segments, {"a": [[1, 0]]}, names)

    monkeypatch.setattr(worker, "resolve_speakers", resolve)
    worker.process(job_id, tmp_path)
    result = json.loads(db.execute("SELECT data FROM jobs").fetchone()[0])
    assert result["status"] == "complete"
    assert result["segments"][0]["id"] == items[0]["id"]
    assert result["segments"][0]["speaker"] == "speaker-1"
    db.close()


def test_repair_api_validates_input_and_retry_fingerprint(tmp_path, monkeypatch):
    import importlib
    from fastapi.testclient import TestClient
    import service.app as module

    monkeypatch.setenv("MEETING_ASR_DATA", str(tmp_path))
    monkeypatch.delenv("MEETING_ASR_TOKEN", raising=False)
    module = importlib.reload(module)

    # Keep queued jobs in the API without launching an inference subprocess.
    async def idle():
        import asyncio

        await asyncio.Future()

    monkeypatch.setattr(module, "dispatch", idle)
    with TestClient(module.app) as client:
        headers = {"Idempotency-Key": "repair"}
        files = {"audio": ("record.wav", b"audio")}
        data = {"task": "speakers", "segments": json.dumps([segment("a")])}
        response = client.post("/jobs", files=files, data=data, headers=headers)
        assert response.status_code == 202
        assert (
            client.post("/jobs", files=files, data=data, headers=headers).json()["id"]
            == response.json()["id"]
        )
        assert (
            client.post(
                "/jobs",
                files=files,
                data={**data, "speaker_names": '{"a":"Alice"}'},
                headers=headers,
            ).status_code
            == 409
        )
        for bad in [
            "[]",
            "invalid",
            json.dumps([segment("a", start=5, end=1)]),
            json.dumps([segment("a", end=float("nan"))]),
        ]:
            assert (
                client.post(
                    "/jobs", files=files, data={**data, "segments": bad}
                ).status_code
                == 422
            )
        guided = {**data, "expected_speakers": "6"}
        response = client.post(
            "/jobs", files=files, data=guided, headers={"Idempotency-Key": "guided"}
        )
        assert response.status_code == 202
        assert response.json()["expected_speakers"] == 6
        assert client.get("/health").json()["speaker_count_hint"] is True
        assert (
            client.post(
                "/jobs",
                files=files,
                data={**guided, "expected_speakers": "5"},
                headers={"Idempotency-Key": "guided"},
            ).status_code
            == 409
        )
        for count in ["0", "51", "1.5", "invalid"]:
            assert (
                client.post(
                    "/jobs", files=files, data={**data, "expected_speakers": count}
                ).status_code
                == 422
            )
        assert (
            client.post(
                "/jobs", files=files, data={"expected_speakers": "6"}
            ).status_code
            == 422
        )


def test_embedding_cache_resumes_and_invalidates_for_audio_and_timestamps(
    tmp_path, monkeypatch
):
    import wave
    from service import speakers

    audio = tmp_path / "audio"
    audio.write_bytes(b"original")
    monkeypatch.setattr(speakers, "model_path", lambda: tmp_path / "model")
    calls = []

    def convert(args, **kwargs):
        with wave.open(str(tmp_path / "speakers.wav"), "wb") as output:
            output.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            output.writeframes(b"\x10\x00" * 16000 * 20)

    class Encoder:
        def __init__(self, path):
            pass

        def encode(self, pcm):
            calls.append(len(pcm))
            return [1, 0]

    monkeypatch.setattr(speakers.subprocess, "run", convert)
    monkeypatch.setattr(speakers, "Encoder", Encoder)
    items = [segment("a", 0, 5), segment("b", 10, 15)]

    def interrupt(step):
        if "2/2" in step:
            raise InterruptedError()

    with pytest.raises(InterruptedError):
        speakers.resolve_speakers(audio, items, tmp_path, interrupt)
    assert len(calls) == 1
    assert not (tmp_path / "speakers.wav").exists()
    speakers.resolve_speakers(audio, items, tmp_path)
    assert len(calls) == 2
    speakers.resolve_speakers(
        audio, items, tmp_path, names={"a": "Alice"}, expected_speakers=6
    )
    assert len(calls) == 2
    speakers.resolve_speakers(audio, items, tmp_path)
    assert len(calls) == 2
    audio.write_bytes(b"replacement")
    speakers.resolve_speakers(audio, items, tmp_path)
    assert len(calls) == 4
    items[0]["end"] = 4
    speakers.resolve_speakers(audio, items, tmp_path)
    assert len(calls) == 6


def turn_fixture():
    items = [
        segment(label, i * 6, i * 6 + 5)
        for i, label in enumerate(["a"] * 4 + ["b"] * 4)
    ]
    vectors = {s["id"]: [1, 0, 0] if s["speaker"] == "a" else [0, 1, 0] for s in items}
    return items, vectors


def test_turn_clustering_attaches_fragments_without_training_on_them():
    items, vectors = turn_fixture()
    fragment = segment("fragment", 50, 55)
    items.append(fragment)
    vectors[fragment["id"]] = [0.58, 0, 0.8146]
    result = reconcile_turns(items, vectors, turn_samples(items))
    assert result["speaker_resolution"]["resolved_count"] == 2
    assert result["segments"][-1]["speaker"] == result["segments"][0]["speaker"]
    assert all(
        {k: v for k, v in a.items() if k != "speaker"}
        == {k: v for k, v in b.items() if k != "speaker"}
        for a, b in zip(items, result["segments"])
    )


def test_turn_clustering_can_split_a_previously_mixed_label():
    items, vectors = turn_fixture()
    first, second = segment("mixed", 50, 55), segment("mixed", 56, 61)
    items.extend([first, second])
    vectors.update({first["id"]: [1, 0, 0], second["id"]: [0, 1, 0]})
    result = reconcile_turns(items, vectors, turn_samples(items))
    assert result["segments"][-2]["speaker"] != result["segments"][-1]["speaker"]
    assert "mixed" not in result["speaker_resolution"]["mapping"]
    assert len(result["speaker_resolution"]["segment_mapping"]) == len(items)


def test_uncertain_turns_need_a_clear_margin_or_consistent_existing_label():
    items, vectors = turn_fixture()
    ambiguous = segment("new", 50, 51.5)
    missing = segment("a", 52, 52.3)
    items.extend([ambiguous, missing])
    vectors[ambiguous["id"]] = [1, 1, 0]
    result = reconcile_turns(items, vectors, turn_samples(items))
    assert result["segments"][-2]["speaker"].startswith("unresolved-")
    assert result["segments"][-1]["speaker"] == result["segments"][0]["speaker"]
    audit = result["speaker_resolution"]
    assert audit["unresolved_segments"] == 1
    assert audit["matches"][missing["id"]]["method"] == "retained_label"


def test_count_hint_cannot_force_distinct_voices_or_conflicting_names_together():
    items, vectors = turn_fixture()
    result = reconcile_turns(items, vectors, turn_samples(items), expected_speakers=1)
    assert result["speaker_resolution"]["resolved_count"] == 2
    assert not result["speaker_resolution"]["count_matches"]
    vectors = {s["id"]: [1, 0, 0] for s in items}
    result = reconcile_turns(
        items,
        vectors,
        turn_samples(items),
        {"a": "Alice", "b": "Bob"},
        expected_speakers=1,
    )
    assert result["speaker_resolution"]["resolved_count"] == 2
    assert result["speaker_resolution"]["guided_merges"] == []


def test_count_hint_can_consolidate_supported_similar_voices():
    items, vectors = turn_fixture()
    for s in items:
        if s["speaker"] == "b":
            vectors[s["id"]] = [0.53, math.sqrt(1 - 0.53**2), 0]
    automatic = reconcile_turns(items, vectors, turn_samples(items))
    guided = reconcile_turns(items, vectors, turn_samples(items), expected_speakers=1)
    assert automatic["speaker_resolution"]["resolved_count"] == 2
    assert guided["speaker_resolution"]["resolved_count"] == 1
    assert len(guided["speaker_resolution"]["guided_merges"]) == 1
    assert guided["speaker_resolution"]["unresolved_segments"] == 0


def test_recurring_voices_do_not_collapse_through_a_weak_transitive_bridge():
    items, vectors = [], {}
    for i, angle in enumerate([0, 0.7, 1.4]):
        for j in range(4):
            s = segment(str(i), (i * 4 + j) * 6, (i * 4 + j) * 6 + 5)
            items.append(s)
            vectors[s["id"]] = [math.cos(angle), math.sin(angle)]
    result = reconcile_turns(items, vectors, turn_samples(items))
    assert result["speaker_resolution"]["resolved_count"] == 2


def test_short_named_turns_cannot_be_assigned_to_one_conflicting_identity():
    items, vectors = turn_fixture()
    first, second = segment("c", 50, 51.5), segment("d", 52, 53.5)
    items.extend([first, second])
    vectors.update({first["id"]: [1, 0, 0], second["id"]: [1, 0, 0]})
    result = reconcile_turns(
        items, vectors, turn_samples(items), {"c": "Alice", "d": "Bob"}
    )
    assert result["segments"][-1]["speaker"] != result["segments"][-2]["speaker"]


def test_overlap_can_match_existing_voices_but_cannot_seed_new_ones():
    items, vectors = turn_fixture()
    overlap = segment("overlap", 6, 10)
    items.append(overlap)
    vectors[overlap["id"]] = [0, 0, 1]
    samples = turn_samples(items)
    assert not samples[overlap["id"]]["clean"]
    result = reconcile_turns(items, vectors, samples)
    assert result["speaker_resolution"]["resolved_count"] == 2
    assert result["segments"][-1]["speaker"].startswith("unresolved-")


def test_turn_samples_are_bounded_and_leave_subsecond_audio_unresolved():
    items = [
        segment("long", 0, 100),
        segment("short", 101, 101.4),
        segment("silence", 102, 106, "[Silence]"),
    ]
    samples = turn_samples(items)
    assert len(samples) == 1
    assert samples[items[0]["id"]]["end"] - samples[items[0]["id"]]["start"] == 8
    result = reconcile_turns(items, {}, samples)
    assert result["speaker_resolution"]["resolved_count"] == 0
    assert result["segments"][-1]["speaker"] == "non-speech"
    for count in [0, -1, 51, 1.5, True]:
        with pytest.raises(ValueError):
            reconcile_turns(items, {}, samples, expected_speakers=count)
