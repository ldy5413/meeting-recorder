import importlib
import uuid

import pytest
from fastapi.testclient import TestClient

from service.chunking import windows, normalize, merge


def test_worker_context_reaches_split_windows_and_invalidates_cache(
    tmp_path, monkeypatch
):
    import json
    import sqlite3
    from types import SimpleNamespace
    from service import worker, adapter

    job_id = str(uuid.uuid4())
    (tmp_path / job_id).mkdir()
    db = sqlite3.connect(tmp_path / "jobs.sqlite")
    db.execute("CREATE TABLE jobs(id TEXT PRIMARY KEY,data TEXT)")
    calls = []
    lengths = []

    def command(args, **kwargs):
        if "-t" in args:
            lengths.append(float(args[args.index("-t") + 1]))
        return SimpleNamespace(stdout='{"format":{"duration":300}}')

    class Backend:
        device = "test"
        offload_speech = False
        torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False))

        def transcribe(self, path, context_info=""):
            calls.append(context_info)
            if lengths[-1] > 160:
                raise adapter.IncompleteOutput("split", "incomplete")
            return [{"start": 0, "end": 1, "speaker": 1, "text": "XRD"}], "valid"

    monkeypatch.setattr(worker.subprocess, "run", command)
    monkeypatch.setattr(adapter, "VibeVoice", Backend)
    reconciled = []

    def resolve(audio, segments, directory, progress):
        reconciled.append(segments)
        return {"segments": [{**s, "speaker": "speaker-1"} for s in segments]}

    monkeypatch.setattr(worker, "resolve_speakers", resolve)
    monkeypatch.setenv("VIBEVOICE_CHUNK_SECONDS", "300")

    def run(context):
        db.execute(
            "INSERT OR REPLACE INTO jobs VALUES (?,?)",
            (
                job_id,
                json.dumps(
                    {"id": job_id, "status": "running", "context_info": context}
                ),
            ),
        )
        db.commit()
        worker.process(job_id, tmp_path)
        result = json.loads(db.execute("SELECT data FROM jobs").fetchone()[0])
        assert result["status"] == "complete", result.get("error")
        return result

    first = run("XRD")
    assert calls == ["XRD"] * 3
    run("XRD")
    assert len(calls) == 3
    second = run("SiC")
    assert calls[3:] == ["SiC"] * 3
    assert first["configuration"] != second["configuration"]
    assert len(reconciled) == 3
    assert len({s["speaker"] for s in reconciled[0]}) == 2
    assert {s["speaker"] for s in first["segments"]} == {"speaker-1"}
    db.close()


@pytest.mark.parametrize("failure", ["truncated", "timestamps"])
def test_incomplete_windows_split_and_resume_without_gaps(tmp_path, failure):
    from service.adapter import IncompleteOutput
    from service.adaptive import transcribe_window

    calls = []

    def infer(offset, length):
        calls.append((offset, length))
        if length > 160:
            if failure == "truncated":
                raise IncompleteOutput("token limit", "partial invalid output")
            return [
                {"start": length + 1, "end": length + 5, "text": "invalid timestamps"}
            ], "partial invalid output"
        return [
            {"start": 0, "end": length, "speaker": 1, "text": str(offset)}
        ], "valid output"

    job = str(uuid.uuid4())
    result = transcribe_window(
        tmp_path, "test", 2, 560, 300, job, infer, lambda *_: None
    )
    assert calls == [(560, 300), (560, 155), (705, 155)]
    assert result["segments"][0]["start"] == 560
    assert result["segments"][-1]["end"] == 860
    assert result["segments"][0]["end"] >= result["segments"][1]["start"]
    assert len({s["id"] for s in result["segments"]}) == 2
    assert len({s["speaker"] for s in result["segments"]}) == 2
    assert (
        transcribe_window(tmp_path, "test", 2, 560, 300, job, infer, lambda *_: None)
        == result
    )
    assert len(calls) == 3
    assert (
        "partial invalid output" in next(tmp_path.glob("*incomplete.json")).read_text()
    )


