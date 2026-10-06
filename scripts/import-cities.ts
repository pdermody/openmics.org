import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadConfig } from '../apps/api/src/config.js';
import { createPool } from '../apps/api/src/db.js';
import { importCityCsv, parseCityCsv } from '../apps/api/src/cities/importer.js';

const fileIndex = process.argv.indexOf('--file');
if (fileIndex < 0 || !process.argv[fileIndex + 1]) {
  throw new Error('Usage: npm run db:import:cities -- --file <worldcities.csv> [--dry-run]');
}

const file = resolve(process.argv[fileIndex + 1]);
const contents = await readFile(file, 'utf8');
if (process.argv.includes('--dry-run')) {
  const parsed = parseCityCsv(contents);
  console.log(`Validated ${parsed.rows.length} unique cities (${parsed.duplicates} duplicate rows); no database changes made.`);
} else {
  const pool = createPool(loadConfig());
  try {
    const result = await importCityCsv(pool, contents);
    console.log(`Imported ${result.parsed} cities: ${result.inserted} inserted, ${result.updated} updated, ${result.duplicates} duplicate rows ignored; linked ${result.linked} unambiguous legacy references.`);
  } finally {
    await pool.end();
  }
}
