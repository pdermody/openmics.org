import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { CaptionEditor } from '../components/media/CaptionEditor'
import { mediaItem } from './media-fixtures'

describe('CaptionEditor (design §7.4)', () => {
  it('previews the substituted caption with this media’s actual attribution values', async () => {
    const user = userEvent.setup()
    const item = mediaItem({
      attribution: { performer_name: 'Amy Hart', performer_city: 'Dublin', profile_id: null, profile_handle: null },
    })
    function Harness() {
      const [value, setValue] = useState('')
      return <CaptionEditor item={item} value={value} onChange={setValue} />
    }
    render(<Harness />)

    // Empty caption → preview shows the default (long form with event context).
    // (Date format is locale-dependent; jsdom runs en-US, so assert around the date.)
    expect(screen.getByText(/Preview:/)).toHaveTextContent(/Amy Hart from Dublin at Friday Stage on .+2026/)

    // user.type() interprets {…} as key syntax; paste the token text literally instead.
    await user.click(screen.getByRole('textbox'))
    await user.paste('{performer_name} live!')
    expect(screen.getByText(/Preview:/)).toHaveTextContent('Amy Hart live!')
  })

  it('lists attribution + event tokens for attributed event media', () => {
    const attributed = mediaItem({ attribution: { performer_name: 'Amy', performer_city: null, profile_id: null, profile_handle: null } })
    render(<CaptionEditor item={attributed} value="" onChange={() => undefined} />)
    expect(screen.getByText('{performer_name}')).toBeInTheDocument()
    expect(screen.getByText('{event_name}')).toBeInTheDocument()
  })

  it('lists no tokens for free-standing series media', () => {
    const freeStanding = mediaItem({ attribution: null, event_id: null, open_mic_id: 'series-1' })
    render(<CaptionEditor item={freeStanding} value="" onChange={() => undefined} />)
    expect(screen.queryByText('{performer_name}', { selector: 'code' })).toBeNull()
    expect(screen.queryByText('{event_name}', { selector: 'code' })).toBeNull()
  })

  it('enforces the 500-char cap with a warning near the limit', async () => {
    const item = mediaItem()
    function Harness() {
      const [value, setValue] = useState('x'.repeat(460))
      return <CaptionEditor item={item} value={value} onChange={setValue} />
    }
    render(<Harness />)
    const counter = screen.getByText(/40 characters left/)
    expect(counter.className).toContain('caption-editor-count-warning')
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveAttribute('maxLength', '500')
  })
})
