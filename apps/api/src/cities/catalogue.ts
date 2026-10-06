import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const nonEmptyTrimmedString = z.string().min(1).refine((value) => value === value.trim());

const citySchema = z.object({
  source_id: nonEmptyTrimmedString,
  city: nonEmptyTrimmedString,
  city_ascii: nonEmptyTrimmedString,
  country: nonEmptyTrimmedString,
  country_ascii: nonEmptyTrimmedString,
  iso2: z.string().regex(/^[A-Z]{2}$/),
  iso3: z.string().regex(/^[A-Z]{3}$/).nullable(),
  admin_name: z.string().nullable(),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  population: z.number().int().safe().nonnegative().nullable(),
  capital: z.string().nullable(),
  retired: z.boolean(),
}).strict();

const documentSchema = z.object({
  version: z.literal(1),
  source: z.object({
    name: nonEmptyTrimmedString,
    edition: nonEmptyTrimmedString,
    url: z.string().url(),
    license: nonEmptyTrimmedString,
    license_url: z.string().url(),
    converted_from: nonEmptyTrimmedString,
  }).strict(),
  cities: z.array(citySchema).min(1),
}).strict();

export type CityCatalogueEntry = Readonly<z.infer<typeof citySchema>>;
export type CityCatalogueDocument = Readonly<z.infer<typeof documentSchema>>;
export type CitySearchEntry = CityCatalogueEntry & Readonly<{
  normalizedCity: string;
  normalizedCityAscii: string;
  normalizedCountry: string;
  normalizedCountryAscii: string;
}>;

export type CityCatalogue = Readonly<{
  cities: readonly CitySearchEntry[];
  bySourceId: ReadonlyMap<string, CitySearchEntry>;
}>;

let packagedCatalogue: Promise<CityCatalogue> | undefined;

export function parseCityCatalogue(value: unknown): CityCatalogue {
  const parsed = documentSchema.parse(value);
  const bySourceId = new Map<string, CitySearchEntry>();
  const cities = parsed.cities.map((city) => {
    if (bySourceId.has(city.source_id)) {
      throw new Error(`City catalogue contains duplicate source identity ${city.source_id}`);
    }
    const entry = Object.freeze({
      ...city,
      normalizedCity: city.city.toLocaleLowerCase(),
      normalizedCityAscii: city.city_ascii.toLocaleLowerCase(),
      normalizedCountry: city.country.toLocaleLowerCase(),
      normalizedCountryAscii: city.country_ascii.toLocaleLowerCase(),
    });
    bySourceId.set(city.source_id, entry);
    return entry;
  });
  return Object.freeze({ cities: Object.freeze(cities), bySourceId });
}

export function parseCityCatalogueJson(contents: string): CityCatalogue {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error('City catalogue is not valid JSON', { cause: error });
  }
  return parseCityCatalogue(value);
}

export function loadCityCatalogue(): Promise<CityCatalogue> {
  packagedCatalogue ??= readFile(new URL('./world-cities.json', import.meta.url), 'utf8')
    .then(parseCityCatalogueJson);
  return packagedCatalogue;
}

export async function validatePackagedCityCatalogue(): Promise<{ cities: number }> {
  const catalogue = await loadCityCatalogue();
  return { cities: catalogue.cities.length };
}