def test_90_minutes_windows_and_overlap():
    chunks = list(windows(5400))
    assert chunks == [(0, 2700), (2680, 2700), (5360, 40)]
    assert max(offset + length for offset, length in chunks) == 5400
    with pytest.raises(ValueError):
        list(windows(5400, 4000))


def test_incomplete_short_window_is_reported_and_not_accepted(tmp_path):
    from service.adapter import IncompleteOutput
    from service.adaptive import transcribe_window

    def infer(*_):
        raise IncompleteOutput("timeout", "partial")

    with pytest.raises(RuntimeError, match="remains incomplete"):
        transcribe_window(
            tmp_path, "bounded", 0, 0, 40, str(uuid.uuid4()), infer, lambda *_: None
        )
    assert not (tmp_path / "chunk-bounded-0.json").exists()
    assert (tmp_path / "chunk-bounded-0-incomplete.json").exists()


def test_normalization_dedupe_and_independent_speakers():
    job = str(uuid.uuid4())
    a = normalize(
        [{"start_time": 2690, "end_time": 2695, "speaker_id": 1, "text": "API 完成。"}],
        0,
        2700,
        0,
        job,
    )
    b = normalize(
        [
            {"start_time": 10, "end_time": 15, "speaker_id": 2, "text": "API 完成。"},
            {"start_time": 30, "end_time": 35, "speaker_id": 1, "text": "继续讨论"},
        ],
        2680,
        2700,
        1,
        job,
    )
    result = merge(a, b)
    assert len(result) == 2
    assert result[1]["start"] == 2710
    assert result[0]["speaker"] != result[1]["speaker"]
    assert (
        normalize([{"start": 0, "end": 1, "text": "ok"}], 0, 2, 0, job)[0]["id"]
        == normalize([{"start": 0, "end": 1, "text": "ok"}], 0, 2, 0, job)[0]["id"]
    )
    with pytest.raises(ValueError):
        normalize([{"start": float("nan"), "end": 1, "text": "bad"}], 0, 2, 0, job)


def test_job_api_auth_upload_cancel_retry(tmp_path, monkeypatch):
    monkeypatch.setenv("MEETING_ASR_DATA", str(tmp_path))
    monkeypatch.setenv("MEETING_ASR_TOKEN", "test-token")
    import service.app as module

    module = importlib.reload(module)
    with TestClient(module.app) as client:
        assert client.get("/health").status_code == 401
        headers = {"Authorization": "Bearer test-token", "Idempotency-Key": "same-job"}
        assert client.get("/health", headers=headers).status_code == 200
        result = client.post(
            "/jobs", headers=headers, files={"audio": ("record.wav", b"fixture")}
        )
        assert result.status_code == 202
        job_id = result.json()["id"]
        conflict = client.post(
            "/jobs",
            headers=headers,
            files={"audio": ("record.wav", b"fixture")},
            data={"context_info": "XRD"},
        )
        assert conflict.status_code == 409
        contextual = client.post(
            "/jobs",
            headers={**headers, "Idempotency-Key": "context-job"},
            files={"audio": ("record.wav", b"fixture")},
            data={"context_info": "XRD"},
        )
        assert contextual.status_code == 202
        assert contextual.json()["context_info"] == "XRD"
        assert (
            client.get(f"/jobs/{contextual.json()['id']}", headers=headers).json()[
                "context_info"
            ]
            == "XRD"
        )
        assert (tmp_path / job_id / "audio").read_bytes() == b"fixture"
        assert (
            client.post(
                "/jobs", headers=headers, files={"audio": ("record.wav", b"fixture")}
            ).json()["id"]
            == job_id
        )
        assert (
            client.delete(f"/jobs/{job_id}", headers=headers).json()["status"]
            == "cancelled"
        )
        assert (
            client.get(f"/jobs/{job_id}", headers=headers).json()["status"]
            == "cancelled"
        )
        assert (
            client.post(
                "/jobs", headers=headers, files={"audio": ("record.wav", b"fixture")}
            ).json()["id"]
            == job_id
        )
        assert client.get("/jobs/not-an-id", headers=headers).status_code == 422
        assert (
            client.post(
                "/jobs",
                headers={"Authorization": "Bearer test-token"},
                files={"audio": ("empty.wav", b"")},
            ).status_code
            == 400
        )
