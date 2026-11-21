from concurrent.futures import Future
from pathlib import Path
from threading import Thread

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gio, GLib, Gtk

from devices import UbuntuDevices
from library import Library
from server import create_server
from window import show_window


def choose_folder(window, initial, language):
    result = Future()
    russian = language == "ru"

    def show():
        chooser = Gtk.FileChooserDialog(
            title="Выбрать папку" if russian else "Choose folder",
            transient_for=window if window.get_visible() else None,
            action=Gtk.FileChooserAction.SELECT_FOLDER,
        )
        chooser.add_buttons("Отмена" if russian else "Cancel", Gtk.ResponseType.CANCEL,
                            "Выбрать" if russian else "Select", Gtk.ResponseType.OK)
        chooser.set_default_response(Gtk.ResponseType.OK)
        chooser.set_local_only(True)
        chooser.set_create_folders(True)
        chooser.set_modal(True)
        chooser.set_current_folder(str(initial))

        def finish(dialog, response):
            selected = dialog.get_filename() if response == Gtk.ResponseType.OK else None
            dialog.destroy()
            result.set_result(selected)

        chooser.connect("response", finish)
        chooser.show_all()
        chooser.present()
        return False

    initial = Path(initial)
    if not initial.is_absolute() or not initial.is_dir():
        initial = Path.home()
    GLib.idle_add(show)
    return result.result()


def main():
    monitor, library = UbuntuDevices(), Library()
    window = Gtk.Window(title="Photo Library")
    window.set_default_size(1160, 780)

    def refresh(*args):
        library.update(monitor.list())

    def connect(key):
        result = Future()

        def mounted(volume, response):
            try:
                volume.mount_finish(response)
                refresh()
                result.set_result(True)
            except GLib.Error as error:
                result.set_exception(RuntimeError(error.message))

        def mount():
            with library.lock:
                device = library.devices.get(key)
            if device and device.root:
                result.set_result(True)
            elif device and device.volume:
                device.volume.mount(Gio.MountMountFlags.NONE, Gtk.MountOperation.new(window),
                                    None, mounted)
            else:
                result.set_exception(KeyError(key))
            return False
        GLib.idle_add(mount)
        return result.result(timeout=90)

    for category in ("volume", "mount"):
        for event in ("added", "removed", "changed"):
            monitor.monitor.connect(f"{category}-{event}", refresh)
    refresh()
    server, url = create_server(library, connect, lambda path, lang: choose_folder(window, path, lang))
    Thread(target=server.serve_forever, daemon=True).start()
    show_window(window, url)
    server.shutdown()
    server.stop_transfers()
    server.server_close()


if __name__ == "__main__":
    main()
