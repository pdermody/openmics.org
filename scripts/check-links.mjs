import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

async function findMarkdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return findMarkdownFiles(entryPath);
      return entry.name.endsWith('.md') ? [entryPath] : [];
    }),
  );
  return files.flat();
}

const markdownFiles = (await findMarkdownFiles('docs')).sort();

const command = process.platform === 'win32'
  ? path.join('node_modules', '.bin', 'markdown-link-check.cmd')
  : path.join('node_modules', '.bin', 'markdown-link-check');

let failed = false;

for (const file of markdownFiles) {
  const contents = await readFile(file, 'utf8');
  if (!/\[[^\]]+\]\([^\)]+\)/.test(contents)) continue;

  const result = await new Promise((resolve) => {
    const child = spawn(command, [file], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('close', (code) => resolve(code ?? 1));
  });

  if (result !== 0) failed = true;
}

process.exitCode = failed ? 1 : 0;