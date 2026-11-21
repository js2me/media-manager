import { Show } from "solid-js";
import { Search, ListFilter, ArrowDownUp, RotateCcw } from "lucide-solid";
import { DatePicker } from "../../shared/ui/date-picker";
import { t } from "../../shared/i18n";
import { type LibraryModel, sortOrders } from "./model";
import { Select } from "../../shared/ui/select";

export function LibraryToolbar(props: { model: LibraryModel }) {
  const vm = props.model,
    s = vm.state;
  return (
    <section class="library-tools" aria-label={t("libraryTools")}>
      <label class="file-search">
        <Search size={17} />
        <input
          type="search"
          aria-label={t("searchFiles")}
          placeholder={t("searchFiles")}
          value={s.query}
          onInput={(e) => vm.patch({ query: e.currentTarget.value })}
        />
      </label>
      <div class="tool-fields">
        <Select label={t("fileType")} icon={<ListFilter size={15} />}
          options={["all", "photo", "video"] as const} value={s.filter}
          text={t} onChange={(filter) => vm.patch({ filter })} />
        <Select label={t("format")} options={["", ...s.formats]} value={s.extension}
          text={(ext) => ext ? ext.toUpperCase() : t("anyFormat")}
          onChange={(extension) => vm.patch({ extension })} />
        <Select label={t("sortBy")} icon={<ArrowDownUp size={15} />}
          options={sortOrders} value={s.order} text={t}
          onChange={(order) => vm.patch({ order })} />
        <fieldset class="period-fields">
          <legend>{t("modifiedPeriod")}</legend>
          <DatePicker label={t("dateFrom")} value={s.dateFrom} max={s.dateTo}
            onChange={(dateFrom) => vm.patch({ dateFrom })} />
          <DatePicker label={t("dateTo")} value={s.dateTo} min={s.dateFrom}
            onChange={(dateTo) => vm.patch({ dateTo })} />
        </fieldset>
        <Show when={s.dateFrom && s.dateTo && s.dateFrom > s.dateTo}>
          <span role="alert">{t("invalidPeriod")}</span>
        </Show>
        <Show
          when={
            s.dateFrom || s.dateTo ||
            s.query ||
            s.extension ||
            s.filter !== "all" ||
            s.order !== "deviceOrder"
          }
        >
          <button
            class="tool-reset"
            title={t("resetTools")}
            aria-label={t("resetTools")}
            onClick={() =>
              vm.patch({
                query: "",
                dateFrom: "",
                dateTo: "",
                extension: "",
                filter: "all",
                order: "deviceOrder",
              })
            }
          >
            <RotateCcw size={16} />
          </button>
        </Show>
      </div>
    </section>
  );
}
