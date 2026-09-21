"""Persistent ASR job API. Run one uvicorn worker; one inference process at a time."""

import asyncio
from contextlib import asynccontextmanager
import hmac
import json
import os
from pathlib import Path
import sqlite3
import sys
import uuid
from typing import Literal

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile, Depends
from pydantic import BaseModel, Field, ValidationError, model_validator, TypeAdapter


class SpeakerSegment(BaseModel):
    id: uuid.UUID
    start: float = Field(ge=0, allow_inf_nan=False)
    end: float = Field(ge=0, allow_inf_nan=False)
    speaker: str = Field(min_length=1, max_length=200)
    text: str = Field(max_length=200000)

    @model_validator(mode="after")
    def ordered(self):
        if self.end < self.start:
            raise ValueError("Segment ends before it starts")
        return self


DATA = Path(
    os.getenv("MEETING_ASR_DATA", str(Path(__file__).parent / "data"))
).resolve()
DB = None
processes = {}
runner = None


def read(job_id):
    row = DB.execute("SELECT data FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Job not found")
    return json.loads(row[0])


def write(job):
    DB.execute(
        "INSERT INTO jobs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        (job["id"], json.dumps(job)),
    )
    DB.commit()


async def authorize(authorization: str = Header(default="")):
    token = os.getenv("MEETING_ASR_TOKEN", "")
    if token and not hmac.compare_digest(authorization, f"Bearer {token}"):
        raise HTTPException(401, "Unauthorized")


async def dispatch():
    while True:
        jobs = [
            json.loads(row[0])
            for row in DB.execute("SELECT data FROM jobs ORDER BY rowid")
        ]
        job = next((j for j in jobs if j["status"] == "queued"), None)
        if job:
            job.update(status="running", step="loading model")
            write(job)
            log = open(DATA / job["id"] / "worker.log", "ab")
            try:
                process = await asyncio.create_subprocess_exec(
                    sys.executable,
                    "-m",
                    "service.worker",
                    job["id"],
                    str(DATA),
                    cwd=str(Path(__file__).resolve().parent.parent),
                    stdout=log,
                    stderr=log,
                )
                processes[job["id"]] = process
                if (
                    read(job["id"])["status"] == "cancelled"
                    and process.returncode is None
                ):
                    process.terminate()
                await process.wait()
                current = read(job["id"])
                if current["status"] == "running":
                    current.update(
                        status="failed",
                        error=f"Inference process exited ({process.returncode}); inspect worker.log",
                    )
                    write(current)
            except (OSError, RuntimeError) as exc:
                current = read(job["id"])
                if current["status"] != "cancelled":
                    current.update(
                        status="failed", error=f"Could not launch worker: {exc}"
                    )
                    write(current)
            finally:
                log.close()
                processes.pop(job["id"], None)
        await asyncio.sleep(0.5)


@asynccontextmanager
async def lifespan(app):
    global DB, runner
    DATA.mkdir(parents=True, exist_ok=True)
    DB = sqlite3.connect(DATA / "jobs.sqlite")
    DB.execute("PRAGMA journal_mode=WAL")
    DB.execute(
        "CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,data TEXT NOT NULL)"
    )
    DB.execute(
        "CREATE TABLE IF NOT EXISTS idempotency(key TEXT PRIMARY KEY,job_id TEXT NOT NULL)"
    )
    for (raw,) in DB.execute("SELECT data FROM jobs").fetchall():
        job = json.loads(raw)
        if job["status"] in ("running", "uploading"):
            job.update(
                status="failed",
                error="Service interrupted; retry resumes persisted chunks",
            )
            write(job)
    runner = asyncio.create_task(dispatch())
    yield
    runner.cancel()
    for process in list(processes.values()):
        if process.returncode is None:
            process.terminate()
            await process.wait()
    try:
        await runner
    except asyncio.CancelledError:
        pass
    DB.close()


app = FastAPI(
    title="Meeting Recorder ASR",
    version="0.1.0",
    lifespan=lifespan,
    dependencies=[Depends(authorize)],
)


@app.get("/health")
async def health():
    import importlib.util

    return {
        "ok": True,
        "backend": "vibevoice",
        "installed": importlib.util.find_spec("vibevoice") is not None,
        "model": os.getenv("VIBEVOICE_MODEL", "microsoft/VibeVoice-ASR"),
        "api_version": 1,
        "speaker_resolution_version": 1,
        "speaker_count_hint": True,
        "speaker_algorithm_version": 2,
    }


