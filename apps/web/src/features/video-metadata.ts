// Video caption prefill (design §8.4): the "+ Add video" form fetches the provider's
// oEmbed title directly from the browser — both providers allow cross-origin reads
// (YouTube sends ACAO for the requesting origin, Vimeo sends `*`), and no API key is
// needed. Best-effort: any failure (offline, 404 for unknown/removed videos, malformed
// payload) resolves to null and the caption simply stays empty.

export type VideoLink = { platform: 'youtube' | 'vimeo'; id: string }

const OEMBED_TIMEOUT_MS = 5000

function oEmbedUrl(link: VideoLink): string {
  const canonical = link.platform === 'youtube'
    ? `https://www.youtube.com/watch?v=${link.id}`
    : `https://vimeo.com/${link.id}`
  return link.platform === 'youtube'
    ? `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`
    : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(canonical)}`
}

/** Resolves the provider's video title, or null when unavailable. Never throws. */
export async function fetchVideoTitle(link: VideoLink): Promise<string | null> {
  try {
    const response = await fetch(oEmbedUrl(link), { signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS) })
    if (!response.ok) return null
    const body = (await response.json()) as { title?: unknown }
    return typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : null
  } catch {
    return null
  }
}
