import { CalendarDays, Mic, type LucideIcon } from 'lucide-react'

export type ProfileKind = 'performer' | 'organizer'

export const PROFILE_KINDS = {
  performer: { icon: Mic, labelKey: 'profileKinds.performer', titleKey: 'profileKindTitles.performer' },
  organizer: { icon: CalendarDays, labelKey: 'profileKinds.organizer', titleKey: 'profileKindTitles.organizer' },
} satisfies Record<ProfileKind, { icon: LucideIcon; labelKey: string; titleKey: string }>

export const PROFILE_KIND_ORDER: ProfileKind[] = ['performer', 'organizer']

export function profileKindMeta(kind: string | null | undefined) {
  return kind && kind in PROFILE_KINDS ? PROFILE_KINDS[kind as ProfileKind] : undefined
}
