import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const markdownFiles = (await readdir('docs'))
  .filter((file) => file.endsWith('.md'))
  .map((file) => path.join('docs', file))
  .sort();

const command = process.platform === 'win32'
  ? path.join('node_modules', '.bin', 'markdown-link-check.cmd')
  : path.join('node_modules', '.bin', 'markdown-link-check');

let failed = false;

for (const file of markdownFiles) {
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