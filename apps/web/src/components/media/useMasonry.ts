import { useCallback, useLayoutEffect, useMemo, useState } from 'react'

// JS-balanced masonry (design §5.1): items are assigned to the currently-shortest column
// in code and absolutely positioned, so visual order, DOM order, and the active sort all
// agree — a pure CSS multi-column layout is ruled out because it fills column-major.
export const MASONRY_MIN_TILE_WIDTH = 240
export const MASONRY_GAP = 12

export type MasonryPosition = { left: number; top: number; width: number; height: number }
export type MasonryLayout = { positions: MasonryPosition[]; height: number }

/**
 * Measure a container's live width and balance items across columns.
 *
 * `itemHeight(index, columnWidth)` returns each tile's IMAGE height (the part that scales
 * with column width). When `measureExtra` is set, each tile's footer/chrome height is
 * measured from the rendered `[data-masonry-index]` element and added on top, so callers
 * with per-tile chrome (the manage grid's caption/action row) get exact positions without
 * hardcoding a footer height.
 */
export function useMasonry(count: number, itemHeight: (index: number, columnWidth: number) => number, minTileWidth = MASONRY_MIN_TILE_WIDTH, gap = MASONRY_GAP, measureExtra = false) {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState(0)
  // Per-tile extra (footer) heights, keyed by index. Populated after first render.
  const [extraHeights, setExtraHeights] = useState<Record<number, number>>({})
  const ref = useCallback(<E extends HTMLElement>(el: E | null) => setNode(el), [])

  useLayoutEffect(() => {
    if (!node) return
    // Synchronous measurement too: the RO initial delivery is async and is dropped when
    // the observed node was replaced before it fired.
    setWidth(node.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])

  const layout = useMemo<MasonryLayout>(() => {
    if (width <= 0 || count === 0) return { positions: [], height: 0 }
    const columnCount = Math.max(1, Math.floor((width + gap) / (minTileWidth + gap)))
    const columnWidth = (width - gap * (columnCount - 1)) / columnCount
    const heights = new Array<number>(columnCount).fill(0)
    const positions = Array.from({ length: count }, (_, index) => {
      const column = heights.indexOf(Math.min(...heights))
      const height = itemHeight(index, columnWidth) + (measureExtra ? extraHeights[index] ?? 0 : 0)
      const position = { left: column * (columnWidth + gap), top: heights[column], width: columnWidth, height }
      heights[column] += height + gap
      return position
    })
    return { positions, height: Math.max(0, ...heights) - gap }
    // itemHeight is a stable useCallback at call sites; recompute when count/width change.
  }, [count, width, minTileWidth, gap, itemHeight, measureExtra, extraHeights])

  // After mount, measure each tile's rendered height and store the non-image extra so the
  // next layout pass positions tiles by their true total (image aspect + real footer).
  useLayoutEffect(() => {
    if (!measureExtra || !node || width <= 0) return
    const columnCount = Math.max(1, Math.floor((width + gap) / (minTileWidth + gap)))
    const columnWidth = (width - gap * (columnCount - 1)) / columnCount
    const next: Record<number, number> = {}
    let changed = false
    node.querySelectorAll<HTMLElement>('[data-masonry-index]').forEach((el) => {
      const index = Number(el.getAttribute('data-masonry-index'))
      const total = el.getBoundingClientRect().height
      const extra = Math.max(0, Math.round(total - itemHeight(index, columnWidth)))
      if (extraHeights[index] !== extra) { next[index] = extra; changed = true } else { next[index] = extraHeights[index] }
    })
    if (changed) setExtraHeights(next)
  })

  return { ref, layout }
}
