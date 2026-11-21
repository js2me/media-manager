import hashlib
import os
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event, Lock, Thread, Timer
from time import monotonic

from gi.repository import Gio, GLib
from transfer_profile import event_month

PHOTOS = set("jpg jpeg jfif png heic heif avif webp gif bmp tif tiff dng".split())
VIDEOS = set("mp4 mov m4v webm mkv avi mpg mpeg 3gp 3g2 mts m2ts".split())
PRIORITY = ["dcim", "camera", "pictures", "movies", "download"]


def identifier(value):
    return hashlib.sha256(os.fsencode(value)).hexdigest()[:32]


@dataclass
class Scan:
    items: list = field(default_factory=list)
    files: dict = field(default_factory=dict)
    versioned: set = field(default_factory=set)
    icons: dict = field(default_factory=dict)
    done: bool = False
    failed: bool = False
    skipped: int = 0
    folder: str = "."
    cancel: object = None


class Library:
    def __init__(self):
        self.lock = Lock()
        self.scans = {}
        self.devices = {}

    def update(self, devices):
        with self.lock:
            current = {identifier(key): value for key, value in devices.items()}
            for key in list(self.scans):
                if key not in current or current[key].root != self.devices[key].root:
                    scan = self.scans.pop(key)
                    if scan.cancel:
                        scan.cancel.cancel()
            self.devices = current

    def scan(self, key, offset=0, refresh=False):
        with self.lock:
            device = self.devices[key]
            if not device.root:
                raise KeyError(key)
            scan = self.scans.get(key)
            if not scan or (refresh and scan.done):
                scan = self.scans[key] = Scan()
                Thread(target=self._walk, args=(key, device, scan), daemon=True).start()
            end = min(len(scan.items), offset + 1024)
            return dict(items=scan.items[offset:end], more=end < len(scan.items), skipped=scan.skipped,
                        done=scan.done and end == len(scan.items), failed=scan.failed, folder=scan.folder)

    def _walk(self, key, device, scan):
        root = (Gio.File.new_for_uri(device.uri) if "://" in device.uri
                else Gio.File.new_for_path(str(device.root)))
        pending = [Path(".")]
        stopped = Event()
        last_progress = monotonic()

        def cancel_stalled_read():
            while not stopped.wait(5):
                with self.lock:
                    if scan.cancel and monotonic() - last_progress > 45:
                        scan.cancel.cancel()

        Thread(target=cancel_stalled_read, daemon=True).start()
        try:
            while pending:
                relative = pending.pop()
                folder = root.resolve_relative_path(str(relative)) if relative.parts else root
                cancel = Gio.Cancellable()
                with self.lock:
                    if self.scans.get(key) is not scan:
                        return
                    scan.folder = relative.as_posix()
                    last_progress = monotonic()
                    scan.cancel = cancel
                children = []
                try:
                    listing = folder.enumerate_children("standard::name,standard::type,standard::size,time::modified,preview::icon",
                        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, cancel)
                    try:
                        while info := listing.next_file(cancel):
                            last_progress = monotonic()
                            name = info.get_name()
                            kind = info.get_file_type()
                            if kind == Gio.FileType.DIRECTORY and not name.startswith("."):
                                children.append(relative / name)
                            elif kind == Gio.FileType.REGULAR:
                                ext = name.rsplit(".", 1)[-1].lower()
                                if ext not in PHOTOS and ext not in VIDEOS:
                                    continue
                                path = relative / name
                                versioned = info.has_attribute("time::modified") and info.has_attribute("standard::size")
                                stamp = info.get_attribute_uint64("time::modified")
                                item = identifier(f"{path}\0{info.get_size()}:{stamp}" if versioned else path)
                                with self.lock:
                                    icon = info.get_attribute_object("preview::icon")
                                    if versioned:
                                        scan.versioned.add(item)
                                    if isinstance(icon, Gio.LoadableIcon):
                                        scan.icons[item] = icon
                                    scan.files[item] = device.root / path
                                    # GVfs exposes MTP storage volumes as the first directory level.
                                    # Keep card names distinct when archiving from multiple volumes.
                                    archive_folder = relative
                                    if device.uri.startswith("mtp://") and relative.parts and relative.parts[0].casefold() in {
                                        "внутренний накопитель устройства", "internal shared storage",
                                        "internal storage", "internal device storage"
                                    }:
                                        archive_folder = Path(*relative.parts[1:])
                                    scan.items.append(dict(id=item, name=name, folder=str(relative), archiveFolder=str(archive_folder),
                                        eventMonth=event_month(str(relative), stamp),
                                        modified=stamp if info.has_attribute("time::modified") else None,
                                        size=info.get_size() if info.has_attribute("standard::size") else None,
                                        kind="photo" if ext in PHOTOS else "video"))
                    finally:
                        listing.close(cancel)
                except (GLib.Error, OSError):
                    with self.lock:
                        scan.skipped += 1
                        if not relative.parts:
                            scan.failed = True
                children.sort(key=lambda p: (PRIORITY.index(p.name.lower())
                    if p.name.lower() in PRIORITY else len(PRIORITY), p.name.casefold()))
                pending.extend(reversed(children))
        finally:
            stopped.set()
            with self.lock:
                scan.cancel = None
                scan.done = True

    def cache_key(self, key, item):
        with self.lock:
            scan = self.scans[key]
            if item not in scan.files:
                raise KeyError(item)
            return f"{key}/{item}" if item in scan.versioned else None

    def thumbnail(self, key, item):
        with self.lock:
            icon = self.scans[key].icons.get(item)
        if icon is None:
            return None
        cancel = Gio.Cancellable()
        timer = Timer(8, cancel.cancel)
        timer.daemon = True
        timer.start()
        try:
            stream, _ = icon.load(360, cancel)
            try:
                chunks = bytearray()
                while len(chunks) < 4 * 1024 * 1024:
                    chunk = stream.read_bytes(65536, cancel).get_data()
                    if not chunk:
                        return bytes(chunks) or None
                    chunks.extend(chunk)
            finally:
                stream.close(None)
        except GLib.Error:
            pass
        finally:
            timer.cancel()
        return None

    def resolve(self, key, item):
        with self.lock:
            path = self.scans[key].files[item]
            root = self.devices[key].root
        path = path.resolve(strict=True)
        if not root or not path.is_relative_to(root.resolve()) or not path.is_file():
            raise KeyError(item)
        return path
