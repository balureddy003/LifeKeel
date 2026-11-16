"""Request-handling tests. Run: python3 -m unittest discover -s infra/docling-service -p 'test_server.py' -v
(no docling or model weights needed — conversion is injected)."""
import glob
import os
import tempfile
import unittest

import server


class FakeHeaders(dict):
    def get(self, key, default=None):
        # http.client headers are case-insensitive
        for k, v in self.items():
            if k.lower() == key.lower():
                return v
        return default


PDF = b"%PDF-1.4 fake"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class FakeDoc:
    tables = [object(), object()]

    def export_to_markdown(self):
        return "# Statement\n\n| a | b |\n" + "x" * 100


class FakeResult:
    document = FakeDoc()


class FakeConverter:
    def convert(self, path):
        # the temp file must exist while converting and carry the bytes
        with open(path, "rb") as f:
            assert f.read() == PDF
        return FakeResult()


class ValidateRequest(unittest.TestCase):
    def test_accepts_pdf_and_docx(self):
        for mime, suffix in (
            ("application/pdf", ".pdf"),
            (DOCX_MIME, ".docx"),
        ):
            got_suffix, got_mime = server.validate_request(FakeHeaders({"X-Document-Mime": mime}), 100)
            self.assertEqual((got_suffix, got_mime), (suffix, mime))

    def test_rejects_bad_input(self):
        for headers, length in (
            (FakeHeaders({"X-Document-Mime": "application/pdf"}), 0),
            (FakeHeaders({"X-Document-Mime": "application/pdf"}), server.MAX_BODY_BYTES + 1),
            (FakeHeaders({}), 100),
            (FakeHeaders({"X-Document-Mime": "image/png"}), 100),
            (FakeHeaders({"X-Document-Mime": "text/plain"}), 100),
        ):
            with self.assertRaises(server.BadRequest):
                server.validate_request(headers, length)


class ConvertDocument(unittest.TestCase):
    def test_returns_text_table_count_and_latency(self):
        out = server.convert_document(FakeConverter(), PDF, "application/pdf", ".pdf")
        self.assertIn("Statement", out["text"])
        self.assertEqual(out["tables"], 2)
        self.assertEqual(out["model"], server.MODEL_ID)
        self.assertGreaterEqual(out["latency_ms"], 0)

    def test_temp_file_is_deleted(self):
        before = set(glob.glob(os.path.join(tempfile.gettempdir(), "tmp*")))
        server.convert_document(FakeConverter(), PDF, "application/pdf", ".pdf")
        after = set(glob.glob(os.path.join(tempfile.gettempdir(), "tmp*")))
        self.assertEqual(before, after)

    def test_text_is_capped(self):
        class BigDoc(FakeDoc):
            def export_to_markdown(self):
                return "y" * (server.TEXT_LIMIT + 500)

        class BigResult:
            document = BigDoc()

        class BigConverter:
            def convert(self, path):
                return BigResult()

        out = server.convert_document(BigConverter(), PDF, "application/pdf", ".pdf")
        self.assertEqual(len(out["text"]), server.TEXT_LIMIT)


if __name__ == "__main__":
    unittest.main()
