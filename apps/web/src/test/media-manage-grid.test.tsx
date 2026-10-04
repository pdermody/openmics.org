import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MediaManageGrid } from '../components/media/MediaManageGrid'
import type { MediaManageGridProps } from '../components/media/MediaManageGrid'
import { mediaItem } from './media-fixtures'
import { renderWithProviders } from './render'

function renderGrid(itemOverrides: Parameters<typeof mediaItem>[0] = {}, handlers: Partial<Pick<MediaManageGridProps, 'onOpen' | 'onEditCaption'>> = {}) {
  const item = mediaItem({ alt_text: 'Stage shot', ...itemOverrides })
  const props = {
    items: [item],
    onOpen: handlers.onOpen ?? vi.fn(),
    onEditCaption: handlers.onEditCaption ?? vi.fn(),
    onChangeAttribution: vi.fn(),
    onSoftDelete: vi.fn(),
    bulkDelete: vi.fn(),
  }
  renderWithProviders(<MediaManageGrid {...props} />)
  return { item, ...props }
}

describe('MediaManageGrid', () => {
  it('opens the lightbox on tile click — not the caption editor (design §5.3/§6.4)', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const onEditCaption = vi.fn()
    const { item } = renderGrid({}, { onOpen, onEditCaption })

    await user.click(screen.getByRole('button', { name: 'Stage shot' }))
    expect(onOpen).toHaveBeenCalledWith(item)
    expect(onEditCaption).not.toHaveBeenCalled()
  })

  it('opens the caption editor only from the toolbar button', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const onEditCaption = vi.fn()
    const { item } = renderGrid({}, { onOpen, onEditCaption })

    await user.click(screen.getByRole('button', { name: 'Edit caption' }))
    expect(onEditCaption).toHaveBeenCalledWith(item)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('renders the caption below the image, outside the aspect-locked tile button', () => {
    renderGrid({
      id: 'm-caption',
      attribution: { performer_name: 'Amy Hart', performer_city: 'Dublin', profile_id: null, profile_handle: null },
    })

    // Default short-form caption from attribution (design §7.2).
    const caption = screen.getByText('Amy Hart from Dublin')
    expect(caption).toHaveClass('media-tile-caption')
    expect(caption).toHaveClass('static')
    // Inside the button it overflowed the fixed 3:2 box onto the action row.
    expect(caption.closest('button')).toBeNull()
  })

  it('lays tiles out as uniform letterboxed tiles (fit, no crop)', () => {
    renderGrid({ width: 1200, height: 800 })

    const button = screen.getByRole('button', { name: 'Stage shot' })
    const tile = button.closest('li') as HTMLElement
    // Uniform grid: the tile is a normal grid item (not absolutely positioned), and the
    // image area is a fixed 3/2 box the thumbnail fits inside (letterboxed, not cropped).
    expect(tile.style.position).toBe('')
    expect(button).toHaveClass('media-manage-tile-main')
  })

  it('keeps gallery-tile attribution editable independently of the upload queue', async () => {
    const user = userEvent.setup()
    const item = mediaItem()
    const onChangeAttribution = vi.fn()
    renderWithProviders(<MediaManageGrid items={[item]} attributionOptions={[{ id: 'registration-1', performer_name: 'Ava' }]} onOpen={vi.fn()} onEditCaption={vi.fn()} onChangeAttribution={onChangeAttribution} onSoftDelete={vi.fn()} bulkDelete={vi.fn()} />)
    const select = screen.getByRole('combobox', { name: 'Performer' })
    await user.selectOptions(select, 'registration-1')
    expect(onChangeAttribution).toHaveBeenLastCalledWith(item, 'registration-1')
    await user.selectOptions(select, '')
    expect(onChangeAttribution).toHaveBeenLastCalledWith(item, null)
  })
})
