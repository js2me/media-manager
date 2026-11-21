"""Disposable per-user thumbnail store; filesystem failures only disable caching."""
import os
import sqlite3
from contextlib import closing
from pathlib import Path


class ThumbnailCache:
    def __init__(self):
        root = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache")
        self.directory = root / "ios-photo-manager"
        self.database = self.directory / "previews.sqlite3"
        try:
            self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            with closing(sqlite3.connect(self.database)) as db:
                db.execute("CREATE TABLE IF NOT EXISTS previews (key TEXT UNIQUE, data BLOB)")
        except (OSError, sqlite3.Error):
            self.database = None

    def get(self, key):
        if self.database and key:
            try:
                with closing(sqlite3.connect(self.database)) as db:
                    row = db.execute("SELECT data FROM previews WHERE key=?", (key,)).fetchone()
                return row[0] if row else None
            except sqlite3.Error:
                pass

    def put(self, key, data):
        if not self.database or not key or not data or len(data) > 4 * 1024 * 1024:
            return
        try:
            with closing(sqlite3.connect(self.database)) as db, db:
                db.execute("INSERT OR IGNORE INTO previews VALUES (?, ?)", (key, data))
                used, = db.execute("SELECT (page_count-freelist_count)*page_size "
                                   "FROM pragma_page_count, pragma_freelist_count, pragma_page_size").fetchone()
                if used > 128 * 1024 * 1024:
                    db.execute("DELETE FROM previews WHERE rowid IN "
                               "(SELECT rowid FROM previews ORDER BY rowid LIMIT 128)")
        except sqlite3.Error:
            pass
