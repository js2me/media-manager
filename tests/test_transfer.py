import os
import sys
import tempfile
import unittest
from pathlib import Path
from threading import Event

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "desktop"))
from transfer import verified_copy, remove_verified


class VerifiedTransferTest(unittest.TestCase):
    def setUp(self):
        self.source_dir = tempfile.TemporaryDirectory()
        self.target_dir = tempfile.TemporaryDirectory(dir=os.getenv("TRANSFER_TEST_DIR"))
        self.addCleanup(self.source_dir.cleanup)
        self.addCleanup(self.target_dir.cleanup)
        self.source = Path(self.source_dir.name) / "test.jpg"
        self.target = Path(self.target_dir.name) / self.source.name
        self.content = b"fixture" * 180000
        self.source.write_bytes(self.content)
        self.stop = Event()

    def transfer(self, move=False):
        receipt = verified_copy(self.source, self.target, len(self.content), self.stop)
        if move:
            remove_verified(self.source, self.target, receipt, self.stop, lambda: None)
        return receipt[0]

    def test_copy_retry_and_verified_move(self):
        self.assertEqual(self.transfer(), "copied")
        self.assertEqual(self.transfer(), "matched")
        self.assertEqual(self.transfer(move=True), "matched")
        self.assertFalse(self.source.exists())
        self.assertEqual(self.target.read_bytes(), self.content)

    def test_move(self):
        self.assertEqual(self.transfer(move=True), "copied")
        self.assertFalse(self.source.exists())
        self.assertEqual(self.target.read_bytes(), self.content)

    def test_conflict_keeps_both_files(self):
        other = b"!" * len(self.content)
        self.target.write_bytes(other)
        with self.assertRaises(FileExistsError):
            self.transfer(move=True)
        self.assertEqual(self.target.read_bytes(), other)
        self.assertEqual(self.source.read_bytes(), self.content)

    def test_stop_cleans_partial_file(self):
        self.stop.set()
        with self.assertRaises(InterruptedError):
            self.transfer(move=True)
        self.assertEqual(list(self.target.parent.iterdir()), [])
        self.assertEqual(self.source.read_bytes(), self.content)


if __name__ == "__main__":
    unittest.main()
