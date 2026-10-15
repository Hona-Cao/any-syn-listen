/**
 * Resolve the targets of a playlist context-menu invocation.
 *
 * A right click on an ALREADY selected playlist preserves the whole visible
 * selection. Right-clicking outside it starts a new single-item context.
 * Built-in lists, file lists and hidden lists are never accidentally batched.
 */
export interface SelectableList {
  id: string
  type: string
}

export const resolvePlaylistContext = <T extends SelectableList>(
  clicked: T | null,
  selectedIds: readonly string[],
  visibleLists: readonly T[]
): T[] => {
  if (!clicked || clicked.type !== 'general') return []
  const selectedSet = new Set(selectedIds)
  const visibleSelected = visibleLists.filter(
    (item) => item.type === 'general' && selectedSet.has(item.id)
  )
  return visibleSelected.some((item) => item.id === clicked.id)
    ? visibleSelected
    : [clicked]
}

export type PlaylistBulkAction = 'archive' | 'restore' | 'remove'

/** Keyboard deletion is only actionable for a nonempty, idle playlist selection. */
export const isPlaylistDeleteShortcut = (key: string, selectedCount: number, busy: boolean): boolean =>
  key === 'Delete' && selectedCount > 0 && !busy
