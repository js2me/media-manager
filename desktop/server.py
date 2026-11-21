import json
import os
import mimetypes
import re
import secrets
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import BoundedSemaphore
from urllib.parse import parse_qs, unquote, urlsplit

from transfer_profile import LIMIT, read_profile
from transfer import Transfers, destinations
from thumbnail_cache import ThumbnailCache
from video_preview import VideoPreview

DIST = Path(__file__).resolve().parents[1] / "dist"
workers = BoundedSemaphore(3)


def preview(path, small):
    with workers, tempfile.TemporaryDirectory() as directory:
        source = path
        if path.suffix.lower() in {".heic", ".heif"}:
            source = Path(directory, "image.jpg")
            subprocess.run(["heif-convert", str(path), str(source)], check=True,
                           capture_output=True, timeout=120)
            if not source.exists():
                source = next(iter(sorted(Path(directory).glob("*.jpg"))), source)
            if not small:
                return source.read_bytes()
        size = 360 if small else 2400
        return subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(source),
                               "-frames:v", "1", "-vf", f"scale={size}:{size}:force_original_aspect_ratio=decrease",
                               "-threads", "1", "-f", "image2pipe", "-c:v", "mjpeg", "-"],
                              capture_output=True, check=True, timeout=120).stdout


def create_server(library, connect, choose_folder=None):
    transfers = Transfers(library)
    thumbnails = ThumbnailCache()
    videos = VideoPreview()
    token = secrets.token_urlsafe(24)
    config = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    language_file = config / "ios-photo-manager" / "language"

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, payload, mime="application/json", cache=False):
            if mime == "application/json":
                payload = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Cache-Control", "private, max-age=3600" if cache else "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def file(self, path):
            with path.open("rb") as stream:
                self.stream_file(stream, mimetypes.guess_type(path)[0] or "application/octet-stream")

        def stream_file(self, stream, mime):
            size = stream.seek(0, 2)
            start, end = 0, size - 1
            requested = self.headers.get("Range")
            if requested:
                match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested)
                if match and any(match.groups()):
                    left, right = match.groups()
                    start = int(left) if left else max(0, size - int(right))
                    end = min(end, int(right)) if left and right else end
                else:
                    start = size
                if start > end:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.end_headers()
                    return
            self.send_response(206 if requested else 200)
            if requested:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(end - start + 1))
            self.end_headers()
            stream.seek(start)
            left = end - start + 1
            while left:
                block = stream.read(min(left, 262144))
                if not block:
                    break
                self.wfile.write(block)
                left -= len(block)


        def do_GET(self):
            url = unquote(urlsplit(self.path).path)
            prefix = f"/{token}/"
            if not url.startswith(prefix):
                return self.send_error(404)
            route = url[len(prefix):]
            parts = route.split("/")
            try:
                if route == "api/language":
                    try:
                        language = language_file.read_bytes()
                    except FileNotFoundError:
                        language = b"en"
                    self.reply("ru" if language == b"ru" else "en")
                elif route == "api/transfer":
                    self.reply(transfers.snapshot())
                elif route == "api/destinations":
                    self.reply(destinations())
                elif route == "api/devices":
                    with library.lock:
                        data = [dict(id=k, name=v.name, mounted=bool(v.root), external=v.external) for k,v in library.devices.items()]
                    self.reply(data)
                elif len(parts) == 3 and parts[:2] == ["api", "library"]:
                    query = parse_qs(urlsplit(self.path).query)
                    offset = max(0, int(query.get("offset", ["0"])[0]))
                    self.reply(library.scan(parts[2], offset, query.get("refresh") == ["1"]))
                elif len(parts) == 4 and parts[:2] == ["api", "video-preview"]:
                    source = library.resolve(*parts[2:])
                    with videos.open(tuple(parts[2:]), source, self.connection) as stream:
                        self.stream_file(stream, "video/mp4")
                elif len(parts) == 4 and parts[0] == "api" and parts[1] in {"media", "thumb"}:
                    small = parts[1] == "thumb"
                    if small:
                        cache_key = library.cache_key(*parts[2:])
                        data = thumbnails.get(cache_key)
                        if not data:
                            data = library.thumbnail(*parts[2:]) or preview(library.resolve(*parts[2:]), True)
                            thumbnails.put(cache_key, data)
                        self.reply(data, "image/png" if data.startswith(b"\x89PNG") else "image/jpeg", True)
                        return
                    path = library.resolve(*parts[2:])
                    if path.suffix.lower() in {".heic", ".heif", ".tiff", ".tif", ".dng"}:
                        self.reply(preview(path, small), "image/jpeg", True)
                    else:
                        self.file(path)
                else:
                    path = (DIST / (route or "index.html")).resolve()
                    if not path.is_relative_to(DIST) or not path.is_file():
                        return self.send_error(404)
                    self.file(path)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except KeyError:
                self.send_error(404)
            except (ValueError, OSError, subprocess.SubprocessError):
                self.send_error(503)

        def do_POST(self):
            if self.path == f"/{token}/api/transfer-profile":
                try:
                    size = int(self.headers.get("Content-Length", 0))
                    if not 0 < size < 16384:
                        raise ValueError()
                    path = json.loads(self.rfile.read(size))["path"]
                    self.reply(read_profile(path))
                except (ValueError, KeyError, TypeError, OSError):
                    self.send_error(400)
                return
            if self.path == f"/{token}/api/choose-folder" and choose_folder:
                try:
                    length = int(self.headers.get("Content-Length", 0))
                    if not 0 < length < 16384:
                        raise ValueError()
                    data = json.loads(self.rfile.read(length))
                    selected = choose_folder(data["path"], data["language"])
                    self.reply(dict(path=selected, disk=str(os.stat(selected).st_dev)) if selected else None)
                except (ValueError, KeyError, TypeError, OSError):
                    self.send_error(400)
                return
            if self.path == f"/{token}/api/transfer/stop":
                transfers.stop.set()
                return self.reply(transfers.snapshot())
            if self.path == f"/{token}/api/transfer":
                try:
                    length = int(self.headers.get("Content-Length", 0))
                    if not 0 < length <= LIMIT:
                        raise ValueError("destinationError")
                    data = json.loads(self.rfile.read(length))
                    result = transfers.start(data["device"], data["path"], data.get("disk"),
                                             data.get("move") is True, data.get("grouping", "original"), data.get("folders"))
                except (ValueError, TypeError, OSError, KeyError) as error:
                    code = str(error)
                    result = dict(rejected=code if code in {"transferBusy", "scanRequired", "selectFolders", "profileError"} else "destinationError")
                return self.reply(result)
            language = re.fullmatch(f"/{token}/api/language/(en|ru)", self.path)
            if language:
                try:
                    language_file.parent.mkdir(parents=True, exist_ok=True)
                    with tempfile.NamedTemporaryFile(dir=language_file.parent, delete=False) as pending:
                        pending.write(language[1].encode())
                    os.replace(pending.name, language_file)
                    self.reply(language[1])
                except OSError:
                    self.send_error(503)
                return
            match = re.fullmatch(f"/{token}/api/connect/([0-9a-f]+)", self.path)
            if not match:
                return self.send_error(404)
            try:
                self.reply(connect(match[1]))
            except (KeyError, RuntimeError, TimeoutError):
                self.send_error(503)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.stop_transfers = transfers.close
    return server, f"http://127.0.0.1:{server.server_port}/{token}/"
