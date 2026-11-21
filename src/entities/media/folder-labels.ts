export function folderName(path: string, rootLabel: string) {
  return path === "." ? rootLabel : path.slice(path.lastIndexOf("/") + 1);
}

// A repeated leaf name needs only enough parent segments to distinguish it.
export function folderContexts(paths: readonly string[], rootLabel: string) {
  const counts = new Map<string, number>();
  const parts = paths.map((path) => path.split("/"));
  for (const segments of parts) {
    for (let i = segments.length - 1; i >= 0; i--) {
      const suffix = segments.slice(i).join("/");
      counts.set(suffix, (counts.get(suffix) ?? 0) + 1);
    }
  }
  const contexts = new Map<string, string>();
  parts.forEach((segments, index) => {
    const leaf = segments.length - 1;
    if (counts.get(segments[leaf]) === 1) return;
    let start = leaf;
    while (start > 0 && counts.get(segments.slice(start).join("/"))! > 1)
      start--;
    const parent = segments.slice(start, leaf);
    if (counts.get(segments.slice(start).join("/"))! > 1)
      parent.unshift(rootLabel);
    contexts.set(paths[index], parent.join(" › "));
  });
  return contexts;
}
