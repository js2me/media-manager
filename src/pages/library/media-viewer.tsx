import type { ViewerPhotos } from "./viewer-photos";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { Minus, Plus, Scan } from "lucide-solid";
import { mediaUrl, type Media } from "../../entities/media";
import { t } from "../../shared/i18n";

export function MediaViewer(props: { item: Media; device: string; photos: ViewerPhotos }) {
  let playback: "original" | "segments" | "stream" = "original";
  let player: import("hls.js").default | undefined;
  let disposed = false;
  let videoElement: HTMLVideoElement | undefined;
  const [preparing, setPreparing] = createSignal(false);
  const previewUrl = () => `api/video-preview/${props.device}/${props.item.id}`;

  function stream(video: HTMLVideoElement) {
    if (disposed || playback === "stream") return;
    playback = "stream";
    player?.destroy();
    player = undefined;
    video.src = previewUrl() + "/stream.mp4";
  }

  async function useCompatible(video: HTMLVideoElement) {
    if (disposed) return;
    if (playback === "stream") {
      setFailed(true);
      return;
    }
    if (playback === "segments") {
      stream(video);
      return;
    }
    playback = "segments";
    setPreparing(true);
    try {
      const { default: Hls } = await import("hls.js");
      if (disposed || playback !== "segments") return;
      if (Hls.isSupported()) {
        player = new Hls({ maxBufferLength: 8, maxMaxBufferLength: 12 });
        player.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) stream(video); });
        player.loadSource(previewUrl() + "/index.m3u8");
        player.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = previewUrl() + "/index.m3u8";
      } else stream(video);
    } catch { stream(video); }
  }

  onCleanup(() => {
    disposed = true;
    player?.destroy();
    if (videoElement) {
      videoElement.removeAttribute("src");
      videoElement.load();
    }
  });
  const [zoom, setZoom] = createSignal(1);
  const [failed, setFailed] = createSignal(false);
  const [dimensions, setDimensions] = createSignal({ width: 0, height: 0 });
  const [viewport, setViewport] = createSignal({ width: 0, height: 0 });
  let stage!: HTMLDivElement;
  let photo: HTMLImageElement | undefined;
  let drag: { x: number; y: number; left: number; top: number } | undefined;
  const width = () => {
    const size = dimensions(),
      area = viewport();
    if (!size.width || !area.width) return undefined;
    return (
      Math.min(
        area.width,
        (area.height * size.width) / size.height,
        size.width,
      ) * zoom()
    );
  };

  function magnify(value: number, x?: number, y?: number) {
    if (!photo || !dimensions().width) return;
    const target = Math.min(8, Math.max(1, value));
    if (target === zoom()) return;
    const bounds = stage.getBoundingClientRect(),
      before = photo.getBoundingClientRect();
    const cx = x ?? bounds.left + stage.clientWidth / 2;
    const cy = y ?? bounds.top + stage.clientHeight / 2;
    const fx = Math.min(1, Math.max(0, (cx - before.left) / before.width));
    const fy = Math.min(1, Math.max(0, (cy - before.top) / before.height));
    setZoom(target);
    const after = photo.getBoundingClientRect();
    stage.scrollBy(
      after.left + fx * after.width - cx,
      after.top + fy * after.height - cy,
    );
  }

  if (props.item.kind === "photo") {
    const image = props.photos.get(mediaUrl(props.device, props.item), true);
    photo = image;
    image.className = "full";
    image.alt = props.item.name;
    image.draggable = false;
    const loaded = () => setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
    const error = () => setFailed(true);
    const doubleClick = (e: MouseEvent) =>
      magnify(zoom() === 1 ? 2 : 1, e.clientX, e.clientY);
    image.addEventListener("load", loaded);
    image.addEventListener("error", error);
    image.addEventListener("dblclick", doubleClick);
    if (image.complete && image.naturalWidth) loaded();
    createEffect(() => {
      const pixels = width();
      image.style.width = pixels === undefined ? "" : pixels + "px";
    });
    onCleanup(() => {
      image.removeEventListener("load", loaded);
      image.removeEventListener("error", error);
      image.removeEventListener("dblclick", doubleClick);
    });
  }

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      // Use the border box so scrollbar appearance does not change the fit scale.
      const rect = entry.target.getBoundingClientRect();
      setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(stage);
    function wheel(event: WheelEvent) {
      if (!photo || failed()) return;
      event.preventDefault();
      magnify(
        zoom() * (event.deltaY < 0 ? 1.25 : 0.8),
        event.clientX,
        event.clientY,
      );
    }
    stage.addEventListener("wheel", wheel, { passive: false });
    onCleanup(() => {
      observer.disconnect();
      stage.removeEventListener("wheel", wheel);
    });
  });

  return (
    <>
      <div
        class="viewer-stage"
        ref={stage}
        classList={{ magnified: zoom() > 1 }}
        onPointerDown={(e) => {
          if (zoom() <= 1 || e.button !== 0 || e.target !== photo) return;
          stage.setPointerCapture(e.pointerId);
          drag = {
            x: e.clientX,
            y: e.clientY,
            left: stage.scrollLeft,
            top: stage.scrollTop,
          };
        }}
        onPointerMove={(e) => {
          if (drag)
            stage.scrollTo(
              drag.left + drag.x - e.clientX,
              drag.top + drag.y - e.clientY,
            );
        }}
        onLostPointerCapture={() => {
          drag = undefined;
        }}
      >
        <Show when={!failed()} fallback={<p>{t("previewError")}</p>}>
          <Show
            when={props.item.kind === "photo"}
            fallback={
              <>
                <video
                  autoplay
                  controls
                  playsinline
                  preload="auto"
                  poster={mediaUrl(props.device, props.item, true)}
                  ref={videoElement}
                  src={mediaUrl(props.device, props.item)}
                  onLoadedData={() => setPreparing(false)}
                  onLoadedMetadata={(e) => {
                    const video = e.currentTarget;
                    if (!video.videoWidth) {
                      useCompatible(video);
                      return;
                    }
                  }}
                  onError={(e) => useCompatible(e.currentTarget)}
                />
                <Show when={preparing()}>
                  <span class="video-status" role="status">
                    {t("preparingVideo")}
                  </span>
                </Show>
              </>
            }
          >
            {photo}
          </Show>
        </Show>
      </div>
      <Show when={props.item.kind === "photo" && !failed()}>
        <div class="viewer-scale">
          <button
            disabled={zoom() <= 1}
            aria-label={t("zoomOut")}
            title={t("zoomOut")}
            onClick={() => magnify(zoom() / 1.5)}
          >
            <Minus size={18} />
          </button>
          <output>{Number(zoom().toFixed(2))}×</output>
          <button
            disabled={!dimensions().width || zoom() >= 8}
            aria-label={t("zoomIn")}
            title={t("zoomIn")}
            onClick={() => magnify(zoom() * 1.5)}
          >
            <Plus size={18} />
          </button>
          <button
            disabled={zoom() === 1}
            aria-label={t("fit")}
            title={t("fit")}
            onClick={() => magnify(1)}
          >
            <Scan size={18} />
          </button>
        </div>
      </Show>
    </>
  );
}
