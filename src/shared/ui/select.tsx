import { Select as KSelect } from "@kobalte/core/select";
import { Check, ChevronDown } from "lucide-solid";
import type { JSX } from "solid-js";

interface SelectProps<T extends string> {
  label: string;
  icon?: JSX.Element;
  value: T;
  options: readonly T[];
  text: (option: T) => string;
  onChange: (option: T) => void;
  disabled?: boolean;
}

export function Select<T extends string>(props: SelectProps<T>) {
  let trigger!: HTMLButtonElement;
  return (
    <KSelect<T>
      options={[...props.options]}
      value={props.value}
      optionTextValue={props.text}
      onChange={(value) => { if (value !== null) props.onChange(value); }}
      disabled={props.disabled}
      placement="bottom-start"
      gutter={5}
      fitViewport
      itemComponent={({ item }) => (
        <KSelect.Item item={item} class="select-item">
          <KSelect.ItemLabel>{props.text(item.rawValue)}</KSelect.ItemLabel>
          <KSelect.ItemIndicator><Check size={15} /></KSelect.ItemIndicator>
        </KSelect.Item>
      )}
    >
      <KSelect.Trigger ref={trigger} class="select-trigger" aria-label={props.label}>
        {props.icon}<span>{props.label}</span>
        <strong>{props.text(props.value)}</strong><ChevronDown size={15} />
      </KSelect.Trigger>
      <KSelect.Portal mount={trigger?.closest("dialog") ?? undefined}>
        <KSelect.Content class="select-menu">
          <KSelect.Listbox class="select-list" aria-label={props.label} />
        </KSelect.Content>
      </KSelect.Portal>
    </KSelect>
  );
}
