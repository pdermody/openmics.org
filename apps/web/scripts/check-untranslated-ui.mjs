import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function sourceFilesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'test') files.push(...await sourceFilesIn(path))
    } else if (/\.(tsx|ts)$/.test(entry.name) && entry.name !== 'i18n.ts') {
      files.push(path)
    }
  }
  return files
}

const sourceFiles = await sourceFilesIn(join(root, 'src'))

const findings = []
// A JSX text node follows a tag's `>`. The negative lookbehind avoids treating
// arrow-function syntax (`=>`) inside JSX attributes as visible text.
const textChildPattern = /(?<![=])>\s*([A-Za-z][^<{\n]*?)\s*</g
const attributePattern = /\b(?:aria-label|placeholder|title)\s*=\s*["']([A-Za-z][^"']*)["']/g
const translationCallPattern = /\bt\s*\(/
const nonUiLinePattern = /^(?:\s*\/\/|\s*\*|\s*\/\*)/
const ignoredText = new Set(['open mic'])

for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8')
  const lines = source.split(/\r?\n/)
  const relativePath = relative(root, file).replaceAll('\\', '/')

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (nonUiLinePattern.test(line) || translationCallPattern.test(line)) continue
    if (line.includes('friendlyApiErrorMessage(') || line.includes('registrationErrorMessage(') || line.includes('kioskErrorMessage(')) continue

    for (const match of line.matchAll(textChildPattern)) {
      const text = match[1].trim()
      if (text && !ignoredText.has(text) && /[A-Za-z]{2}/.test(text)) {
        findings.push(`${relativePath}:${index + 1}: JSX text "${text}"`)
      }
    }

    for (const match of line.matchAll(attributePattern)) {
      const text = match[1].trim()
      if (text && !ignoredText.has(text) && /[A-Za-z]{2}/.test(text)) {
        findings.push(`${relativePath}:${index + 1}: UI attribute "${text}"`)
      }
    }
  }
}

if (findings.length > 0) {
  console.error(`Found ${findings.length} potential untranslated UI string(s):`)
  for (const finding of findings) console.error(`- ${finding}`)
  process.exitCode = 1
} else {
  console.log('No potential untranslated UI strings found.')
}
