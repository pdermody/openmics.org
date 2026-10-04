import { useState } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaUploader } from '../components/media/MediaUploader'
import { RegistrationMediaUploadModal } from '../components/media/RegistrationMediaUploadModal'
import { mediaKeys, putToPresignedUrl, type MediaCommitInput } from '../features/media'
import type { RosterRegistration } from '../features/organizer'
import { mediaItem } from './media-fixtures'
import { renderWithProviders } from './render'
import { server } from './server'

vi.mock('../features/media', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/media')>()
  return { ...actual, putToPresignedUrl: vi.fn() }
})

const registrations = [
  { id: 'registration-1', performer_name: 'Ava' },
  { id: 'registration-2', performer_name: 'Ben' },
]
const registration: RosterRegistration = {
  ...registrations[0], event_id: 'event-1', profile_id: null, performer_city: null,
  contact_email: null, contact_phone: null, song_names: [], submission_channel: 'organizer_kiosk',
  organizer_supervised: true, media_consent: true, email_verified_at: null,
  verification_method: null, visibility_state: 'valid', claimed_by_account_id: null,
  claimed_at: null, adopted_profile_id: null, created_at: '', updated_at: '', performances: [],
}
const OriginalURL = URL

beforeEach(() => {
  vi.stubGlobal('URL', class extends OriginalURL {
    static createObjectURL = vi.fn(() => 'blob:photo-preview')
    static revokeObjectURL = vi.fn()
  })
  vi.mocked(putToPresignedUrl).mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())

function uploadHandlers() {
  const commits: MediaCommitInput[] = []
  const patches: { id: string; registration_id: string | null }[] = []
  const item = mediaItem({ id: 'saved-photo' })
  let failPatch = false
  server.use(
    http.post('/api/media/upload-url', () => HttpResponse.json({ upload_url: 'https://storage.test/photo', object_key: 'tmp/photo.jpg' })),
    http.post('/api/media', async ({ request }) => {
      const input = await request.json() as MediaCommitInput
      commits.push(input)
      item.registration_id = input.registration_id ?? null
      return HttpResponse.json({ ...item })
    }),
    http.patch('/api/media/:id', async ({ request, params }) => {
      const input = await request.json() as { registration_id: string | null }
      patches.push({ id: String(params.id), ...input })
      if (failPatch) return HttpResponse.json({ error: { code: 'MEDIA_CONSENT_REVOKED', message: 'Media consent has been revoked.' } }, { status: 409 })
      item.registration_id = input.registration_id
      return HttpResponse.json({ ...item })
    }),
  )
  return { commits, patches, item, failPatch: (value: boolean) => { failPatch = value } }
}

async function choosePhoto(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText('Choose photos'), new File(['photo'], 'stage.jpg', { type: 'image/jpeg' }))
}

