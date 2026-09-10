// Milestone 0, item 5 (IMPLEMENTATION-PLAN.md): reports which openapi.yaml operations have at least one
// matching apps/api/tests/**/*.ts Fastify `inject({ method, url })` call. This is a structural heuristic,
// not a substitute for actually running the suites — it only proves a test *calls* the shape of a route,
// not that it asserts anything meaningful about the response.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';

const HTTP_METHODS = ['get', 'post', 'patch', 'put', 'delete'];

function listTestFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...listTestFiles(full));
    else if (entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

function toSegments(pathTemplate) {
  // Normalize both OpenAPI `{param}` templates and test-file `${expr}` interpolations to a single `:param`
  // marker, strip a leading /api (tests call the mounted API, the contract paths are already relative to it).
  const withoutApi = pathTemplate.replace(/^\/api\b/, '');
  const normalized = withoutApi
    .replace(/\{[^}]+\}/g, ':param')
    .replace(/\$\{[^}]+\}/g, ':param');
  return normalized.split('/').filter(Boolean);
}

function segmentsMatch(a, b) {
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg === b[i] || seg === ':param' || b[i] === ':param');
}

const document = await SwaggerParser.validate('openapi.yaml');

const operations = [];
for (const [pathTemplate, pathItem] of Object.entries(document.paths ?? {})) {
  for (const method of HTTP_METHODS) {
    const op = pathItem[method];
    if (!op) continue;
    operations.push({
      operationId: op.operationId ?? `${method.toUpperCase()} ${pathTemplate}`,
      method,
      pathTemplate,
      segments: toSegments(pathTemplate),
      tags: op.tags ?? [],
    });
  }
}

const testFiles = listTestFiles('apps/api/tests');
const injectCallPattern =
  /(?:method:\s*['"](get|post|patch|put|delete)['"][\s\S]{0,120}?url:\s*[`'"]([^`'"]*)[`'"]|url:\s*[`'"]([^`'"]*)[`'"][\s\S]{0,120}?method:\s*['"](get|post|patch|put|delete)['"])/gi;

const testCalls = [];
for (const file of testFiles) {
  const content = readFileSync(file, 'utf8');
  for (const match of content.matchAll(injectCallPattern)) {
    const method = (match[1] ?? match[4]).toLowerCase();
    const url = match[2] ?? match[3];
    testCalls.push({ file, method, segments: toSegments(url) });
  }
}

let coveredCount = 0;
const rows = operations.map((op) => {
  const matches = testCalls.filter((call) => call.method === op.method && segmentsMatch(call.segments, op.segments));
  const uniqueFiles = [...new Set(matches.map((m) => m.file.replace(/\\/g, '/')))];
  if (uniqueFiles.length > 0) coveredCount += 1;
  return {
    operationId: op.operationId,
    method: op.method.toUpperCase(),
    path: op.pathTemplate,
    tested: uniqueFiles.length > 0 ? 'yes' : 'NO',
    files: uniqueFiles.join(', '),
  };
});

rows.sort((a, b) => (a.tested === b.tested ? a.path.localeCompare(b.path) : a.tested === 'NO' ? -1 : 1));

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('METHOD', 7), pad('PATH', 45), pad('TESTED', 7), 'OPERATION / TEST FILES');
console.log('-'.repeat(120));
for (const row of rows) {
  console.log(pad(row.method, 7), pad(row.path, 45), pad(row.tested, 7), `${row.operationId}${row.files ? ` — ${row.files}` : ''}`);
}
console.log('-'.repeat(120));
console.log(`${coveredCount}/${operations.length} operations have at least one matching test call.`);

if (process.argv.includes('--strict') && coveredCount < operations.length) {
  process.exitCode = 1;
}
