import {
  For,
  Show,
  createSignal,
  createEffect,
  createMemo,
  onCleanup,
} from "solid-js";
import { useCreateViewModel } from "mobx-view-model-solid";
import {
  Aperture,
  Camera,
  ChevronRight,
  ChevronLeft,
  CircleHelp,
  Film,
  Folder,
  Grid2X2,
  Image as ImageIcon,
  Images,
  Play,
  RefreshCw,
  LoaderCircle,
  Settings,
  Smartphone,
  HardDrive,
  Usb,
  X,
} from "lucide-solid";
import { locale, t } from "../../shared/i18n";
import { ViewerPhotos } from "./viewer-photos";
import { MediaViewer } from "./media-viewer";
import { Select } from "../../shared/ui/select";
import { LibraryToolbar } from "./toolbar";
import { TransferDialog } from "./transfer-dialog";
import { MediaGrid } from "./media-grid";
import { folderName, folderContexts } from "../../entities/media/folder-labels";
import { LibraryModel } from "./model";
import { mediaUrl, type Media } from "../../entities/media";

function Tile(props: { item: Media; device: string; open: () => void }) {
  const [loaded, setLoaded] = createSignal(false);
  const [attempt, setAttempt] = createSignal(0);
  let retryTimer: number | undefined;
  onCleanup(() => window.clearTimeout(retryTimer));
  const source = () =>
    mediaUrl(props.device, props.item, true) +
    (attempt() ? `?retry=${attempt()}` : "");
  function retry() {
    setLoaded(false);
    if (attempt() < 2) {
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(
        () => setAttempt((value) => value + 1),
        400 * (attempt() + 1),
      );
    }
  }
  return (
    <button class="tile" onClick={props.open}>
      <div class="thumb">
        <Show when={!loaded()}>
          <span class="thumb-placeholder" aria-hidden="true">
            {props.item.kind === "video" ? (
              <Film size={24} />
            ) : (
              <ImageIcon size={24} />
            )}
          </span>
        </Show>
        <img
          src={source()}
          alt=""
          decoding="async"
          loading="lazy"
          classList={{ ready: loaded() }}
          onLoad={() => setLoaded(true)}
          onError={retry}
        />
        <Show when={props.item.kind === "video"}>
          <Play class="play" size={20} />
        </Show>
      </div>
      <span title={props.item.name}>{props.item.name}</span>
    </button>
  );
}

