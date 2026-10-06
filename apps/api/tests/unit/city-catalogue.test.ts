import { describe, expect, it } from 'vitest';

import { parseCityCatalogue, parseCityCatalogueJson } from '../../src/cities/catalogue.js';

const source = {
  name: 'Simplemaps World Cities Database',
  edition: 'Basic',
  url: 'https://simplemaps.com/data/world-cities',
  license: 'CC BY 4.0',
  license_url: 'https://creativecommons.org/licenses/by/4.0/',
  converted_from: 'worldcities.csv',
};

function city(overrides: Record<string, unknown> = {}) {
  return {
    source_id: '001',
    city: 'São Tomé',
    city_ascii: 'Sao Tome',
    country: 'São Tomé and Príncipe',
    country_ascii: 'Sao Tome and Principe',
    iso2: 'ST',
    iso3: 'STP',
    admin_name: null,
    lat: 0.3,
    lng: -6.7,
    population: null,
    capital: 'primary',
    retired: false,
    ...overrides,
  };
}

function document(cities: unknown[]) {
  return { version: 1, source, cities };
}

describe('city catalogue validation', () => {
  it('validates Unicode/ASCII names and retains null population and retirement state', () => {
    const catalogue = parseCityCatalogue(document([city()]));
    expect(catalogue.cities[0]).toMatchObject({
      source_id: '001',
      city: 'São Tomé',
      city_ascii: 'Sao Tome',
      population: null,
      retired: false,
    });
    expect(catalogue.bySourceId.get('001')).toBe(catalogue.cities[0]);
  });

  it('allows duplicate names but rejects duplicate source identities', () => {
    expect(parseCityCatalogue(document([city(), city({ source_id: '002' })])).cities).toHaveLength(2);
    expect(() => parseCityCatalogue(document([city(), city()]))).toThrow(/duplicate source identity 001/);
  });

  it.each([
    ['version', document([city()]), { version: 2 }],
    ['missing city name', document([city({ city: ' ' })]), {}],
    ['invalid country code', document([city({ iso2: 'S' })]), {}],
    ['invalid coordinates', document([city({ lat: 91 })]), {}],
    ['unsafe population', document([city({ population: Number.MAX_SAFE_INTEGER + 1 })]), {}],
    ['invalid retirement flag', document([city({ retired: 'false' })]), {}],
    ['invalid source licence', { ...document([city()]), source: { ...source, license_url: 'nope' } }, {}],
  ])('rejects %s', (_label, input, extra) => {
    expect(() => parseCityCatalogue({ ...input, ...extra })).toThrow();
  });

  it('reports malformed JSON explicitly', () => {
    expect(() => parseCityCatalogueJson('{')).toThrow(/not valid JSON/);
  });
});