@app.post("/jobs", status_code=202)
async def submit(
    audio: UploadFile = File(...),
    idempotency_key: str = Header(default=""),
    context_info: str = Form(default="", max_length=150000),
    task: Literal["transcribe", "speakers"] = Form(default="transcribe"),
    segments: str = Form(default="[]", max_length=20000000),
    speaker_names: str = Form(default="{}", max_length=200000),
    expected_speakers: int | None = Form(default=None, ge=1, le=50),
):
    try:
        inputs = TypeAdapter(list[SpeakerSegment]).validate_json(segments)
        inputs = [s.model_dump(mode="json") for s in inputs]
        names = TypeAdapter(dict[str, str]).validate_json(speaker_names)
        if task == "speakers" and not inputs:
            raise ValueError("Speaker repair requires an existing transcript")
        if task == "transcribe" and (inputs or names):
            raise ValueError("Transcript inputs require task=speakers")
        if task != "speakers" and expected_speakers is not None:
            raise ValueError("Speaker count requires task=speakers")
        if len({s["id"] for s in inputs}) != len(inputs):
            raise ValueError("Duplicate segment IDs")
    except (ValidationError, ValueError) as exc:
        await audio.close()
        raise HTTPException(422, "Invalid speaker repair input") from exc
    if len(idempotency_key) > 200:
        raise HTTPException(400, "Invalid idempotency key")
    if idempotency_key:
        previous = DB.execute(
            "SELECT job_id FROM idempotency WHERE key=?", (idempotency_key,)
        ).fetchone()
        if previous:
            job = read(previous[0])
            if job.get("context_info", "") != context_info:
                await audio.close()
                raise HTTPException(409, "Idempotency key has different context_info")
            if (
                job.get("task", "transcribe") != task
                or job.get("input_segments", []) != inputs
                or job.get("speaker_names", {}) != names
                or job.get("expected_speakers") != expected_speakers
            ):
                await audio.close()
                raise HTTPException(409, "Idempotency key has different speaker inputs")
            if job["status"] == "uploading":
                raise HTTPException(409, "Upload in progress")
            if (DATA / job["id"] / "audio").exists():
                if job["status"] in ("failed", "cancelled"):
                    job.update(status="queued", step="queued", error=None)
                    write(job)
                await audio.close()
                return job
            DB.execute("DELETE FROM idempotency WHERE key=?", (idempotency_key,))
            DB.commit()
    job_id = str(uuid.uuid4())
    directory = DATA / job_id
    directory.mkdir()
    job = {
        "id": job_id,
        "status": "uploading",
        "step": "upload",
        "error": None,
        "segments": [],
        "context_info": context_info,
        "task": task,
        "input_segments": inputs,
        "speaker_names": names,
        "expected_speakers": expected_speakers,
    }
    write(job)
    if idempotency_key:
        DB.execute("INSERT INTO idempotency VALUES (?,?)", (idempotency_key, job_id))
        DB.commit()
    size = 0
    try:
        with open(directory / "upload.tmp", "wb") as output:
            while block := await audio.read(1024 * 1024):
                size += len(block)
                if size > int(os.getenv("MEETING_MAX_UPLOAD_BYTES", str(4 * 1024**3))):
                    raise HTTPException(413, "Audio exceeds upload limit")
                output.write(block)
            output.flush()
            os.fsync(output.fileno())
        if size == 0:
            raise HTTPException(400, "Empty audio")
        (directory / "upload.tmp").replace(directory / "audio")
        job.update(status="queued", step="queued")
        write(job)
        return job
    except Exception:
        DB.execute("DELETE FROM idempotency WHERE job_id=?", (job_id,))
        DB.commit()
        job.update(status="failed", error="Upload failed; submit audio again")
        write(job)
        raise
    finally:
        await audio.close()


@app.get("/jobs/{job_id}")
async def status(job_id: uuid.UUID):
    return read(str(job_id))


@app.delete("/jobs/{job_id}")
async def cancel(job_id: uuid.UUID):
    job = read(str(job_id))
    if job["status"] not in ("complete", "cancelled"):
        job.update(status="cancelled", step="cancelled")
        write(job)
        process = processes.get(str(job_id))
        if process and process.returncode is None:
            process.terminate()
            await process.wait()
    return job
