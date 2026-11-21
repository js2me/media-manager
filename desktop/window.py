import shutil
import subprocess
import tempfile
from threading import Thread

from gi.repository import GLib, Gtk, WebKit2


def show_window(window, url):
    settings = WebKit2.Settings()
    chrome = shutil.which("google-chrome") or shutil.which("chromium")
    if chrome and settings.get_hardware_acceleration_policy() == WebKit2.HardwareAccelerationPolicy.NEVER:
        # On systems without accelerated WebKit compositing, use a dedicated app window.
        # Its lifetime and cookies are independent of the user's browsing session.
        with tempfile.TemporaryDirectory(prefix="photo-library-") as profile:
            try:
                process = subprocess.Popen([
                    chrome, f"--app={url}", f"--user-data-dir={profile}", "--window-size=1160,780",
                    "--no-first-run", "--no-default-browser-check", "--disable-background-mode",
                    "--disable-features=Translate",
                ])
            except OSError:
                process = None
            if process:
                def closed():
                    process.wait()
                    GLib.idle_add(Gtk.main_quit)
                Thread(target=closed, daemon=True).start()
                Gtk.main()
                if process.returncode == 0:
                    return

    web = WebKit2.WebView()
    web.connect("notify::title", lambda view, _: window.set_title(view.get_title() or "Photo Library"))
    web.load_uri(url)
    window.add(web)
    window.connect("destroy", Gtk.main_quit)
    window.show_all()
    Gtk.main()
