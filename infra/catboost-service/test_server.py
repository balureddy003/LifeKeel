"""Request-handling tests. Run: python3 -m unittest discover -s infra/catboost-service -p 'test_server.py' -v
(no catboost install needed — the model is never touched here)."""
import json
import unittest

import server


def months(n=6):
    return [
        {"period": f"2026-{i + 1:02d}", "money_in_minor": 200_000 + i * 1000,
         "money_out_minor": 150_000 + i * 500}
        for i in range(n)
    ]


class ParseRequest(unittest.TestCase):
    def test_accepts_a_valid_request(self):
        out = server.parse_request(json.dumps({"months": months()}).encode())
        self.assertEqual(len(out["months"]), 6)

    def test_rejects_bad_input(self):
        bad_bodies = [
            b"not json",
            b"[]",
            b'{"months": "x"}',
            b'{"months": []}',
            b'{"months": [{"period": "2026-01"}]}',
            json.dumps({"months": [{"period": "2026-01", "money_in_minor": -5,
                                    "money_out_minor": 1}]}).encode(),
            json.dumps({"months": [{"period": "2026-01", "money_in_minor": "x",
                                    "money_out_minor": 1}]}).encode(),
            b"x" * (server.MAX_BODY_BYTES + 1),
        ]
        for raw in bad_bodies:
            with self.assertRaises(server.BadRequest, msg=raw[:40]):
                server.parse_request(raw)

    def test_rejects_too_few_or_too_many_months(self):
        for n in (2, 121):
            with self.assertRaises(server.BadRequest):
                server.parse_request(json.dumps({"months": months(n)}).encode())


if __name__ == "__main__":
    unittest.main()
