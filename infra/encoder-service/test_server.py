"""Request-handling tests. Run: python3 -m unittest test_server -v   (no torch or model needed)."""
import json
import unittest

import server


class FakeModel:
    def __init__(self, label, confidence=0.9, raise_error=False):
        self.label, self.confidence, self.raise_error, self.docs = label, confidence, raise_error, []

    def classify_text(self, doc, tasks, include_confidence=False):
        self.docs.append((doc, tasks))
        if self.raise_error:
            raise RuntimeError("boom with secret email text")
        return {"kind": {"label": self.label, "confidence": self.confidence}}


class ParseRequest(unittest.TestCase):
    def test_accepts_a_valid_request_and_truncates_long_fields(self):
        out = server.parse_request(json.dumps({"from": "a@b", "subject": "s", "text": "x" * 9000}).encode())
        self.assertEqual(len(out["text"]), server.MAX_FIELD_CHARS)

    def test_rejects_bad_input(self):
        for raw in (b"not json", b"[]", b'{"text": 5}', b'{"from": "a"}', b'{"subject": "  ", "text": ""}', b"x" * (server.MAX_BODY_BYTES + 1)):
            with self.assertRaises(server.BadRequest, msg=raw[:30]):
                server.parse_request(raw)


class Classify(unittest.TestCase):
    req = {"from": "renewals@x.example", "subject": "Your policy renews", "text": "premium 40"}

    def test_relevant_only_for_the_policy_label(self):
        self.assertTrue(server.classify(FakeModel(server.POSITIVE), self.req)["relevant"])
        for neg in server.NEGATIVES:
            self.assertFalse(server.classify(FakeModel(neg), self.req)["relevant"])

    def test_sends_the_frozen_labels_and_the_whole_email(self):
        m = FakeModel(server.POSITIVE)
        server.classify(m, self.req)
        doc, tasks = m.docs[0]
        self.assertEqual(tasks, {"kind": server.LABELS})
        self.assertIn("From: renewals@x.example", doc)
        self.assertIn("Subject: Your policy renews", doc)

    def test_reports_confidence_model_and_latency(self):
        out = server.classify(FakeModel(server.POSITIVE, 0.456789), self.req)
        self.assertEqual(out["confidence"], 0.457)
        self.assertEqual(out["model"], server.MODEL_ID)
        self.assertGreaterEqual(out["latency_ms"], 0)

    def test_label_set_matches_the_evaluated_wording(self):
        # If this fails the eval numbers in ../encoder-eval/README.md no longer describe this service.
        self.assertEqual(len(server.LABELS), 6)
        self.assertTrue(server.POSITIVE.startswith("a notice about an insurance, pension, mortgage or estate policy"))


if __name__ == "__main__":
    unittest.main()
