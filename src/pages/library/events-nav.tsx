import { createMemo, For, Show } from "solid-js";
import { CalendarDays, ChevronRight } from "lucide-solid";
import { locale, t } from "../../shared/i18n";
import type { LibraryModel } from "./model";

export function eventLabel(key: string, short = false) {
  if (key === "unknown") return t("undated");
  if (!key.includes("-")) return key;
  const [year, month] = key.split("-").map(Number);
  const label = new Intl.DateTimeFormat(locale.language, {
    month: "long", year: short ? undefined : "numeric",
  }).format(new Date(year, month - 1, 1));
  return label[0].toLocaleUpperCase(locale.language) + label.slice(1);
}

export function EventsNav(props: { model: LibraryModel }) {
  const vm = props.model;
  const groups = createMemo(() => {
    const years = new Map<string, string[]>();
    for (const month of vm.state.months) {
      if (month === "unknown") continue;
      const year = month.split("-")[0];
      if (!years.has(year)) years.set(year, []);
      years.get(year)!.push(month);
    }
    return years;
  });
  const row = (key: string, short = false) => (
    <button classList={{ active: vm.state.event === key }}
      aria-pressed={vm.state.event === key}
      onClick={() => vm.patch({ event: key, folder: "" })}>
      <CalendarDays size={15} />{/^\d{4}$/.test(key) ? t("wholeYear") : eventLabel(key, short)}<small>{vm.eventCount(key)}</small>
    </button>
  );
  return <details open>
    <summary>{t("events")}</summary>
    <nav class="event-tree" aria-label={t("events")}>
      <For each={[...groups().keys()]}>{year => <details>
        <summary aria-label={year}><ChevronRight size={14} />{year}<small>{vm.eventCount(year)}</small></summary>
        {row(year)}
        <For each={groups().get(year)}>{month => row(month, true)}</For>
      </details>}</For>
      <Show when={vm.state.months.includes("unknown")}>{row("unknown")}</Show>
    </nav>
  </details>;
}
