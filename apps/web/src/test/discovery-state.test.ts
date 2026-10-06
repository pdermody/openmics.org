import { afterEach, describe, expect, it } from 'vitest'
import { useDiscoveryStore } from '../features/discovery'
import { discoverySearchSchema } from '../features/discoverySearch'

afterEach(() => useDiscoveryStore.setState({ latest: null, entries: {} }))

describe('discovery browsing state', () => {
  it('retains each history entry and starts new navigation from the restored choice', () => {
    const selected = { lat: 51, lng: -8, radiusKm: 50, label: 'Cork' }
    const expanded = { ...selected, radiusKm: 135 }
    const store = useDiscoveryStore.getState()
    store.choose('home', selected)
    store.remember('results', selected)
    store.choose('results', expanded)
    store.remember('detail', expanded)
    expect(useDiscoveryStore.getState().entries.home).toEqual(selected)
    expect(useDiscoveryStore.getState().entries.detail).toEqual(expanded)
    store.remember('home', selected)
    expect(useDiscoveryStore.getState().latest).toEqual(selected)
    store.remember('new-results', useDiscoveryStore.getState().latest)
    expect(useDiscoveryStore.getState().entries['new-results']).toEqual(selected)
  })

  it('clears the active override without modifying older history snapshots', () => {
    const store = useDiscoveryStore.getState()
    store.choose('old', { lat: 51, lng: -8, radiusKm: 135, label: 'Cork' })
    store.choose('current', null)
    expect(useDiscoveryStore.getState().latest).toBeNull()
    expect(useDiscoveryStore.getState().entries.old?.radiusKm).toBe(135)
  })

  it('validates tab and bounded numbered pagination', () => {
    expect(discoverySearchSchema.parse({})).toEqual({ tab: 'open-mics', page: 1 })
    expect(discoverySearchSchema.parse({ tab: 'events', page: '2' })).toEqual({ tab: 'events', page: 2 })
    for (const page of [0, -1, 1.5, 'NaN', 100001]) expect(discoverySearchSchema.safeParse({ page }).success).toBe(false)
    expect(discoverySearchSchema.safeParse({ tab: 'all' }).success).toBe(false)
  })
})
