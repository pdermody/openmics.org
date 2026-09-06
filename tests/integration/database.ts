import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';

const execFileAsync = promisify(execFile);

export type TestDatabase = {
  container: StartedPostgreSqlContainer;
  pool: Pool;
};

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgis/postgis:16-3.4')
    .withDatabase('openmic_test')
    .withUsername('openmic')
    .withPassword('openmic_test')
    .start();

  const databaseUrl = container.getConnectionUri();
  const migrationCli = 'node_modules/node-pg-migrate/bin/node-pg-migrate.js';

  await execFileAsync(process.execPath, [migrationCli, 'up', '-m', 'apps/api/migrations'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  return { container, pool: new Pool({ connectionString: databaseUrl }) };
}

export async function stopTestDatabase(database: TestDatabase): Promise<void> {
  await database.pool.end();
  await database.container.stop();
}