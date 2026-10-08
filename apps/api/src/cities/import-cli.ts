import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { loadCityCatalogue } from './catalogue.js';
import { importCityCatalogue, previewCityCatalogueImport } from './importer.js';

const dryRun = process.argv.includes('--dry-run');
const unsupportedArguments = process.argv.slice(2).filter((argument) => argument !== '--dry-run');
if (unsupportedArguments.length) {
  throw new Error(`Unsupported city import argument(s): ${unsupportedArguments.join(', ')}`);
}

const catalogue = await loadCityCatalogue();
const pool = createPool(loadConfig());

try {
  if (dryRun) {
    const preview = await previewCityCatalogueImport(pool, catalogue);
    console.log(
      `Validated ${preview.parsed} JSON cities; ${preview.toInsert} to insert, ${preview.toUpdate} to update, ${preview.missingSourceIds.length} managed source identities would be removed.`,
    );
    if (preview.unexpectedSources.length) {
      console.log(`Preserving unmanaged city rows: ${preview.unexpectedSources.map(({ source, count }) => `${source}=${count}`).join(', ')}`);
    }
    if (preview.missingSourceIds.length) {
      throw new Error(
        `Import is blocked: retire rather than remove existing source identities. Missing IDs: ${preview.missingSourceIds.slice(0, 10).join(', ')}`,
      );
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