describe('Media upload attribution', () => {
  it('persists completed-row attribution and clearing using PATCH, without another upload', async () => {
    const user = userEvent.setup()
    const { commits, patches, item } = uploadHandlers()
    const { queryClient } = renderWithProviders(<MediaUploader eventId="event-1" registrations={registrations} />)
    const key = mediaKeys.list({ kind: 'event', id: 'event-1' }, 'all', 'newest')
    queryClient.setQueryData(key, { pages: [{ items: [], prev_cursor: null, next_cursor: null }], pageParams: [undefined] })
    await choosePhoto(user)
    await screen.findByText('Uploaded')
    const row = screen.getByText('stage.jpg').closest('li')!
    const select = within(row).getByRole('combobox', { name: 'Performer' })
    expect(select).toBeEnabled()
    await user.selectOptions(select, 'registration-2')
    await waitFor(() => expect(select).toHaveValue('registration-2'))
    expect(item.registration_id).toBe('registration-2')
    await user.selectOptions(select, '')
    await waitFor(() => expect(select).toHaveValue(''))
    expect(patches).toEqual([
      { id: 'saved-photo', registration_id: 'registration-2' },
      { id: 'saved-photo', registration_id: null },
    ])
    expect(commits).toHaveLength(1)
    expect(putToPresignedUrl).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
  })

  it('preserves persisted attribution on failure and retries only PATCH', async () => {
    const user = userEvent.setup()
    const api = uploadHandlers()
    renderWithProviders(<MediaUploader eventId="event-1" registrations={registrations} />)
    await user.selectOptions(screen.getByLabelText('Attribute all to…'), 'registration-1')
    await choosePhoto(user)
    await screen.findByText('Uploaded')
    const row = screen.getByText('stage.jpg').closest('li')!
    const select = within(row).getByRole('combobox', { name: 'Performer' })
    api.failPatch(true)
    await user.selectOptions(select, 'registration-2')
    expect(await within(row).findByRole('alert')).toHaveTextContent('Media consent has been revoked.')
    expect(select).toHaveValue('registration-1')
    api.failPatch(false)
    await user.selectOptions(select, 'registration-2')
    await waitFor(() => expect(select).toHaveValue('registration-2'))
    expect(within(row).queryByRole('alert')).not.toBeInTheDocument()
    expect(api.patches).toHaveLength(2)
    expect(api.commits).toHaveLength(1)
    expect(putToPresignedUrl).toHaveBeenCalledTimes(1)
  })

  it('locks photo and video commits to the registration, without an account or profile link', async () => {
    const user = userEvent.setup()
    const { commits } = uploadHandlers()
    renderWithProviders(<main className="app"><RegistrationMediaUploadModal eventId="event-1" registration={registration} onClose={vi.fn()} /></main>)
    await choosePhoto(user)
    await screen.findByText('Uploaded')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '+ Add video' }))
    await user.type(screen.getByLabelText('Video URL'), 'https://youtu.be/dQw4w9WgXcQ')
    await user.click(screen.getByRole('button', { name: 'Add video' }))
    await waitFor(() => expect(commits).toHaveLength(2))
    expect(commits).toEqual([
      { media_type: 'photo', object_key: 'tmp/photo.jpg', event_id: 'event-1', registration_id: 'registration-1' },
      { media_type: 'video', video_url: 'https://youtu.be/dQw4w9WgXcQ', event_id: 'event-1', registration_id: 'registration-1' },
    ])
    await waitFor(() => expect(screen.queryByLabelText('Video URL')).not.toBeInTheDocument())
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('leaves series photo uploads free-standing and keeps file validation', async () => {
    const user = userEvent.setup()
    const { commits } = uploadHandlers()
    renderWithProviders(<MediaUploader openMicId="series-1" />)
    await choosePhoto(user)
    await screen.findByText('Uploaded')
    expect(commits[0]).toEqual({ media_type: 'photo', object_key: 'tmp/photo.jpg', open_mic_id: 'series-1' })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Choose photos'), { target: { files: [new File(['heic'], 'camera.heic', { type: 'image/heic' })] } })
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(commits).toHaveLength(1)
  })

  it('freezes attribution while uploading and committing', async () => {
    const user = userEvent.setup()
    uploadHandlers()
    let finishUpload!: () => void
    vi.mocked(putToPresignedUrl).mockImplementation(() => new Promise<void>((resolve) => { finishUpload = resolve }))
    renderWithProviders(<MediaUploader eventId="event-1" registrations={registrations} />)
    await choosePhoto(user)
    await waitFor(() => expect(putToPresignedUrl).toHaveBeenCalled())
    expect(within(screen.getByText('stage.jpg').closest('li')!).getByRole('combobox')).toBeDisabled()
    await act(async () => finishUpload())
    await screen.findByText('Uploaded')
    expect(within(screen.getByText('stage.jpg').closest('li')!).getByRole('combobox')).toBeEnabled()
  })

  it('disables only the row being reassigned until PATCH settles', async () => {
    const user = userEvent.setup()
    const api = uploadHandlers()
    let finishPatch!: () => void
    server.use(http.patch('/api/media/:id', async () => {
      await new Promise<void>((resolve) => { finishPatch = resolve })
      return HttpResponse.json({ ...api.item, registration_id: 'registration-2' })
    }))
    renderWithProviders(<MediaUploader eventId="event-1" registrations={registrations} />)
    await choosePhoto(user)
    await screen.findByText('Uploaded')
    const select = within(screen.getByText('stage.jpg').closest('li')!).getByRole('combobox')
    await user.selectOptions(select, 'registration-2')
    await waitFor(() => expect(finishPatch).toBeDefined())
    expect(select).toBeDisabled()
    expect(select).toHaveValue('')
    expect(screen.getByLabelText('Attribute all to…')).toBeEnabled()
    await act(async () => finishPatch())
    await waitFor(() => expect(select).toHaveValue('registration-2'))
    expect(select).toBeEnabled()
  })
})

