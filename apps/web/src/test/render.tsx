import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRootRoute, createRouter, RouterContextProvider } from '@tanstack/react-router'
import { render, type RenderOptions } from '@testing-library/react'
import type { PropsWithChildren, ReactElement } from 'react'

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

// Component tests render individual pages directly (not through the app's real route tree), but
// pages use TanStack Router's <Link>, which needs a router in context even when nothing is
// actually being route-matched. RouterContextProvider supplies that context and — unlike
// RouterProvider — renders its own children instead of the router's matched route.
const testRouter = createRouter({ routeTree: createRootRoute() })

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  const queryClient = createTestQueryClient()
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}><RouterContextProvider router={testRouter}>{children}</RouterContextProvider></QueryClientProvider>
  }
  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient }
}