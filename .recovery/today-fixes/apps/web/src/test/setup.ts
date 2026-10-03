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

if (!Element.prototype.hasPointerCapture) {
	Object.defineProperties(Element.prototype, {
		hasPointerCapture: { value: () => false, configurable: true },
		setPointerCapture: { value: () => undefined, configurable: true },
		releasePointerCapture: { value: () => undefined, configurable: true },
	})
}

if (!Element.prototype.scrollIntoView) {
	Object.defineProperty(Element.prototype, 'scrollIntoView', {
		value: () => undefined,
		configurable: true,
	})
}

// jsdom lacks both observers; the media gallery's masonry + infinite scroll need them.
// The ResizeObserver mock reports a deterministic 800px container width.
if (!window.ResizeObserver) {
	Object.defineProperty(window, 'ResizeObserver', {
		value: class {
			callback: ResizeObserverCallback
			constructor(callback: ResizeObserverCallback) { this.callback = callback }
			observe() {
				this.callback([{ contentRect: { width: 800 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
			}
			unobserve() {}
			disconnect() {}
		},
		writable: true,
	})
}

if (!window.IntersectionObserver) {
	Object.defineProperty(window, 'IntersectionObserver', {
		value: class {
			constructor(_callback: IntersectionObserverCallback) {}
			observe() {}
			unobserve() {}
			disconnect() {}
		},
		writable: true,
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