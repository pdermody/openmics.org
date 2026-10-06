import { validatePackagedCityCatalogue } from '../apps/api/src/cities/catalogue.js';

const result = await validatePackagedCityCatalogue();
console.log(`Validated ${result.cities} city catalogue entries.`);
