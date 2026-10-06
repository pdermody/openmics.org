import type { CityCatalogue, CitySearchEntry } from './catalogue.js';

const RESULT_LIMIT = 10;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNullableStrings(left: string | null, right: string | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return compareStrings(left.toLocaleLowerCase(), right.toLocaleLowerCase());
}

function comparePopulation(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return right - left;
}

function matchRank(city: CitySearchEntry, query: string): number | null {
  const exact = city.normalizedCity === query || city.normalizedCityAscii === query;
  if (exact) return 0;
  const prefix = city.normalizedCity.startsWith(query) || city.normalizedCityAscii.startsWith(query);
  if (prefix) return 1;
  const contains = city.normalizedCity.includes(query)
    || city.normalizedCityAscii.includes(query)
    || city.normalizedCountry.includes(query)
    || city.normalizedCountryAscii.includes(query);
  return contains ? 2 : null;
}

function compareSearchFields(
  left: { city: CitySearchEntry; rank: number },
  right: { city: CitySearchEntry; rank: number },
): number {
  return left.rank - right.rank
    || comparePopulation(left.city.population, right.city.population)
    || compareStrings(left.city.normalizedCountry, right.city.normalizedCountry)
    || compareNullableStrings(left.city.admin_name, right.city.admin_name)
    || compareStrings(left.city.normalizedCity, right.city.normalizedCity);
}

export function selectCitySearchCandidates(
  catalogue: CityCatalogue,
  query: string,
  country?: string,
): CitySearchEntry[] {
  const normalized = query.trim().toLocaleLowerCase();
  const normalizedCountry = country?.trim().toLocaleLowerCase();
  const matches = catalogue.cities.flatMap((city) => {
    if (city.retired || (normalizedCountry && city.iso2.toLocaleLowerCase() !== normalizedCountry)) return [];
    const rank = matchRank(city, normalized);
    return rank === null ? [] : [{ city, rank }];
  }).sort(compareSearchFields);
  const boundary = matches[RESULT_LIMIT - 1];
  const candidates = boundary
    ? matches.filter((item, index) => index < RESULT_LIMIT || compareSearchFields(item, boundary) === 0)
    : matches;
  return candidates.map(({ city }) => city);
}

export function compareResolvedCityCandidates(
  left: CitySearchEntry,
  right: CitySearchEntry,
  query: string,
  cityIds: ReadonlyMap<string, string>,
): number {
  const normalized = query.trim().toLocaleLowerCase();
  const bySearchFields = compareSearchFields(
    { city: left, rank: matchRank(left, normalized) ?? 3 },
    { city: right, rank: matchRank(right, normalized) ?? 3 },
  );
  return bySearchFields || compareStrings(cityIds.get(left.source_id)!, cityIds.get(right.source_id)!);
}
