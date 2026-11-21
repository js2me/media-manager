import math
import os
import select
import subprocess

SEGMENT_SECONDS = 2


def playlist(source):
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                            "-of", "default=nw=1:nk=1", str(source)],
                           capture_output=True, timeout=20, check=True)
    duration = float(probe.stdout)
    if not math.isfinite(duration) or not 0 < duration <= 86400 * 30:
        raise ValueError("Unknown video duration")
    lines = ["#EXTM3U", "#EXT-X-VERSION:3", f"#EXT-X-TARGETDURATION:{SEGMENT_SECONDS}",
             "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-INDEPENDENT-SEGMENTS"]
    for index in range(math.ceil(duration / SEGMENT_SECONDS)):
        seconds = min(SEGMENT_SECONDS, duration - index * SEGMENT_SECONDS)
        lines.extend([f"#EXTINF:{seconds:.6f},", f"{index}.ts"])
    return ("\n".join([*lines, "#EXT-X-ENDLIST", ""])).encode()


def video_chunks(source, connection, index=None):
    command = ["ffmpeg", "-nostdin", "-loglevel", "error", "-threads", "4"]
    if index is not None:
        command += ["-ss", str(index * SEGMENT_SECONDS)]
    command += ["-i", str(source), "-map", "0:V:0", "-map", "0:a:0?",
                "-vf", "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
                "-c:v", "libx264", "-threads", "4", "-preset", "ultrafast", "-tune", "zerolatency",
                "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2"]
    if index is None:
        command += ["-movflags", "empty_moov+default_base_moof", "-frag_duration", "500000", "-f", "mp4"]
    else:
        command += ["-t", str(SEGMENT_SECONDS), "-output_ts_offset", str(index * SEGMENT_SECONDS),
                    "-muxdelay", "0", "-f", "mpegts"]
    with subprocess.Popen([*command, "pipe:1"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as process:
        poll = select.poll()
        poll.register(connection, select.POLLHUP | select.POLLERR | select.POLLRDHUP)
        poll.register(process.stdout, select.POLLIN)
        try:
            while True:
                for fd, event in poll.poll():
                    if fd == connection.fileno():
                        raise ConnectionResetError()
                    block = os.read(fd, 65536)
                    if not block:
                        if process.wait():
                            raise OSError("Video conversion failed")
                        return
                    yield block
        finally:
            if process.poll() is None:
                process.kill()
