export interface Device {
  id: string;
  name: string;
  mounted: boolean;
  external: boolean;
}
export interface Media {
  id: string;
  name: string;
  folder: string;
  modified?: number | null;
  size?: number | null;
  kind: "photo" | "video";
}
export interface LibraryResult {
  items: Media[];
  skipped: number;
  done: boolean;
  more: boolean;
  failed: boolean;
  folder: string;
}

export const mediaUrl = (device: string, item: Media, thumbnail = false) =>
  `api/${thumbnail ? "thumb" : "media"}/${device}/${item.id}`;
