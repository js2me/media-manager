"""Verified media transfers to an existing local directory on Linux."""
import ctypes
import errno
import hashlib
import os
import stat
import tempfile
from pathlib import Path
from threading import Event, Lock, Thread

from gi.repository import Gio
from transfer_profile import grouped_path, profile, save_profile

BLOCK = 1024 * 1024


def destinations():
    paths = [Path.home()]
    for mount in Gio.VolumeMonitor.get().get_mounts():
        root = mount.get_root()
        if root.get_uri_scheme() == "file" and root.get_path():
            paths.append(Path(root.get_path()))
    return [dict(path=str(p), disk=str(p.stat().st_dev)) for p in dict.fromkeys(paths)
            if p.is_dir() and os.access(p, os.W_OK)]


def digest(stream, stop, output=None):
    result = hashlib.sha256()
    while not stop.is_set():
        block = stream.read(BLOCK)
        if not block:
            return result.digest()
        result.update(block)
        if output:
            output.write(block)
    raise InterruptedError()


def signature(st):
    return st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns


def publish(temp, final):
    # RENAME_NOREPLACE atomically rejects collisions, including parallel writers.
    rename = ctypes.CDLL(None, use_errno=True).renameat2
    if rename(-100, os.fsencode(temp), -100, os.fsencode(final), 1):
        code = ctypes.get_errno()
        if code in {errno.EINVAL, errno.ENOSYS, errno.EOPNOTSUPP}:
            # NTFS-3G supports exclusive hard links but rejects renameat2 flags.
            os.link(temp, final)
        else:
            raise OSError(code, os.strerror(code), str(final))


def verified_copy(source, final, size, stop):
    if final.is_symlink():
        raise FileExistsError(str(final))
    with source.open("rb") as src:
        original = os.fstat(src.fileno())
        if size is not None and size != original.st_size:
            raise OSError("Source size changed")
        if final.exists():
            if final.samefile(source) or not final.is_file() or final.stat().st_size != original.st_size:
                raise FileExistsError(str(final))
            expected = digest(src, stop)
            with final.open("rb") as saved:
                if digest(saved, stop) != expected:
                    raise FileExistsError(str(final))
                checked = signature(os.fstat(saved.fileno()))
                os.fsync(saved.fileno())
            action = "matched"
        else:
            with tempfile.NamedTemporaryFile(dir=final.parent, prefix=".photo-import-", delete=False) as out:
                temp = Path(out.name)
            try:
                with temp.open("w+b") as out:
                    expected = digest(src, stop, out)
                    if out.tell() != original.st_size:
                        raise OSError("Incomplete source")
                    out.flush()
                    os.utime(out.fileno(), ns=(original.st_atime_ns, original.st_mtime_ns))
                    os.fsync(out.fileno())
                    out.seek(0)
                    if digest(out, stop) != expected:
                        raise OSError("Checksum mismatch")
                    checked = signature(os.fstat(out.fileno()))
                publish(temp, final)
            finally:
                temp.unlink(missing_ok=True)
            action = "copied"
        if signature(source.stat()) != signature(original) or signature(final.stat()) != checked:
            raise OSError("File changed during transfer")
        fsync_directory(final.parent)
        return action, signature(original), checked


def remove_verified(source, final, receipt, stop, check_devices):
    _, original, checked = receipt
    with source.open("rb") as src, final.open("rb") as saved:
        if signature(os.fstat(src.fileno())) != original or signature(os.fstat(saved.fileno())) != checked:
            raise OSError("File changed since verification")
        if digest(src, stop) != digest(saved, stop):
            raise OSError("Checksum mismatch before deletion")
        check_devices()
        if signature(source.lstat()) != original or signature(final.lstat()) != checked:
            raise OSError("File changed before deletion")
        if stop.is_set():
            raise InterruptedError()
        source.unlink()


