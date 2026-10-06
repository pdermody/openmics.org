import { z } from 'zod'

export const discoverySearchSchema = z.object({
  tab: z.enum(['open-mics', 'events']).default('open-mics'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
})

export type DiscoverySearch = z.infer<typeof discoverySearchSchema>
