import os
import sys
import tempfile
import unittest
from multiprocessing import get_context
from pathlib import Path
from threading import Lock
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "desktop"))
from transfer import Transfers, verified_copy


def run_move(root, dest):
    scan = object()
    library = SimpleNamespace(lock=Lock(), scans={"device": scan})
    entries = [(Path(name), Path(name), 4) for name in ("a.jpg", "b.jpg")]
    job = Transfers(library)
    job.run("device", scan, root, root.stat(), dest, os.open(dest, os.O_DIRECTORY), entries, True)
    return job.snapshot()


def crash_after_first_copy(root, dest):
    def interrupted(*args):
        verified_copy(*args)
        os._exit(23)
    with patch("transfer.verified_copy", interrupted):
        run_move(root, dest)


class InterruptedMoveTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.src = Path(tmp.name, "phone")
        self.dest = Path(tmp.name, "archive")
        self.src.mkdir()
        self.dest.mkdir()
        for name in ("a.jpg", "b.jpg"):
            (self.src / name).write_bytes(b"data")

    def test_process_crash_and_retry(self):
        process = get_context("spawn").Process(target=crash_after_first_copy, args=(self.src, self.dest))
        process.start()
        process.join(10)
        self.assertEqual(process.exitcode, 23)
        self.assertEqual(len(list(self.src.glob("*.jpg"))), 2)
        self.assertEqual((self.dest / "a.jpg").read_bytes(), b"data")
        result = run_move(self.src, self.dest)
        self.assertEqual((result["status"], result["matched"], result["removed"]), ("done", 1, 2))
        for name in ("a.jpg", "b.jpg"):
            self.assertEqual((self.dest / name).read_bytes(), b"data")

    def test_replaced_destination_before_removal(self):
        def replace_disk(source, final, *args):
            receipt = verified_copy(source, final, *args)
            if source.name == "b.jpg":
                self.dest.rename(self.dest.with_name("detached"))
                self.dest.mkdir()
            return receipt

        with patch("transfer.verified_copy", replace_disk):
            result = run_move(self.src, self.dest)
        self.assertEqual((result["status"], result["removed"]), ("failed", 0))
        self.assertEqual(len(list(self.src.glob("*.jpg"))), 2)

    def test_sync_error_on_second_file_preserves_first_original(self):
        with patch("transfer.fsync_directory", side_effect=[None, OSError("I/O error")]):
            result = run_move(self.src, self.dest)
        self.assertEqual((result["status"], result["removed"]), ("failed", 0))
        self.assertEqual(len(list(self.src.glob("*.jpg"))), 2)
