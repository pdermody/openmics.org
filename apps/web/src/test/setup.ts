import '@testing-library/jest-dom/vitest'
import { i18nReady } from '../i18n'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server'

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
afterEach(() => server.resetHandlers())
afterAll(() => server.close())