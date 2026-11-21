import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { FolderOpen, HardDriveDownload, X } from "lucide-solid";
import { request } from "../../shared/api/request";
import { locale, t } from "../../shared/i18n";
import type { Message } from "../../shared/i18n/messages";
import type { LibraryModel } from "./model";

type Destination = { path: string; disk: string };
type Grouping = "original" | "month" | "type";
type Profile = { grouping: Grouping; folders: string[] | null; move: boolean };
type Job = {
  status: "idle" | "running" | "failed" | "done" | "stopped";
  device: string; destination: string; file: string;
  copied: number; matched: number; removed: number; total: number;
  error?: Message; detail?: string;
};

export function TransferDialog(props: { model: LibraryModel }) {
  let dialog!: HTMLDialogElement;
  let timer: number | undefined;
  const [choices, setChoices] = createSignal<Destination[]>([]);
  const [path, setPath] = createSignal("");
  const [grouping, setGrouping] = createSignal<Grouping>("original");
  const [folders, setFolders] = createSignal<string[] | null>(null);
  const [search, setSearch] = createSignal("");
  const [profileReady, setProfileReady] = createSignal(false);
  const [restored, setRestored] = createSignal(false);
  let lookup = 0;
  let profileTimer: number | undefined;
  const [move, setMove] = createSignal(false);
  const [job, setJob] = createSignal<Job>();
  const [error, setError] = createSignal<Message>();
  const [pending, setPending] = createSignal(false);
  const busy = () => job()?.status === "running";
  const state = props.model.state;
  const device = () => state.devices.find(d => d.id === state.selected);
  function clearTimer() { window.clearTimeout(timer); }
  onCleanup(clearTimer);
  const count = () => folders()?.reduce((n, f) => n + props.model.folderCount(f), 0) ?? state.total;
  const example = createMemo(() => {
    const item = props.model.sampleFile(folders());
    if (!item || !path()) return;
    const source = item.folder === "." ? item.name : item.folder + "/" + item.name;
    const archiveFolder = item.archiveFolder ?? item.folder;
    const archivePath = archiveFolder === "." ? item.name : archiveFolder + "/" + item.name;
    let prefix = "";
    if (grouping() === "type") prefix = item.kind === "video" ? "Videos/" : "Photos/";
    if (grouping() === "month") {
      const date = item.modified == null ? null : new Date(item.modified * 1000);
      prefix = date ? date.getFullYear() + "/" + date.toLocaleString(locale.language, { month: "long" }) + "/" : "Unknown-date/";
    }
    return { source, archivePath, destination: path().replace(/\/+$/, "") + "/", prefix };
  });
  function destinationChanged(value: string, delay = 0) {
    const version = ++lookup;
    window.clearTimeout(profileTimer);
    setPath(value);
    setProfileReady(false);
    setRestored(false);
    setError(undefined);
    setSearch("");
    setFolders(null);
    setGrouping("original");
    setMove(false);
    if (!value) return;
    profileTimer = window.setTimeout(async () => {
      try {
        const response = await fetch("api/transfer-profile", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: value }),
        });
        if (!response.ok) throw new Error();
        const profile: Profile | null = await response.json();
        if (version !== lookup) return;
        if (profile) {
          setGrouping(profile.grouping);
          setFolders(profile.folders);
          setMove(profile.move);
          setRestored(true);
        }
        setProfileReady(true);
      } catch { if (version === lookup) setError("profileError"); }
    }, delay);
  }
  onCleanup(() => { lookup++; window.clearTimeout(profileTimer); });
  async function poll() {
    clearTimer();
    try {
      const prev = job();
      const current = await request<Job>("transfer");
      setJob(current);
      if (prev?.status === "running" && current.status !== "running" && current.removed)
        void props.model.discover(true);
    } catch { setError("transferError"); }
    if (dialog.open && busy()) timer = window.setTimeout(poll, 600);
  }
  async function open() {
    dialog.showModal();
    setPending(true);
    setError(undefined);
    setMove(false);
    try {
      await poll();
      setChoices(await request<Destination[]>("destinations"));
      destinationChanged(path() || choices()[1]?.path || choices()[0]?.path || "");
    } catch { setError("destinationError"); }
    finally { setPending(false); }
  }
  async function browse() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch("api/choose-folder", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: path(), language: locale.language }),
      });
      if (!response.ok) throw new Error();
      const selected: Destination | null = await response.json();
      if (selected) {
        setChoices(current => [...current.filter(d => d.path !== selected.path), selected]);
        destinationChanged(selected.path);
      }
    } catch { setError("destinationError"); }
    finally { setPending(false); }
  }
  async function start() {
    if (move() && !window.confirm(t("confirmMove"))) return;
    setPending(true);
    setError(undefined);
    try {
      const target = path();
      const mount = choices().filter(d => target === d.path || target.startsWith(d.path + "/"))
        .sort((a, b) => b.path.length - a.path.length)[0];
      const response = await fetch("api/transfer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device: state.selected, path: target, disk: mount?.disk, move: move(), folders: folders(), grouping: grouping(), language: locale.language }),
      });
      if (!response.ok) throw new Error();
      const result: Job & { rejected?: Message } = await response.json();
      if (result.rejected) setError(result.rejected);
      else { setJob(result); await poll(); }
    } catch { setError("transferError"); }
    finally { setPending(false); }
  }
  async function stop() {
    try { await request("transfer/stop", "POST"); }
    catch { setError("transferError"); }
  }
  return <>
    <button class="refresh transfer-open" onClick={open}><HardDriveDownload size={16}/>{t("transfer")}</button>
    <dialog ref={dialog} class="transfer-dialog" aria-labelledby="transfer-title" onClose={clearTimer}>
      <button class="dismiss" aria-label={t("close")} onClick={() => dialog.close()}><X size={19}/></button>
      <h2 id="transfer-title">{t("transfer")}</h2>
      <Show when={!busy()}>
        <p>{device()?.name} · {count()} / {state.total} {t("files")}</p>
        <p>{t("transferHint")}</p>
        <Show when={state.skipped}><p class="warning">{t("skipped")} · {state.skipped}</p></Show>
        <label for="transfer-path">{t("destination")}</label>
        <div class="folder-picker">
          <input id="transfer-path" list="transfer-targets" value={path()} onInput={e => destinationChanged(e.currentTarget.value, 300)} />
          <button class="refresh" disabled={pending()} onClick={browse}><FolderOpen size={16}/>{t("chooseFolder")}</button>
        </div>
        <datalist id="transfer-targets"><For each={choices()}>{d => <option value={d.path}/>}</For></datalist>
        <Show when={restored()}><small>{t("restoredProfile")}</small></Show>
        <div class="transfer-columns">
        <fieldset class="transfer-scope" disabled={!profileReady() || pending()}>
          <legend>{t("sourceFolders")}</legend>
          <label><input type="checkbox" checked={folders() === null} onChange={e => setFolders(e.currentTarget.checked ? null : [])} /> {t("allFolders")}</label>
          <Show when={folders() !== null}>
            <input type="search" aria-label={t("findFolder")} placeholder={t("findFolder")} value={search()} onInput={e => setSearch(e.currentTarget.value)} />
            <div class="transfer-folder-list">
              <For each={Array.from(new Set([...state.folders, ...(folders() ?? [])])).filter(f => f.toLowerCase().includes(search().toLowerCase()))}>{f =>
                <label><input type="checkbox" checked={folders()?.includes(f)} onChange={e => setFolders(e.currentTarget.checked ? [...(folders() ?? []), f] : folders()?.filter(x => x !== f) ?? [])} />
                  <span>{f === "." ? t("root") : f}</span><small>{props.model.folderCount(f)}</small></label>
              }</For>
            </div>
          </Show>
        </fieldset>
        <fieldset class="transfer-scope transfer-layout" disabled={!profileReady() || pending()}>
          <legend><label for="transfer-grouping">{t("groupBy")}</label></legend>
          <select id="transfer-grouping" value={grouping()} onChange={e => setGrouping(e.currentTarget.value as Grouping)}>
            <option value="original">{t("originalFolders")}</option>
            <option value="month">{t("monthFolders")}</option>
            <option value="type">{t("typeFolders")}</option>
          </select>
          <Show when={example()} fallback={<p>{t("selectFolders")}</p>}>{file =>
            <dl class="transfer-example">
              <dt>{t("sampleSource")}</dt>
              <dd>{file().source}</dd>
              <dt>{t("sampleDestination")}</dt>
              <dd>{file().destination}<strong>{file().prefix}</strong>{file().archivePath}</dd>
            </dl>
          }</Show>
        </fieldset>
        </div>
        <label class="transfer-option"><input type="checkbox" disabled={!profileReady() || pending()} checked={move()} onChange={e => setMove(e.currentTarget.checked)} />{t("removeOriginals")}</label>
        <button class="primary" disabled={pending() || state.busy || !count() || !profileReady()} onClick={start}>{t(move() ? "moveFiles" : "copyFiles")}</button>
        <Show when={state.busy}><p>{t("scanRequired")}</p></Show>
      </Show>
      <Show when={job()?.total ? job() : undefined}>{j => <section class="transfer-status" role="status">
        <strong>{t(j().status === "done" ? "transferDone" : j().status === "stopped" ? "transferStopped" : j().status === "failed" ? (j().error || "transferError") : "transferBusy")}</strong>
        <p>{j().device} → {j().destination}</p>
        <progress value={j().copied + j().matched} max={j().total}/>
        <p>{j().copied + j().matched} / {j().total} · {t("copied")} {j().copied} · {t("matched")} {j().matched} · {t("removed")} {j().removed}</p>
        <small>{j().file}</small>
        <Show when={j().detail}><p>{j().detail}</p></Show>
        <Show when={busy()}><button class="refresh" onClick={stop}>{t("stopTransfer")}</button></Show>
      </section>}</Show>
      <Show when={error()}>{e => <p role="alert">{t(e())}</p>}</Show>
    </dialog>
  </>;
}
