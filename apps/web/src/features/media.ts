import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../api/client'

// Mirrors openapi.yaml → Media.
export type MediaRendition = { url: string; width: number; height: number; mime_type: string; size_bytes: number }
export type MediaRenditions = { thumb?: MediaRendition; grid?: MediaRendition; lightbox?: MediaRendition; original?: MediaRendition }
export type MediaAttribution = {
  performer_name: string
  performer_city: string | null
  profile_id: string | null
  profile_handle: string | null
}
export type MediaCaptionContext = {
  event_name: string | null
  event_starts_at: string | null
  event_time_zone: string | null
  series_name: string | null
}
export type MediaItem = {
  id: string
  media_type: 'photo' | 'video'
  event_id: string | null
  open_mic_id: string | null
  registration_id: string | null
  added_by_profile_id: string
  deleted_at: string | null
  recovery_deadline: string | null
  deletion_reason: 'organizer' | 'consent_revocation' | null
  source_url: string
  mime_type: string | null
  size_bytes: number | null
  caption: string | null
  thumbnail_url: string | null
  width: number | null
  height: number | null
  duration_seconds: number | null
  video_platform: 'youtube' | 'vimeo' | null
  platform_video_id: string | null
  alt_text: string
  renditions: MediaRenditions | null
  attribution: MediaAttribution | null
  caption_context: MediaCaptionContext
  created_at: string
}

export type MediaListPage = { items: MediaItem[]; prev_cursor: string | null; next_cursor: string | null }
export type MediaTypeFilter = 'all' | 'photo' | 'video'
export type MediaSort = 'newest' | 'shuffle'

export type MediaScope =
  | { kind: 'event'; id: string }
  | { kind: 'open-mic'; id: string }
  | { kind: 'profile'; id: string }

function scopePath(scope: MediaScope): string {
  switch (scope.kind) {
    case 'event': return `/events/${scope.id}/media`
    case 'open-mic': return `/open-mics/${scope.id}/media`
    case 'profile': return `/profiles/${scope.id}/media`
  }
}

export const mediaKeys = {
  all: ['media'] as const,
  list: (scope: MediaScope, type: MediaTypeFilter, sort: MediaSort, seed?: number, excludeFeatured?: boolean) =>
    [...mediaKeys.all, 'list', scope.kind, scope.id, type, sort, seed, excludeFeatured] as const,
  item: (id: string | undefined) => [...mediaKeys.all, 'item', id] as const,
  featured: (openMicId: string | undefined) => [...mediaKeys.all, 'featured', openMicId] as const,
  recentlyDeleted: () => [...mediaKeys.all, 'recently-deleted'] as const,
}

export function useMediaList(scope: MediaScope, options: { type: MediaTypeFilter; sort: MediaSort; seed?: number; anchor?: string; enabled?: boolean; excludeFeatured?: boolean }) {
  const { type, sort, seed, anchor, enabled = true, excludeFeatured = false } = options
  return useInfiniteQuery({
    queryKey: mediaKeys.list(scope, type, sort, seed, excludeFeatured),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ type, sort, limit: '24' })
      if (sort === 'shuffle' && seed !== undefined) params.set('seed', String(seed))
      // Series galleries keep Featured pins out of the masonry (strip above the grid).
      if (excludeFeatured && scope.kind === 'open-mic') params.set('exclude_featured', 'true')
      if (pageParam) params.set('cursor', pageParam as string)
      else if (anchor) params.set('anchor', anchor)
      return api<MediaListPage>(`${scopePath(scope)}?${params.toString()}`)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    getPreviousPageParam: (first) => first.prev_cursor ?? undefined,
    enabled: Boolean(scope.id) && enabled,
  })
}

export function useMediaItem(mediaId: string | undefined) {
  return useQuery({
    queryKey: mediaKeys.item(mediaId),
    queryFn: () => api<MediaItem>(`/media/${mediaId}`),
    enabled: Boolean(mediaId),
    retry: false,
  })
}

export function useFeaturedMedia(openMicId: string | undefined) {
  return useQuery({
    queryKey: mediaKeys.featured(openMicId),
    queryFn: () => api<{ items: MediaItem[] }>(`/open-mics/${openMicId}/featured-media`),
    enabled: Boolean(openMicId),
  })
}

/** Flattened items across fetched pages, in sort order (DOM order = sort order). */
export function flattenMediaPages(data: { pages: MediaListPage[] } | undefined): MediaItem[] {
  return data?.pages.flatMap((page) => page.items) ?? []
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useUpdateMedia() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; caption?: string | null; registration_id?: string | null }) =>
      api<MediaItem>(`/media/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: (_updated, variables) => {
      queryClient.removeQueries({ queryKey: mediaKeys.item(variables.id) })
      void queryClient.invalidateQueries({ queryKey: mediaKeys.all })
    },
  })
}

export function useSoftDeleteMedia() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (mediaId: string) => api<void>(`/media/${mediaId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mediaKeys.all })
    },
  })
}

export function useRecoverMedia() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (mediaId: string) => api<MediaItem>(`/media/${mediaId}/recover`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mediaKeys.all })
      void queryClient.invalidateQueries({ queryKey: mediaKeys.recentlyDeleted() })
    },
  })
}

export function useReplaceFeaturedMedia(openMicId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (mediaIds: string[]) =>
      api<{ items: MediaItem[] }>(`/open-mics/${openMicId}/featured-media`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_ids: mediaIds }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mediaKeys.featured(openMicId) })
    },
  })
}

export type RecentlyDeletedGroup = {
  open_mic_id: string
  open_mic_name: string
  event_id: string | null
  event_title: string | null
  items: MediaItem[]
}

export function useRecentlyDeletedMedia(enabled = true) {
  return useQuery({
    queryKey: mediaKeys.recentlyDeleted(),
    queryFn: () => api<{ items: RecentlyDeletedGroup[]; next_cursor: string | null }>('/me/media/recently-deleted'),
    enabled,
  })
}

// ---------------------------------------------------------------------------
// Upload pipeline: reserve → PUT to the presigned URL → commit
// ---------------------------------------------------------------------------

export type MediaCommitInput =
  | { media_type: 'photo'; object_key: string; caption?: string; event_id?: string; open_mic_id?: string; registration_id?: string }
  | { media_type: 'video'; video_url: string; caption?: string; event_id?: string; open_mic_id?: string; registration_id?: string }

export function useCommitMedia() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: MediaCommitInput) =>
      api<MediaItem>('/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mediaKeys.all })
    },
  })
}

export function useCreateUploadUrl() {
  return useMutation({
    mutationFn: (input: { media_type: 'photo'; mime_type: string; size_bytes: number }) =>
      api<{ upload_url: string; object_key: string; expires_at: string }>('/media/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
  })
}

/**
 * PUTs bytes straight to the presigned S3 URL — deliberately NOT through the shared API
 * client: the request targets the storage origin, carries no Authorization header, and
 * reports progress via XHR (fetch has no upload progress).
 */
export function putToPresignedUrl(
  uploadUrl: string,
  file: File,
  handlers: { onProgress: (fraction: number) => void; signal: AbortSignal },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', file.type)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) handlers.onProgress(event.loaded / event.total)
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed with status ${xhr.status}`)))
    xhr.onerror = () => reject(new Error('Upload failed'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    handlers.signal.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(file)
  })
}
