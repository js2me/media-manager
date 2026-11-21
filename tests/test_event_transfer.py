import os
from pathlib import Path
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "desktop"))
from devices import Device
from library import Library, identifier
from transfer import Transfers
from transfer_profile import event_month, read_profile


class EventTransferTest(unittest.TestCase):
    def test_event_selection_and_layout_use_the_indexed_month(self):
        with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as dest:
            for album in ["202305_a", "202305_b", "202306_a"]:
                folder = Path(source, "DCIM", album)
                folder.mkdir(parents=True)
                image = folder / "same.jpg"
                image.write_bytes(album.encode())
                os.utime(image, (1700000000, 1700000000))

            library = Library()
            library.update({source: Device(source, "Fixture", Path(source))})
            key = identifier(source)
            for _ in range(100):
                if library.scan(key)["done"]:
                    break
                time.sleep(.02)

            transfers = Transfers(library)
            transfers.start(key, dest, None, False, grouping="events", months=["2023-05"])
            transfers.worker.join(10)
            self.assertEqual(transfers.snapshot()["status"], "done")
            self.assertEqual(transfers.snapshot()["total"], 2)
            for album in ["202305_a", "202305_b"]:
                self.assertEqual(Path(dest, "2023", "05", "DCIM", album, "same.jpg").read_bytes(), album.encode())
            self.assertFalse(Path(dest, "2023", "06").exists())
            self.assertEqual(read_profile(dest)["months"], ["2023-05"])

    def test_undated_event(self):
        self.assertEqual(event_month("Camera", None), "unknown")
