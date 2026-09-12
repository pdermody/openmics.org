import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const checkerCandidates = [
  resolve(process.cwd(), 'scripts/check-untranslated-ui.mjs'),
  resolve(process.cwd(), 'apps/web/scripts/check-untranslated-ui.mjs'),
]
const checker = checkerCandidates.find((candidate) => existsSync(candidate)) ?? checkerCandidates[0]

describe('source localization', () => {
  it('contains no potential untranslated UI text', () => {
    expect(() => execFileSync(process.execPath, [checker], { encoding: 'utf8', stdio: 'pipe' })).not.toThrow()
  })
})
