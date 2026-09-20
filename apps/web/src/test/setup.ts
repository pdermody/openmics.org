import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { i18n, i18nReady } from '../i18n'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { server } from './server'

// RTL's default 1000ms asyncUtilTimeout is too tight for this suite: jsdom environments are
// recreated per file (fileParallelism/isolation), and under load that margin causes intermittent,
// unrelated findBy*/waitFor timeouts rather than genuine assertion failures.
configure({ asyncUtilTimeout: 5000 })


if (!window.matchMedia) {
	window.matchMedia = (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => undefined,
		removeListener: () => undefined,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
		dispatchEvent: () => false,
	})
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeAll(async () => i18nReady)
beforeEach(async () => {
	server.resetHandlers()
	window.localStorage.clear()
	window.sessionStorage.clear()
	await i18n.changeLanguage('en')
})
afterEach(() => server.resetHandlers())
afterAll(() => server.close())