function UploadDialogHarness() {
  const [open, setOpen] = useState(true)
  return <main className="app">{open && <RegistrationMediaUploadModal eventId="event-1" registration={registration} onClose={() => setOpen(false)} />}</main>
}

describe('Roster upload cancellation', () => {
  it.each(['close', 'escape', 'backdrop'])('confirms %s dismissal, preserves work on decline, and aborts on confirmation', async (dismissal) => {
    const user = userEvent.setup()
    const { commits } = uploadHandlers()
    let signal: AbortSignal | undefined
    vi.mocked(putToPresignedUrl).mockImplementation((_url, _file, handlers) => new Promise<void>((_resolve, reject) => {
      signal = handlers.signal
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))
    }))
    renderWithProviders(<UploadDialogHarness />)
    await choosePhoto(user)
    await waitFor(() => expect(signal).toBeDefined())
    const dismiss = async () => {
      if (dismissal === 'close') await user.click(screen.getByRole('button', { name: 'Close' }))
      else if (dismissal === 'escape') await user.keyboard('{Escape}')
      else await user.click(screen.getByRole('dialog').parentElement!)
    }
    await dismiss()
    expect(await screen.findByRole('alert')).toHaveTextContent('Cancel unfinished uploads and close?')
    await user.click(screen.getByRole('button', { name: 'Continue uploading' }))
    expect(signal?.aborted).toBe(false)
    expect(screen.getByText('stage.jpg')).toBeVisible()
    await dismiss()
    await user.click(screen.getByRole('button', { name: 'Cancel uploads and close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(signal?.aborted).toBe(true)
    expect(commits).toHaveLength(0)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-preview')
  })

  it('closes completed uploads without confirmation and keeps saved media', async () => {
    const user = userEvent.setup()
    const { commits } = uploadHandlers()
    renderWithProviders(<UploadDialogHarness />)
    await choosePhoto(user)
    await screen.findByText('Uploaded')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(commits).toHaveLength(1)
  })

  it('keeps an already-started commit when cancellation is confirmed', async () => {
    const user = userEvent.setup()
    uploadHandlers()
    let finishCommit!: () => void
    let saved = false
    server.use(http.post('/api/media', async () => {
      await new Promise<void>((resolve) => { finishCommit = resolve })
      saved = true
      return HttpResponse.json(mediaItem({ registration_id: registration.id }))
    }))
    renderWithProviders(<UploadDialogHarness />)
    await choosePhoto(user)
    await waitFor(() => expect(finishCommit).toBeDefined())
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Media already being saved may still complete.')
    await user.click(screen.getByRole('button', { name: 'Cancel uploads and close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => finishCommit())
    await waitFor(() => expect(saved).toBe(true))
  })

  it('stops cancellable uploads if the registration loses media consent', async () => {
    const user = userEvent.setup()
    const { commits } = uploadHandlers()
    let signal: AbortSignal | undefined
    vi.mocked(putToPresignedUrl).mockImplementation((_url, _file, handlers) => new Promise<void>((_resolve, reject) => {
      signal = handlers.signal
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))
    }))
    const { rerender } = renderWithProviders(<main className="app"><RegistrationMediaUploadModal eventId="event-1" registration={registration} onClose={vi.fn()} /></main>)
    await choosePhoto(user)
    await waitFor(() => expect(signal).toBeDefined())
    rerender(<main className="app"><RegistrationMediaUploadModal eventId="event-1" registration={{ ...registration, media_consent: false }} onClose={vi.fn()} /></main>)
    await waitFor(() => expect(signal?.aborted).toBe(true))
    expect(screen.getByRole('status')).toHaveTextContent('Enable media consent')
    expect(screen.queryByRole('button', { name: 'Choose photos' })).not.toBeInTheDocument()
    expect(commits).toHaveLength(0)
  })
})
