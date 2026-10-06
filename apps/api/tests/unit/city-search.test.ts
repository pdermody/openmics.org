import { describe, expect, it } from 'vitest';

import { parseCityCatalogue } from '../../src/cities/catalogue.js';
import { compareResolvedCityCandidates, selectCitySearchCandidates } from '../../src/cities/search.js';

const source = {
  name: 'Test cities',
  edition: 'Test',
  url: 'https://example.test/cities',
  license: 'Test',
  license_url: 'https://example.test/license',
  converted_from: 'fixture',
};

function entry(sourceId: string, city: string, overrides: Record<string, unknown> = {}) {
  return {
    source_id: sourceId,
    city,
    city_ascii: city,
    country: 'Ireland',
    country_ascii: 'Ireland',
    iso2: 'IE',
    iso3: 'IRL',
    admin_name: 'Leinster',
    lat: 53.3,
    lng: -6.2,
    population: 100,
    capital: null,
    retired: false,
    ...overrides,
  };
}

function catalogue(cities: ReturnType<typeof entry>[]) {
  return parseCityCatalogue({ version: 1, source, cities });
}

describe('city catalogue search', () => {
  it('matches Unicode and ASCII city/country text and treats wildcard punctuation literally', () => {
    const data = catalogue([
      entry('unicode', 'São Tomé', { city_ascii: 'Sao Tome', country: 'España', country_ascii: 'Espana' }),
      entry('literal', '100% City'),
      entry('not-literal', '1000 City'),
    ]);
    expect(selectCitySearchCandidates(data, 'Sao Tome').map((city) => city.source_id)).toEqual(['unicode']);
    expect(selectCitySearchCandidates(data, 'Espana').map((city) => city.source_id)).toEqual(['unicode']);
    expect(selectCitySearchCandidates(data, '%').map((city) => city.source_id)).toEqual(['literal']);
  });

  it('ranks exact city names, prefixes, then other city/country matches by population', () => {
    const data = catalogue([
      entry('country', 'Elsewhere', { country: 'Dubliner Republic', population: 100_000 }),
      entry('substring', 'New Dublin', { population: 5_000 }),
      entry('prefix-low', 'Dublin East', { population: 10 }),
      entry('prefix-high', 'Dublin West', { population: 50 }),
      entry('exact-null', 'Dublin', { population: null }),
      entry('exact', 'Dublin', { population: 1 }),
      entry('retired', 'Dublin Retired', { retired: true, population: 999_999 }),
    ]);
    expect(selectCitySearchCandidates(data, 'dublin').map((city) => city.source_id)).toEqual([
      'exact', 'exact-null', 'prefix-high', 'prefix-low', 'country', 'substring',
    ]);
    expect(selectCitySearchCandidates(data, 'Dublin', 'GB')).toHaveLength(0);
    expect(selectCitySearchCandidates(data, 'Dublin', 'IE').map((city) => city.source_id)).toHaveLength(6);
  });

  it('uses UUID ordering for stable ties and includes the whole result-boundary tie group', () => {
    const data = catalogue(Array.from({ length: 12 }, (_, index) => entry(`id-${index}`, 'Same City')));
    const candidates = selectCitySearchCandidates(data, 'Same City');
    expect(candidates).toHaveLength(12);
    const ids = new Map(candidates.map((city, index) => [city.source_id, `00000000-0000-0000-0000-${String(12 - index).padStart(12, '0')}`]));
    expect(candidates.sort((left, right) => compareResolvedCityCandidates(left, right, 'Same City', ids))
      .slice(0, 10).map((city) => ids.get(city.source_id)))
      .toEqual([...ids.values()].sort().slice(0, 10));
  });

  it('applies the ten-result maximum when there is no boundary tie', () => {
    const data = catalogue(Array.from({ length: 20 }, (_, index) => entry(`id-${index}`, `Town ${index}`, { population: index })));
    expect(selectCitySearchCandidates(data, 'Town').length).toBe(10);
  });
});
