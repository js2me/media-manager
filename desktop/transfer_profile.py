"""Portable settings stored alongside an imported library."""
import json
import os
import tempfile
from datetime import datetime
from pathlib import Path

FILENAME = ".photo-library-transfer.json"
LIMIT = 4 * 1024 * 1024


def profile(grouping="original", folders=None, move=False):
    if grouping not in ("original", "month", "type") or type(move) is not bool:
        raise ValueError("profileError")
    if folders is not None:
        if not isinstance(folders, list) or not folders:
            raise ValueError("selectFolders")
        for folder in folders:
            if not isinstance(folder, str) or not folder or Path(folder).is_absolute() or ".." in Path(folder).parts:
                raise ValueError("profileError")
        folders = sorted(set(folders))
    return dict(version=1, grouping=grouping, folders=folders, move=move)


def read_profile(directory):
    directory = Path(directory)
    if not directory.is_absolute() or not directory.is_dir():
        raise ValueError("destinationError")
    try:
        fd = os.open(directory / FILENAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    with os.fdopen(fd, "rb") as stream:
        raw = stream.read(LIMIT + 1)
    if len(raw) > LIMIT:
        raise ValueError("profileError")
    data = json.loads(raw)
    if not isinstance(data, dict) or data.get("version") != 1:
        raise ValueError("profileError")
    return profile(data["grouping"], data["folders"], data["move"])


def save_profile(directory, settings):
    read_profile(directory)  # Preserve an unrecognized or damaged configuration.
    payload = json.dumps(settings, ensure_ascii=False, indent=2).encode() + b"\n"
    if len(payload) > LIMIT:
        raise ValueError("profileError")
    with tempfile.NamedTemporaryFile(dir=directory, delete=False) as temp:
        name = temp.name
        try:
            temp.write(payload)
            temp.flush()
            os.fsync(temp.fileno())
            os.replace(name, directory / FILENAME)
        finally:
            Path(name).unlink(missing_ok=True)


def grouped_path(relative, item, grouping):
    if grouping == "month":
        stamp = item["modified"]
        prefix = datetime.fromtimestamp(stamp).strftime("%Y/%m") if stamp is not None else "Unknown-date"
        return Path(prefix) / relative
    if grouping == "type":
        return Path("Videos" if item["kind"] == "video" else "Photos") / relative
    return relative