def fsync_directory(path):
    fd = os.open(path, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class Transfers:
    def __init__(self, library):
        self.library = library
        self.lock = Lock()
        self.stop = Event()
        self.state = dict(status="idle")

    def snapshot(self):
        with self.lock:
            return self.state.copy()

    def update(self, **values):
        with self.lock:
            self.state.update(values)

    def start(self, key, path, disk, move, grouping="original", folders=None, language="en", months=None):
        if language not in ("en", "ru"):
            raise ValueError("profileError")
        settings = profile(grouping, folders, move, months)
        selected_months = set(months) if months is not None else None
        selected = set(folders) if folders is not None else None
        dest = Path(path)
        if not dest.is_absolute() or not dest.is_dir():
            raise ValueError("destinationError")
        dest = dest.resolve(strict=True)
        with self.library.lock:
            device = self.library.devices[key]
            scan = self.library.scans[key]
            if not device.root or not scan.done or scan.failed or not scan.items:
                raise ValueError("scanRequired")
            root = device.root.resolve(strict=True)
            source_identity = root.stat()
            entries = []
            for item in scan.items:
                if selected_months is not None and item["eventMonth"] not in selected_months:
                    continue
                if selected is None or item["folder"] in selected:
                    rel = scan.files[item["id"]].relative_to(root)
                    entries.append((rel, grouped_path(rel, item, grouping, language), item["size"]))
            if not entries:
                raise ValueError("selectFolders")
        if root.is_relative_to(dest) or dest.is_relative_to(root) or dest.is_relative_to(Path("/run/user") / str(os.getuid()) / "gvfs"):
            raise ValueError("destinationError")
        fd = os.open(dest, os.O_DIRECTORY)
        try:
            dev = os.fstat(fd).st_dev
            if disk and str(dev) != disk:
                raise ValueError("destinationError")
            if dest.parts[1:2] in [("mnt",), ("media",)] and dev == Path("/").stat().st_dev:
                raise ValueError("destinationError")
            with self.lock:
                if self.state["status"] == "running":
                    raise ValueError("transferBusy")
                save_profile(Path(f"/proc/self/fd/{fd}"), settings)
                os.fsync(fd)
                self.stop = Event()
                self.state = dict(status="running", total=len(entries), copied=0, matched=0,
                                  removed=0, file="", destination=str(dest), device=device.name, error="")
                self.worker = Thread(target=self.run, args=(key, scan, root, source_identity, dest, fd, entries, move), daemon=False)
                self.worker.start()
        except BaseException:
            os.close(fd)
            raise
        return self.snapshot()

    def close(self):
        self.stop.set()
        worker = getattr(self, "worker", None)
        if worker:
            worker.join()

    def run(self, key, scan, root, source_identity, dest, fd, entries, move):
        # Anchor writes to the selected filesystem even if its mount disappears.
        base = Path(f"/proc/self/fd/{fd}")
        counts = dict(copied=0, matched=0, removed=0)
        try:
            destination_identity = os.fstat(fd)
            receipts = []
            synced_parents = set()

            def check_devices():
                if self.stop.is_set():
                    raise InterruptedError()
                with self.library.lock:
                    if self.library.scans.get(key) is not scan:
                        raise OSError("Source disconnected or rescanned")
                if not os.path.samestat(source_identity, root.stat()) or not os.path.samestat(destination_identity, dest.stat()):
                    raise OSError("Source or destination changed")

            def check_source(source):
                if source.resolve(strict=True) != source or source.stat().st_dev != source_identity.st_dev or not stat.S_ISREG(source.stat().st_mode):
                    raise ValueError("sourceError")

            for rel, target, size in entries:
                check_devices()
                self.update(file=str(rel))
                source = root / rel
                check_source(source)
                folder = base
                for part in target.parts[:-1]:
                    parent = folder
                    folder = folder / part
                    if folder.is_symlink():
                        raise ValueError("destinationError")
                    if not folder.is_dir():
                        folder.mkdir()
                        fsync_directory(parent)
                    elif move and parent not in synced_parents:
                        # A retry may find a directory created just before a previous crash.
                        fsync_directory(parent)
                    synced_parents.add(parent)
                    if folder.stat().st_dev != os.fstat(fd).st_dev:
                        raise ValueError("destinationError")
                receipt = verified_copy(source, folder / rel.name, size, self.stop)
                if move:
                    receipts.append((rel, target, receipt))
                counts[receipt[0]] += 1
                self.update(**counts)
            check_devices()
            if move:
                self.update(phase="removing")
                for rel, target, receipt in receipts:
                    check_devices()
                    self.update(file=str(rel))
                    source = root / rel
                    check_source(source)
                    remove_verified(source, base / target, receipt, self.stop, check_devices)
                    counts["removed"] += 1
                    self.update(**counts)
            status = "done"
        except InterruptedError:
            status = "stopped"
        except FileExistsError:
            status = "failed"
            self.update(error="fileConflict")
        except OSError as error:
            status = "failed"
            self.update(error="diskFull" if error.errno == errno.ENOSPC else "transferError",
                        detail=str(error))
        except Exception as error:
            status = "failed"
            self.update(error="transferError", detail=str(error))
        finally:
            os.close(fd)
            if counts["removed"]:
                with self.library.lock:
                    if self.library.scans.get(key) is scan:
                        self.library.scans.pop(key)
        self.update(status=status)
