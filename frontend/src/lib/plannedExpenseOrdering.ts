export type SortableEntry = {
  id: number;
  sort_order?: number;
};

export type DropPosition = "before" | "after";
export type MoveDirection = "up" | "down";

export function moveById<T extends SortableEntry>(
  entries: T[],
  draggedId: number,
  targetId: number,
  position: DropPosition,
): T[] {
  if (draggedId === targetId) return entries;

  const draggedIndex = entries.findIndex((entry) => entry.id === draggedId);
  const targetIndex = entries.findIndex((entry) => entry.id === targetId);
  if (draggedIndex < 0 || targetIndex < 0) return entries;

  const next = [...entries];
  const [dragged] = next.splice(draggedIndex, 1);
  const targetIndexAfterRemoval = next.findIndex((entry) => entry.id === targetId);
  const insertIndex =
    position === "after" ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval;
  next.splice(insertIndex, 0, dragged);
  return next;
}

export function moveByStep<T extends SortableEntry>(
  entries: T[],
  id: number,
  direction: MoveDirection,
): T[] {
  const currentIndex = entries.findIndex((entry) => entry.id === id);
  if (currentIndex < 0) return entries;

  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= entries.length) return entries;

  const next = [...entries];
  [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
  return next;
}

export function withSequentialSortOrder<T extends SortableEntry>(
  entries: T[],
): Array<T & { sort_order: number }> {
  return entries.map((entry, index) => ({ ...entry, sort_order: index }));
}

export function sortByManualOrder<T extends SortableEntry & { name?: string }>(
  entries: T[],
): T[] {
  return [...entries].sort(
    (a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      (a.name ?? "").localeCompare(b.name ?? "") ||
      a.id - b.id,
  );
}
