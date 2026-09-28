import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    fileParallelism: false,
    maxWorkers: 1,
    exclude: ['e2e/**', 'node_modules/**'],
    // Must exceed asyncUtilTimeout (5000ms, see src/test/setup.ts) so slow findBy*/waitFor calls fail with their real assertion.
    testTimeout: 15000,
  },
})
