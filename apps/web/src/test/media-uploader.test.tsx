import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MediaUploader } from '../components/media/MediaUploader'
import { renderWithProviders } from './render'

const OPEN_MIC_ID = 'd0000000-0000-0000-0000-000000000001'
const YT_BASE = 'https://www.youtube.com/oembed'
const TITLES: Record<string, string> = {
  dQw4w9WgXcQ: 'Never Gonna Give You Up',
  abcdef12345: 'Second Clip Title',
}

// The "+ Add video" caption prefill goes straight from the browser to the provider's
// oEmbed endpoint (no OpenMics API call), so tests stub window.fetch instead of MSW.
function stubOEmbed() {
  return vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const videoId = url.startsWith(YT_BASE) ? /v%3D([A-Za-z0-9_-]{6,20})/.exec(url)?.[1] ?? null : null
    const title = videoId ? TITLES[videoId] ?? null : null
    const ok = title !== null
    return { ok, json: async () => (ok ? { title } : {}) } as Response
  })
}

async function openVideoForm(user: ReturnType<typeof userEvent.setup>) {
  renderWithProviders(<MediaUploader openMicId={OPEN_MIC_ID} />)
  await user.click(screen.getByRole('button', { name: '+ Add video' }))
  return { urlInput: screen.getByLabelText('Video URL'), captionInput: screen.getByLabelText('Caption') }
}

describe('MediaUploader video caption prefill', () => {
  afterEach(() => vi.restoreAllMocks())

  it('fills the caption with the provider title once a valid URL is entered', async () => {
    stubOEmbed()
    const user = userEvent.setup()
    const { urlInput, captionInput } = await openVideoForm(user)

    await user.type(urlInput, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    await waitFor(() => expect(captionInput).toHaveValue('Never Gonna Give You Up'))
  })

  it('does not overwrite a caption the organizer typed', async () => {
    stubOEmbed()
    const user = userEvent.setup()
    const { urlInput, captionInput } = await openVideoForm(user)

    await user.type(urlInput, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    await waitFor(() => expect(captionInput).toHaveValue('Never Gonna Give You Up'))
    await user.clear(captionInput)
    await user.type(captionInput, 'My own caption')

    await user.clear(urlInput)
    await user.type(urlInput, 'https://www.youtube.com/watch?v=abcdef12345')
    // Past the debounce + fetch window; the organizer's words survive.
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(captionInput).toHaveValue('My own caption')
  })

  it('leaves the caption empty when the provider has no title for the video', async () => {
    stubOEmbed()
    const user = userEvent.setup()
    const { urlInput, captionInput } = await openVideoForm(user)

    await user.type(urlInput, 'https://www.youtube.com/watch?v=zzzzzz99999')
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(captionInput).toHaveValue('')
  })
})
