"""Ubuntu device discovery. Called from the GTK main thread."""
from dataclasses import dataclass
from pathlib import Path

from gi.repository import Gio

PROTOCOLS = {"mtp", "gphoto2", "afc"}


@dataclass
class Device:
    uri: str
    name: str
    root: Path | None
    volume: object = None
    external: bool = False


class UbuntuDevices:
    def __init__(self):
        self.monitor = Gio.VolumeMonitor.get()

    def list(self):
        devices = {}
        for volume in self.monitor.get_volumes():
            location = volume.get_activation_root()
            if location and location.get_uri_scheme() in PROTOCOLS:
                uri = location.get_uri()
                devices[uri] = Device(uri, volume.get_name(), None, volume)
        for mount in self.monitor.get_mounts():
            root = mount.get_root()
            if root.is_native():
                drive = mount.get_drive()
                if drive and (drive.is_removable() or drive.is_media_removable() or drive.can_eject()):
                    uri = root.get_uri()
                    # Keep the preview cache scoped to the volume when mount paths are reused.
                    uuid = mount.get_uuid()
                    key = f"{uuid}:{uri}" if uuid else uri
                    devices[key] = Device(uri, mount.get_name(), Path(root.get_path()), external=True)
                continue
            if root.get_uri_scheme() not in PROTOCOLS:
                continue
            volume = mount.get_volume()
            location = volume and volume.get_activation_root()
            uri = (location or root).get_uri()
            path = root.get_path()
            if root.get_uri_scheme() == "afc" and ":3" in root.get_uri().split("/")[2]:
                # The House Arrest service exposes app documents, not camera media.
                devices.pop(uri, None)
                continue
            known = devices.get(uri)
            name = known.name if known else mount.get_name()
            devices[uri] = Device(uri, name, Path(path) if path else None,
                                  volume or (known and known.volume))
        return {key: device for key, device in devices.items()
                if not (key.startswith("afc://") and ":3" in key.split("/")[2])}
