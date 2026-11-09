import type { Root, RootContent } from "mdast";

/** Explicit heading IDs stay the same when the visible heading is translated. */
export function remarkGuideAnchors() {
  return (tree: Root) => {
    function visit(node: Root | RootContent) {
      if (node.type === "heading") {
        const last = node.children.at(-1);
        if (last?.type === "text") {
          const match = last.value.match(/\s+\{#([a-z][a-z0-9-]*)\}$/);
          if (match) {
            last.value = last.value.slice(0, match.index);
            node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: match[1] } };
          }
        }
      }
      if ("children" in node) node.children.forEach(visit);
    }
    visit(tree);
  };
}

export function resolveGuideSection(requested: string | null, sectionIds: readonly string[]): string {
  return requested != null && sectionIds.includes(requested) ? requested : sectionIds[0]!;
}

export function guideAnchorFromHash(hash: string): string | null {
  if (!hash.startsWith("#")) return null;
  try {
    return decodeURIComponent(hash.slice(1)) || null;
  } catch {
    return null;
  }
}