export function LibraryPage() {
  const vm = useCreateViewModel(LibraryModel);
  const s = vm.state;
  const device = () => s.devices.find((d) => d.id === s.selected);
  const contexts = createMemo(() => folderContexts(s.folders, t("root")));
  const heading = () =>
    s.folder ? folderName(s.folder, t("root")) : t(s.filter);
  let settings!: HTMLDialogElement;
  const [help, setHelp] = createSignal(false);
  const previewIndex = createMemo(() =>
    s.preview ? vm.selection.indexOf(s.preview) : -1,
  );
  const viewerPhotos = new ViewerPhotos();
  createEffect(() => {
    const index = previewIndex();
    const items = index < 0 ? [] : vm.selection;
    const nearby = index < 0 ? [] : [items[index], items[index + 1], items[index - 1]];
    const urls = nearby.flatMap((item) =>
      item?.kind === "photo" ? [mediaUrl(s.selected, item)] : [],
    );
    viewerPhotos.retain(urls);
    for (const item of nearby.slice(1))
      if (item?.kind === "photo") viewerPhotos.get(mediaUrl(s.selected, item));
  });
  onCleanup(() => viewerPhotos.retain([]));
  function move(direction: number) {
    const index = previewIndex();
    const next = vm.selection[index + direction];
    if (index >= 0 && next) vm.patch({ preview: next });
  }
  function navigate(event: KeyboardEvent) {
    if (
      !dialog?.open ||
      !s.preview ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.target instanceof HTMLVideoElement
    )
      return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      move(event.key === "ArrowLeft" ? -1 : 1);
    }
  }
  window.addEventListener("keydown", navigate);
  onCleanup(() => window.removeEventListener("keydown", navigate));
  let dialog!: HTMLDialogElement;
  function close() {
    dialog.close();
  }
  function openHelp() {
    setHelp(true);
    dialog.showModal();
  }
  function open(item: Media) {
    setHelp(false);
    vm.patch({ preview: item });
    dialog.showModal();
  }
  createEffect(() => {
    const hasContent = help() || Boolean(s.preview);
    if (!hasContent && dialog?.open) close();
  });
  const filters = [
    { id: "all", icon: Grid2X2 },
    { id: "photo", icon: ImageIcon },
    { id: "video", icon: Film },
  ] as const;
  return (
    <div class="shell">
      <aside>
        <div class="brand">
          <span>
            <Aperture size={25} />
          </span>
          {t("brand")}
        </div>
        <div class="device-picker">
          <Select
            label={t("device")}
            icon={device()?.external ? <HardDrive size={17} /> : <Smartphone size={17} />}
            options={s.devices.map((item) => item.id)}
            value={s.selected}
            text={(id) => s.devices.find((item) => item.id === id)?.name ?? t("noDevices")}
            disabled={!s.devices.length}
            onChange={(id) => { if (id !== s.selected) void vm.select(id); }}
          />
        </div>
        <h3>{t("library")}</h3>
        <nav>
          <For each={filters}>
            {(f) => (
              <button
                aria-pressed={s.filter === f.id && !s.folder}
                classList={{ active: s.filter === f.id && !s.folder }}
                onClick={() => vm.patch({ filter: f.id, folder: "" })}
              >
                <f.icon size={18} />
                {t(f.id)}
              </button>
            )}
          </For>
        </nav>
        <Show when={s.folders.length}>
          <h3>{t("folders")}</h3>
          <nav class="folders" aria-label={t("folders")}>
            <For each={s.folders}>
              {(f) => (
                <button
                  aria-pressed={s.folder === f}
                  classList={{ active: s.folder === f }}
                  title={f}
                  onClick={() => vm.patch({ folder: f, filter: "all" })}
                >
                  <Folder size={16} />
                  <span class="folder-label">
                    <span>{folderName(f, t("root"))}</span>
                    <Show when={contexts().get(f)}>
                      {(context) => <small>{context()}</small>}
                    </Show>
                  </span>
                </button>
              )}
            </For>
          </nav>
        </Show>
        <button class="help" onClick={() => settings.showModal()}>
          <Settings size={17} />
          {t("settings")}
        </button>
        <button class="help secondary-help" onClick={openHelp}>
          <CircleHelp size={17} />
          {t("help")}
        </button>
      </aside>
      <main>
        <Show when={s.busy}>
          <div class="scan-status" role="status" title={s.scanFolder || undefined}>
            <LoaderCircle class="spin" size={15} aria-hidden="true" />
            <span>{t("reading")}</span>
            <Show when={s.scanFolder}>
              <span class="scan-folder">{folderName(s.scanFolder, t("root"))}</span>
            </Show>
          </div>
        </Show>
        <header>
          <div class="location">
            <Images size={16} />
            <span>{t("library")}</span>
            <ChevronRight size={14} />
            <strong title={s.folder || undefined}>{heading()}</strong>
          </div>
          <TransferDialog model={vm} />
          <button
            class="refresh"
            disabled={s.busy}
            onClick={() => void vm.discover(true)}
          >
            <RefreshCw size={15} />
            {t("refresh")}
          </button>
        </header>
        <section class="content">
          <h1>{heading()}</h1>
          <p class="subtitle">{device() ? device()!.name : t("subtitle")}</p>
          <Show when={device()?.mounted}>
            <LibraryToolbar model={vm} />
          </Show>
          <Show when={s.error && t(s.error)}>
            <p role="alert" class="warning">
              {s.error && t(s.error)}
            </p>
          </Show>
          <Show when={s.skipped}>
            <p class="warning">
              {t("skipped")} · {s.skipped}
            </p>
          </Show>
          <Show when={!s.busy || s.total > 0}>
            <Show
              when={device()}
              fallback={
                <div class="connection-scene">
                  <div class="scene-credit" lang="en">
                    Big Dipper · Hajime Mizuno
                  </div>
                  <div class="connection-card">
                    <div class="connection-icon">
                      <Smartphone size={25} aria-hidden="true" />
                    </div>
                    <h2>{t("connectTitle")}</h2>
                    <p>{t("connectText")}</p>
                    <button class="primary" onClick={openHelp}>
                      <Usb size={16} />
                      {t("how")}
                    </button>
                  </div>
                </div>
              }
            >
              <Show
                when={device()?.mounted}
                fallback={
                  <div class="empty">
                    <Smartphone />
                    <h2>{t("access")}</h2>
                    <p>{t("unlock")}</p>
                    <button class="primary" onClick={() => void vm.connect()}>
                      {t("connect")}
                    </button>
                  </div>
                }
              >
                <Show
                  when={vm.selection.length}
                  fallback={
                    <div class="empty">
                      <Camera size={38} />
                      <h2>
                        {s.error
                          ? t("unavailable")
                          : s.dateFrom || s.dateTo || s.query || s.extension || s.filter !== "all"
                            ? t("noMatches")
                            : t("empty")}
                      </h2>
                    </div>
                  }
                >
                  <p class="count">
                    {t("files")} · {vm.selection.length}
                  </p>
                  <MediaGrid
                    items={vm.selection}
                    count={vm.selection.length}
                    selectionKey={JSON.stringify([
                      s.selected,
                      s.folder,
                      s.filter,
                      s.query,
                      s.extension,
                      s.dateFrom,
                      s.dateTo,
                      s.order,
                    ])}
                  >
                    {(item) => (
                      <Tile
                        item={item}
                        device={s.selected}
                        open={() => open(item)}
                      />
                    )}
                  </MediaGrid>
                </Show>
              </Show>
            </Show>
          </Show>
        </section>
      </main>
      <dialog
        ref={dialog}
        classList={{ "viewer-dialog": Boolean(s.preview) }}
        aria-label={help() ? t("usb") : s.preview?.name || t("preview")}
        onClose={() => {
          if (dialog.open) return;
          setHelp(false);
          vm.patch({ preview: null });
        }}
      >
        <button
          class="dismiss"
          onClick={close}
          autofocus
          aria-label={t("close")}
        >
          <X size={20} />
        </button>
        <Show
          when={help()}
          fallback={
            <Show when={s.preview}>
              {(item) => (
                <>
                  <h2 title={item().name}>{item().name}</h2>
                  <p class="viewer-folder">
                    {item().folder === "." ? t("root") : item().folder}
                  </p>
                  <div class="viewer-nav">
                    <button
                      aria-label={t("previous")}
                      title={t("previous")}
                      disabled={previewIndex() <= 0}
                      onClick={() => move(-1)}
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <span>
                      {previewIndex() + 1} / {vm.selection.length}
                    </span>
                    <button
                      aria-label={t("next")}
                      title={t("next")}
                      disabled={previewIndex() + 1 >= vm.selection.length}
                      onClick={() => move(1)}
                    >
                      <ChevronRight size={20} />
                    </button>
                  </div>
                  <Show when={item()} keyed>
                    {(media) => (
                      <MediaViewer item={media} device={s.selected} photos={viewerPhotos} />
                    )}
                  </Show>
                </>
              )}
            </Show>
          }
        >
          <h2>{t("usb")}</h2>
          <h4>Android</h4>
          <p>{t("androidHelp")}</p>
          <h4>{t("apple")}</h4>
          <p>{t("appleHelp")}</p>
          <h4>{t("externalDrives")}</h4>
          <p>{t("driveHelp")}</p>
          <p>{t("cableHelp")}</p>
        </Show>
      </dialog>
      <dialog
        ref={settings}
        aria-labelledby="settings-title"
        class="settings-dialog"
      >
        <button
          class="dismiss"
          onClick={() => settings.close()}
          aria-label={t("close")}
        >
          <X size={20} />
        </button>
        <h2 id="settings-title">{t("settings")}</h2>
        <Select label={t("language")} options={["en", "ru"] as const}
          value={locale.language} disabled={locale.saving}
          text={(language) => language === "ru" ? "Русский" : "English"}
          onChange={(language) => void locale.choose(language)} />
        <Show when={locale.failed}>
          <p role="alert">{t("saveError")}</p>
        </Show>
      </dialog>
    </div>
  );
}
