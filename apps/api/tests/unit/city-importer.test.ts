import { describe, expect, it } from 'vitest';

import { parseCityCsv } from '../../src/cities/importer.js';

const header = 'id,admin_name,city,city_ascii,country,iso2,iso3,lat,lng,population,capital';

describe('parseCityCsv', () => {
  it('parses BOM, quoted commas, Unicode and missing populations', () => {
    const csv = `\uFEFF${header}\n1,"Región, Norte","São Tomé","Sao Tome","España",ES,ESP,0.3,-6.7,,primary`;
    const parsed = parseCityCsv(csv);
    expect(parsed.duplicates).toBe(0);
    expect(parsed.rows).toEqual([{
      sourceId: '1',
      adminName: 'Región, Norte',
      city: 'São Tomé',
      cityAscii: 'Sao Tome',
      country: 'España',
      countryAscii: 'Espana',
      iso2: 'ES',
      iso3: 'ESP',
      lat: 0.3,
      lng: -6.7,
      population: null,
      metadata: { capital: 'primary' },
    }]);
  });

  it('deduplicates repeated identical source identities', () => {
    const row = '1,Region,Dublin,Dublin,Ireland,IE,IRL,53.3,-6.2,100,primary';
    expect(parseCityCsv(`${header}\n${row}\n${row}`)).toMatchObject({ rows: [{ sourceId: '1' }], duplicates: 1 });
  });

  it('rejects conflicting duplicate source identities', () => {
    expect(() => parseCityCsv(`${header}\n1,Region,Dublin,Dublin,Ireland,IE,IRL,53.3,-6.2,100,\n1,Region,Cork,Cork,Ireland,IE,IRL,51.9,-8.5,200,`))
      .toThrow(/conflicting duplicate source id 1/);
  });

  it('rejects invalid coordinates, codes and population values', () => {
    expect(() => parseCityCsv(`${header}\n1,Region,Dublin,Dublin,Ireland,I,IRL,53.3,-6.2,100,`)).toThrow(/identity field/);
    expect(() => parseCityCsv(`${header}\n1,Region,Dublin,Dublin,Ireland,IE,IRL,91,-6.2,100,`)).toThrow(/coordinates/);
    expect(() => parseCityCsv(`${header}\n1,Region,Dublin,Dublin,Ireland,IE,IRL,53.3,-6.2,-1,`)).toThrow(/population/);
  });

  it('requires the expected source headers', () => {
    expect(() => parseCityCsv('city,country\nDublin,Ireland')).toThrow(/missing required headers/);
  });
});
