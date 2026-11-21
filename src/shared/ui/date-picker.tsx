import { onMount, onCleanup, Show } from "solid-js";
import { reaction } from "mobx";
import { CalendarDays, X } from "lucide-solid";
import flatpickr from "flatpickr";
import { Russian } from "flatpickr/dist/l10n/ru";
import "flatpickr/dist/themes/dark.css";
import { locale, t } from "../i18n";

interface DatePickerProps {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (isoDate: string) => void;
}

export function DatePicker(props: DatePickerProps) {
  let input!: HTMLInputElement;
  onMount(() => {
    // Recreate on language changes to refresh month names and keyboard labels.
    let dispose = () => {};
    const stop = reaction(() => locale.language, (language) => {
      dispose();
      const picker = flatpickr(input, {
        disableMobile: true,
        positionElement: input.closest("label") ?? input,
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: language === "ru" ? "d.m.Y" : "M j, Y",
        locale: language === "ru" ? Russian : "default",
        defaultDate: props.value || undefined,
        minDate: props.min || undefined,
        maxDate: props.max || undefined,
        onChange: (_, isoDate) => props.onChange(isoDate),
      });
      picker.altInput!.setAttribute("aria-label", props.label);
      picker.calendarContainer.classList.add("library-calendar");
      const sync = reaction(() => [props.value, props.min, props.max] as const,
        ([value, min, max], [, oldMin, oldMax]) => {
          if (min !== oldMin) picker.set("minDate", min || undefined);
          if (max !== oldMax) picker.set("maxDate", max || undefined);
          if (input.value !== value) picker.setDate(value, false);
        });
      dispose = () => { sync(); picker.destroy(); };
    }, { fireImmediately: true });
    onCleanup(() => { stop(); dispose(); });
  });
  return <div class="date-control">
    <label><CalendarDays size={15} /><span>{props.label}</span>
      <input ref={input} type="text" placeholder="—" />
    </label>
    <Show when={props.value}>
      <button type="button" aria-label={t("clearDate") + " · " + props.label}
        onClick={() => props.onChange("")}><X size={14} /></button>
    </Show>
  </div>;
}
