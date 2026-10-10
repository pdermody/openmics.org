export function gallerySearchSchema(search: Record<string, unknown>): {
  media?: string; mediaUnavailable?: string; type?: string; sort?: string;
  tab?: 'events' | 'photos' | 'videos'; period?: 'upcoming' | 'past'; page?: number; year?: number; month?: number;
} {
  const integer = (value: unknown, max: number) => {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : undefined
  }
  const year = integer(search.year, 9999)
  return {
    media: typeof search.media === 'string' ? search.media : undefined,
    mediaUnavailable: typeof search.mediaUnavailable === 'string' ? search.mediaUnavailable : undefined,
    type: typeof search.type === 'string' ? search.type : undefined,
    sort: typeof search.sort === 'string' ? search.sort : undefined,
    tab: search.tab === 'events' || search.tab === 'photos' || search.tab === 'videos' ? search.tab : undefined,
    period: search.period === 'past' || search.period === 'upcoming' ? search.period : undefined,
    page: integer(search.page, 100000),
    year,
    month: year ? integer(search.month, 12) : undefined,
  }
}
