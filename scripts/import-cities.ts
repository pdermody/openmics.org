import { loadConfig } from '../apps/api/src/config.js';
import { createPool } from '../apps/api/src/db.js';
import { loadCityCatalogue } from '../apps/api/src/cities/catalogue.js';
import { importCityCatalogue, previewCityCatalogueImport } from '../apps/api/src/cities/importer.js';

if (process.argv.includes('--file')) {
  throw new Error('City import reads the packaged JSON catalogue; --file is no longer supported.');
}
const unsupportedArguments = process.argv.slice(2).filter((argument) => argument !== '--dry-run');
if (unsupportedArguments.length) throw new Error(`Unsupported city import argument(s): ${unsupportedArguments.join(', ')}`);

const catalogue = await loadCityCatalogue();
const pool = createPool(loadConfig());
try {
  if (process.argv.includes('--dry-run')) {
    const result = await previewCityCatalogueImport(pool, catalogue);
    console.log(
      `Validated ${result.parsed} JSON cities; ${result.toInsert} to insert, ${result.toUpdate} to update, ${result.missingSourceIds.length} managed source identities would be removed.`,
    );
    if (result.missingSourceIds.length) {
      console.error(
        `Import is blocked: retire rather than remove existing source identities. Missing IDs: ${result.missingSourceIds.slice(0, 10).join(', ')}`,
      );
      process.exitCode = 1;
    }
    if (result.unexpectedSources.length) {
      console.log(`Preserving unmanaged city rows: ${result.unexpectedSources.map(({ source, count }) => `${source}=${count}`).join(', ')}`);
    }
  } else {
    const result = await importCityCatalogue(pool, catalogue);
    console.log(
      `Synchronized ${result.parsed} JSON cities: ${result.inserted} inserted, ${result.updated} updated; linked ${result.linked} unambiguous legacy references.`,
    );
    if (result.unexpectedSources.length) {
      console.log(`Preserved unmanaged city rows: ${result.unexpectedSources.map(({ source, count }) => `${source}=${count}`).join(', ')}`);
    }
  }
} finally {
  await pool.end();
}
