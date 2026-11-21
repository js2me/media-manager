import {
  batch,
  on,
  For,
  createEffect,
  createSignal,
  onMount,
  onCleanup,
  type JSX,
} from "solid-js";
import type { Media } from "../../entities/media";

const cardHeight = 182;
const gap = 16;
const rowHeight = cardHeight + gap;
const bufferRows = 2;

export function MediaGrid(props: {
  items: readonly Media[];
  count: number;
  children: (item: Media) => JSX.Element;
  selectionKey: string;
}) {
  let grid!: HTMLDivElement;
  const [columns, setColumns] = createSignal(1);
  const [firstRow, setFirstRow] = createSignal(0);
  const [rowCount, setRowCount] = createSignal(1);
  let reset: (() => void) | undefined;

  onMount(() => {
    const pane = grid.closest("main")!;
    const narrow = window.matchMedia("(max-width: 600px)");
    let scroller: Element = pane;
    let origin = 0,
      height = 0,
      lastOffset = 0;
    let anchor = 0;
    let scrollFrame = 0,
      layoutFrame = 0;
    let initialized = false;

    function updateRows(offset: number, force: boolean) {
      const top = Math.max(0, Math.floor(offset / rowHeight));
      const bottom = Math.max(
        top + 1,
        Math.ceil((offset + height) / rowHeight),
      );
      // Keep several rows ready on both sides. Native scrolling between them
      // needs neither a DOM update nor a synchronous layout measurement.
      if (
        force ||
        top < firstRow() + 1 ||
        bottom > firstRow() + rowCount() - 1
      ) {
        const first = Math.max(0, top - bufferRows);
        setFirstRow(first);
        setRowCount(Math.ceil(height / rowHeight) + 1 + 2 * bufferRows);
      }
    }

    function onScroll() {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        const offset = scroller.scrollTop - origin;
        if (offset === lastOffset) return;
        lastOffset = offset;
        anchor = Math.max(0, Math.floor(offset / rowHeight)) * columns();
        batch(() => updateRows(offset, false));
      });
    }

    function layout() {
      layoutFrame = 0;
      const oldScroller = scroller;
      scroller = narrow.matches ? document.scrollingElement! : pane;
      const rect = grid.getBoundingClientRect();
      const paneTop = narrow.matches
        ? 0
        : pane.getBoundingClientRect().top + pane.clientTop;
      origin = rect.top - paneTop + scroller.scrollTop;
      height = narrow.matches ? window.innerHeight : pane.clientHeight;
      const cols = Math.max(1, Math.floor((rect.width + gap) / (165 + gap)));
      const reflow =
        initialized && (cols !== columns() || oldScroller !== scroller);
      const preserve = reflow && lastOffset >= 0;
      const offset = preserve
        ? Math.floor(Math.min(anchor, Math.max(0, props.count - 1)) / cols) *
            rowHeight +
          (lastOffset % rowHeight)
        : scroller.scrollTop - origin;
      batch(() => {
        setColumns(cols);
        updateRows(offset, true);
      });
      if (preserve) scroller.scrollTop = origin + offset;
      lastOffset = scroller.scrollTop - origin;
      if (!preserve)
        anchor = Math.max(0, Math.floor(lastOffset / rowHeight)) * cols;
      initialized = true;
    }
    function scheduleLayout() {
      if (!layoutFrame) layoutFrame = requestAnimationFrame(layout);
    }
    reset = () => {
      scroller.scrollTop = 0;
      anchor = 0;
      lastOffset = -origin;
      batch(() => updateRows(lastOffset, true));
    };
    layout();
    const observer = new ResizeObserver(scheduleLayout);
    observer.observe(pane);
    // Header wrapping, scan notices and the toolbar can move the grid.
    observer.observe(grid.parentElement!);
    window.addEventListener("resize", scheduleLayout);
    pane.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleLayout);
      pane.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(scrollFrame);
      cancelAnimationFrame(layoutFrame);
    });
  });

  createEffect(
    on(
      () => props.selectionKey,
      () => reset?.(),
      { defer: true },
    ),
  );

  const start = () =>
    Math.min(firstRow(), Math.max(0, Math.ceil(props.count / columns()) - 1));
  const rows = () => {
    const first = start();
    const end = Math.min(
      first + rowCount(),
      Math.ceil(props.count / columns()),
    );
    return Array.from({ length: end - first }, (_, i) => first + i);
  };
  return (
    <div
      ref={grid}
      class="grid"
      style={{
        height:
          Math.max(0, Math.ceil(props.count / columns()) * rowHeight - gap) +
          "px",
      }}
    >
      <For each={rows()}>
        {(row) => (
          <div
            class="grid-row"
            style={{
              top: row * rowHeight + "px",
              height: cardHeight + "px",
              "grid-template-columns": `repeat(${columns()},minmax(0,1fr))`,
            }}
          >
            <For
              each={props.items.slice(
                row * columns(),
                Math.min(props.count, (row + 1) * columns()),
              )}
            >
              {props.children}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
