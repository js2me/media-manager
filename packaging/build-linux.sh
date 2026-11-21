#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p 'require("./package.json").version')
build=${GITHUB_RUN_NUMBER:-1}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
out="$PWD/dist/packages"
mkdir -p "$out"
root="$work/package"
app="$root/usr/lib/media-manager"
mkdir -p "$app/desktop" "$app/dist"
install -m644 desktop/*.py "$app/desktop/"
install -m644 dist/index.html "$app/dist/"
cp -r dist/assets "$app/dist/"
install -Dm644 packaging/media-manager.desktop "$root/usr/share/applications/media-manager.desktop"
install -Dm644 packaging/media-manager.svg "$root/usr/share/icons/hicolor/scalable/apps/media-manager.svg"
mkdir -p "$root/usr/bin" "$root/DEBIAN"
cat > "$root/usr/bin/media-manager" <<'LAUNCH'
#!/bin/sh
exec /usr/bin/python3 /usr/lib/media-manager/desktop/main.py "$@"
LAUNCH
chmod +x "$root/usr/bin/media-manager"
cat > "$root/DEBIAN/control" <<CONTROL
Package: media-manager
Version: ${version}-${build}
Section: graphics
Priority: optional
Architecture: amd64
Maintainer: Sergey Volkov <js2me@outlook.com>
Depends: python3 (>= 3.10), python3-gi, gir1.2-gtk-3.0, gir1.2-webkit2-4.1, gvfs-backends, gvfs-fuse, usbmuxd, ffmpeg, libheif-examples, gstreamer1.0-libav, gstreamer1.0-plugins-good
Description: Browse and transfer photos and videos from connected devices
CONTROL
dpkg-deb --root-owner-group --build "$root" "$out/media-manager_${version}-${build}_amd64.deb"

appdir="$work/AppDir"
mkdir -p "$appdir"
mv "$root/usr" "$appdir/"
cp packaging/media-manager.{desktop,svg} "$appdir/"
ln -s media-manager.svg "$appdir/.DirIcon"
cat > "$appdir/AppRun" <<'LAUNCH'
#!/bin/sh
exec /usr/bin/python3 "$(dirname "$0")/usr/lib/media-manager/desktop/main.py" "$@"
LAUNCH
chmod +x "$appdir/AppRun"
# Type 2 AppImage: the official runtime followed by the application SquashFS.
curl -fsSL --retry 3 https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64 -o "$work/runtime"
echo "2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d  $work/runtime" | sha256sum -c -
mksquashfs "$appdir" "$work/app.squashfs" -noappend -all-root -no-progress
image="$out/Media-Manager-${version}-build.${build}-x86_64.AppImage"
cat "$work/runtime" "$work/app.squashfs" > "$image"
chmod +x "$image"
