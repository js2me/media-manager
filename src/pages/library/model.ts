import { computed, observable, runInAction, reaction } from "mobx";
import { ViewModelBase } from "mobx-view-model";
import { pageVisibility } from "mobx-web-api";
import { request } from "../../shared/api/request";
import type { Device, Media, LibraryResult } from "../../entities/media";

export const sortOrders = [
  "deviceOrder",
  "nameAsc",
  "nameDesc",
  "newest",
  "oldest",
  "largest",
  "smallest",
] as const;
export type SortOrder = (typeof sortOrders)[number];
const byName = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const extension = (item: Media) =>
  item.name.slice(item.name.lastIndexOf(".") + 1).toLowerCase();

export class LibraryModel extends ViewModelBase {
  readonly state = observable(
    {
      devices: [] as Device[],
      selected: "",
      query: "",
      dateFrom: "",
      dateTo: "",
      extension: "",
      formats: [] as string[],
      order: "deviceOrder" as SortOrder,
      total: 0,
      folders: [] as string[],
      folder: "",
      filter: "all" as "all" | Media["kind"],
      preview: null as Media | null,
      scanFolder: "",
      busy: false,
      error: "" as "" | "discoverError" | "libraryError" | "connectError",
      skipped: 0,
    },
    {
      devices: observable.ref,
      formats: observable.ref,
      folders: observable.ref,
      preview: observable.ref,
    },
  );

  private generation = 0;
  private timer = 0;
  private disposeVisibility?: () => void;
  private pendingDiscovery = false;

  // Append once per batch. Reading a viewport or changing filters is O(visible cards).
  private buckets = new Map<
    string,
    { all: Media[]; photo: Media[]; video: Media[] }
  >();

  private knownFormats = new Set<string>();

  folderCount(folder: string) {
    return this.state.total ? this.buckets.get(folder)?.all.length ?? 0 : 0;
  }

  private get scopedItems(): readonly Media[] {
    if (!this.state.total) return [];
    return this.buckets.get(this.state.folder)?.[this.state.filter] ?? [];
  }

  private results = computed(() => {
    const { query, extension: format, order, dateFrom, dateTo } = this.state;
    const term = query.trim().toLowerCase();
    const start = dateFrom ? new Date(dateFrom + "T00:00:00").getTime() / 1000 : null;
    const end = dateTo ? new Date(dateTo + "T00:00:00") : null;
    if (end) end.setDate(end.getDate() + 1);
    const until = end ? end.getTime() / 1000 : null;
    const items = this.scopedItems.filter(
      (item) =>
        (start === null || (item.modified != null && item.modified >= start)) &&
        (until === null || (item.modified != null && item.modified < until)) &&
        (!format || extension(item) === format) &&
        (!term ||
          item.name.toLowerCase().includes(term) ||
          item.folder.toLowerCase().includes(term)),
    );
    if (order === "deviceOrder") return items;
    if (order === "nameAsc" || order === "nameDesc")
      return items.sort(
        (a, b) =>
          byName.compare(a.name, b.name) * (order === "nameAsc" ? 1 : -1),
      );
    const key = order === "newest" || order === "oldest" ? "modified" : "size";
    const direction = order === "oldest" || order === "smallest" ? 1 : -1;
    return items.sort((a, b) => {
      const left = a[key],
        right = b[key];
      if (left == null || right == null)
        return Number(left == null) - Number(right == null);
      return (left - right) * direction || byName.compare(a.name, b.name);
    });
  });

  get selection(): readonly Media[] {
    if (
      !this.state.query.trim() &&
      !this.state.extension &&
      !this.state.dateFrom &&
      !this.state.dateTo &&
      this.state.order === "deviceOrder"
    )
      return this.scopedItems;
    return this.results.get();
  }

  private append(items: Media[]) {
    const newFolders: string[] = [];
    for (const item of items) {
      this.knownFormats.add(extension(item));
      for (const key of ["", item.folder]) {
        let bucket = this.buckets.get(key);
        if (!bucket) {
          bucket = { all: [], photo: [], video: [] };
          this.buckets.set(key, bucket);
          if (key) newFolders.push(key);
        }
        bucket.all.push(item);
        bucket[item.kind].push(item);
      }
    }
    runInAction(() => {
      if (this.state.formats.length !== this.knownFormats.size)
        this.state.formats = [...this.knownFormats].sort();
      if (newFolders.length)
        this.state.folders = this.state.folders.concat(newFolders);
      this.state.total += items.length;
    });
  }

  protected didMount() {
    this.disposeVisibility = reaction(
      () => pageVisibility.isVisible,
      (visible) => {
        if (visible) void this.discover();
      },
      { fireImmediately: true },
    );
    this.timer = window.setInterval(() => {
      if (pageVisibility.isVisible) void this.discover();
    }, 2500);
  }

  protected willUnmount() {
    this.generation++;
    window.clearInterval(this.timer);
    this.disposeVisibility?.();
  }

  async discover(force = false) {
    if (this.pendingDiscovery) return;
    this.pendingDiscovery = true;
    try {
      const devices = await request<Device[]>("devices");
      const previous = this.state.devices.find(
        (device) => device.id === this.state.selected,
      );
      const current =
        devices.find((device) => device.id === previous?.id) ?? devices[0];
      runInAction(() => {
        this.state.devices = devices;
      });
      if (
        force ||
        current?.id !== previous?.id ||
        current?.mounted !== previous?.mounted
      )
        void this.select(current?.id ?? "", force);
    } catch {
      this.patch({ error: "discoverError" });
    } finally {
      this.pendingDiscovery = false;
    }
  }

  patch(values: Partial<typeof this.state>) {
    runInAction(() => Object.assign(this.state, values));
  }

  async select(id: string, refresh = false) {
    const generation = ++this.generation;
    this.buckets.clear();
    this.knownFormats.clear();
    this.patch({
      formats: [],
      extension: refresh ? this.state.extension : "",
      selected: id,
      scanFolder: "",
      folder: "",
      preview: null,
      total: 0,
      folders: [],
      busy: false,
      error: "",
      skipped: 0,
    });
    if (!this.state.devices.find((device) => device.id === id)?.mounted) return;
    this.patch({ busy: true });
    try {
      let offset = 0;
      while (generation === this.generation) {
        const result = await request<LibraryResult>(
          `library/${id}?offset=${offset}&refresh=${Number(refresh)}`,
        );
        if (generation !== this.generation) return;
        refresh = false;
        this.patch({
          skipped: result.skipped,
          scanFolder: result.folder,
          error: result.failed ? "libraryError" : "",
        });
        if (result.items.length) {
          this.append(result.items);
          offset += result.items.length;
        }
        if (result.done) break;
        await new Promise((resolve) =>
          setTimeout(resolve, result.more ? 30 : offset ? 600 : 120),
        );
      }
    } catch {
      if (generation === this.generation)
        this.patch({
          error: "libraryError",
        });
    } finally {
      if (generation === this.generation) this.patch({ busy: false });
    }
  }

  async connect() {
    const id = this.state.selected;
    this.patch({ busy: true, error: "" });
    try {
      await request(`connect/${id}`, "POST");
      await this.discover(true);
    } catch {
      if (this.state.selected === id)
        this.patch({
          busy: false,
          error: "connectError",
        });
    }
  }
}
