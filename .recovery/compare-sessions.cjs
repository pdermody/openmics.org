const fs = require('fs');
const path = require('path');

// For each target file, find its content in a session's recentSnapshot (latest state).
function latestContent(sessDir, targetPath) {
  const s = JSON.parse(fs.readFileSync(path.join(sessDir, 'state.json'), 'utf8').replace(/^﻿/, ''));
  const entries = (s.recentSnapshot && s.recentSnapshot.entries) || [];
  for (const e of entries) {
    const u = decodeURIComponent(e.resource || '');
    if (u.endsWith('/' + targetPath) || u.endsWith('/' + targetPath.replace(/\//g, '%2F'))) {
      const h = e.currentHash || e.originalHash;
      const blob = path.join(sessDir, 'contents', h);
      if (fs.existsSync(blob)) return fs.readFileSync(blob, 'utf8');
    }
  }
  return null;
}

const WS = process.argv[2];
const target = process.argv[3];
const sessions = [
  ['2026-10-02 19:19', '96727783-d79f-4067-8f55-9d00c5c72a97'],
  ['2026-10-02 21:19', 'b3b341a2-6f81-4d89-b462-264e3f1a9856'],
];
const out = [];
for (const [label, id] of sessions) {
  const c = latestContent(path.join(WS, 'chatEditingSessions', id), target);
  out.push(label + '  ' + (c === null ? 'NOT-PRESENT' : c.split('\n').length + ' lines'));
}
// current working tree
try {
  const cur = fs.readFileSync(target, 'utf8');
  out.push('CURRENT      ' + cur.split('\n').length + ' lines');
} catch { out.push('CURRENT      MISSING'); }
// HEAD
fs.writeFileSync('.recovery/session-compare.txt', out.join('\n'));
