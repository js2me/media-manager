import select
import subprocess
import tempfile
from pathlib import Path
from threading import Lock


class VideoPreview:
    """Keep one seekable compatibility copy for the currently viewed video."""

    def __init__(self):
        self.directory = tempfile.TemporaryDirectory(prefix="photo-library-video-")
        self.lock = Lock()
        self.key = None

    def open(self, key, source, connection):
        output = Path(self.directory.name, "preview.mp4")
        with self.lock:
            if self.key != key:
                self.key = None
                # Existing HTTP readers keep their own handle to the previous inode.
                output.unlink(missing_ok=True)
                poll = select.poll()
                poll.register(connection, select.POLLHUP | select.POLLERR | select.POLLRDHUP)
                if poll.poll(0):
                    raise ConnectionResetError()
                command = ["ffmpeg", "-nostdin", "-v", "error", "-threads", "4", "-i", str(source),
                           "-map", "0:V:0", "-map", "0:a:0?", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                           "-c:v", "libx264", "-threads", "4", "-preset", "veryfast", "-crf", "23",
                           "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2", "-movflags", "+faststart", str(output)]
                with subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:
                    try:
                        while process.poll() is None:
                            if poll.poll(150):
                                raise ConnectionResetError()
                        if process.returncode:
                            raise OSError("Video conversion failed")
                    finally:
                        if process.poll() is None:
                            process.kill()
                        process.wait()
                        if process.returncode:
                            output.unlink(missing_ok=True)
                self.key = key
            return output.open("rb")
