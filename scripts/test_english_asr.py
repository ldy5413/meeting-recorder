"""Evaluation integrity checks; run with the isolated ASR evaluation environment."""

import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "english_scoring", Path(__file__).with_name("score-english-asr.py")
)
scoring = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scoring)


class EnglishScoringTests(unittest.TestCase):
    def setUp(self):
        self.corpus = {
            "samples": [
                {
                    "id": "a",
                    "meeting_id": "call",
                    "group": "calls",
                    "start_seconds": 0,
                    "duration_seconds": 1,
                    "decoded_sha256": "audio-a",
                },
                {
                    "id": "b",
                    "meeting_id": "call",
                    "group": "calls",
                    "start_seconds": 1,
                    "duration_seconds": 2,
                    "decoded_sha256": "audio-b",
                },
            ]
        }
        self.reference = {
            "reference_kind": "published_dataset",
            "corpus_sha256": "corpus",
            "sample_audio_sha256": {"a": "audio-a", "b": "audio-b"},
            "units": [
                {
                    "id": "call",
                    "group": "calls",
                    "sample_ids": ["a", "b"],
                    "text": "the annual report",
                }
            ],
        }
        self.report = {
            "status": "complete",
            "configuration": {"corpus_sha256": "corpus", "sample_ids": ["a", "b"]},
            "results": [
                {
                    "sample_id": "a",
                    "decoded_sha256": "audio-a",
                    "text": "The annual",
                    "inference_seconds": 0.1,
                },
                {
                    "sample_id": "b",
                    "decoded_sha256": "audio-b",
                    "text": "report",
                    "inference_seconds": 0.2,
                },
            ],
        }

    def run_score(self):
        return scoring.score(
            self.corpus, self.reference, self.report, "corpus", str.lower
        )

    def test_full_call_is_concatenated_before_scoring(self):
        group = self.run_score()["groups"]["all"]
        self.assertEqual(group["normalized"]["wer"], 0)
        self.assertEqual(group["normalized"]["reference_words"], 3)
        self.assertEqual(group["duration_seconds"], 3)

    def test_word_edits_and_insertions_are_not_character_errors(self):
        row = scoring.word_errors(["a", "longword", "cat"], ["a", "x", "cat", "again"])
        self.assertEqual(row["errors"], 2)
        self.assertEqual(row["counts"], {"replace": 1, "delete": 0, "insert": 1})
        self.assertAlmostEqual(row["wer"], 2 / 3)

    def test_missing_chunk_is_rejected(self):
        self.report["results"].pop()
        with self.assertRaisesRegex(ValueError, "all frozen samples"):
            self.run_score()

    def test_duplicate_result_is_rejected(self):
        self.report["results"].append(copy.deepcopy(self.report["results"][0]))
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            self.run_score()

    def test_audio_mismatch_is_rejected(self):
        self.report["results"][0]["decoded_sha256"] = "changed"
        with self.assertRaisesRegex(ValueError, "Audio hash"):
            self.run_score()

    def test_gap_or_reordered_chunks_are_rejected(self):
        self.corpus["samples"][1]["start_seconds"] = 1.5
        with self.assertRaisesRegex(ValueError, "without gaps/overlap"):
            self.run_score()

    def test_unreferenced_audio_is_rejected(self):
        self.reference["units"][0]["sample_ids"].pop()
        with self.assertRaisesRegex(ValueError, "partition"):
            self.run_score()

    def test_partial_run_is_rejected(self):
        self.report["status"] = "running"
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            self.run_score()

    def test_basic_normalization_preserves_words_and_contractions(self):
        self.assertEqual(
            scoring.basic_words("IT’S twenty-two!"), ["it's", "twenty", "two"]
        )
        self.assertNotEqual(scoring.basic_words("twenty"), scoring.basic_words("20"))


if __name__ == "__main__":
    unittest.main()
