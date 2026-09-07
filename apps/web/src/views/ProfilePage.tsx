import { DetailPage } from './DetailPage'
import type { ThemeProps } from './shared'

export function ProfilePage({ id, theme, mode }: { id: string } & ThemeProps) {
  return <DetailPage kind="profile" id={id} theme={theme} mode={mode} />
}
