import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'apps/api/src/cities/world-cities.json');
const destination = resolve(root, 'dist/apps/api/src/cities/world-cities.json');

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
