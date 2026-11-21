"""Portable settings stored alongside an imported library."""
import json
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path

FILENAME = ".photo-library-transfer.json"
LIMIT = 4 * 1024 * 1024


def event_month(folder, stamp):
    album = re.fullmatch(r"((?:19|20)\d{2})(0[1-9]|1[0-2])_[a-z]+", Path(folder).name, re.I)
    if album:
        return "-".join(album.groups())
    if stamp and stamp > 0:
        try:
            return datetime.fromtimestamp(stamp).strftime("%Y-%m")
        except (OSError, OverflowError, ValueError):
            pass
    return "unknown"


def profile(grouping="original", folders=None, move=False, months=None):
    if grouping not in ("original", "month", "type", "events") or type(move) is not bool:
        raise ValueError("profileError")
    if folders is not None:
        if not isinstance(folders, list) or not folders:
            raise ValueError("selectFolders")
        for folder in folders:
            if not isinstance(folder, str) or not folder or Path(folder).is_absolute() or ".." in Path(folder).parts:
                raise ValueError("profileError")
        folders = sorted(set(folders))
    if months is not None:
        if folders is not None or not isinstance(months, list) or not months:
            raise ValueError("selectFolders")
        if any(not isinstance(m, str) or not re.fullmatch(r"(?:[0-9]{4}-(?:0[1-9]|1[0-2])|unknown)", m) for m in months):
            raise ValueError("profileError")
        months = sorted(set(months))
    return dict(version=2 if months is not None or grouping == "events" else 1, months=months, grouping=grouping, folders=folders, move=move)


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
    if not isinstance(data, dict) or data.get("version") not in (1, 2):
        raise ValueError("profileError")
    return profile(data["grouping"], data["folders"], data["move"], data["months"] if data["version"] == 2 else None)


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


MONTH_NAMES = {
    "ru": "январь февраль март апрель май июнь июль август сентябрь октябрь ноябрь декабрь".split(),
    "en": "January February March April May June July August September October November December".split(),
}


def grouped_path(relative, item, grouping, language="en"):
    relative = Path(item.get("archiveFolder", relative.parent)) / relative.name
    if grouping == "events":
        month = item["eventMonth"]
        return Path("Unknown-date" if month == "unknown" else month.replace("-", "/")) / relative
    if grouping == "month":
        stamp = item["modified"]
        prefix = "Unknown-date"
        if stamp is not None:
            date = datetime.fromtimestamp(stamp)
            prefix = f"{date.year}/{MONTH_NAMES[language][date.month - 1]}"
        return Path(prefix) / relative
    if grouping == "type":
        return Path("Videos" if item["kind"] == "video" else "Photos") / relative
    return relative
