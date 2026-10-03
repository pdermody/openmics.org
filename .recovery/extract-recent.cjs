const fs = require('fs');
const statePath = process.argv[2];
const sessDir = process.argv[3];
const s = JSON.parse(fs.readFileSync(statePath, 'utf8').replace(/^﻿/, ''));
const entries = (s.recentSnapshot && s.recentSnapshot.entries) || [];
const lines = [];
for (const e of entries) {
  const u = e.resource || '';
  if (u.indexOf('openmic') < 0) continue;
  const p = decodeURIComponent(u).replace('file:///c:/Users/pderm/dev/openmic/', '');
  const h = e.currentHash || e.originalHash;
  const blob = sessDir + '/contents/' + h;
  const exists = fs.existsSync(blob);
  const size = exists ? fs.statSync(blob).size : 0;
  lines.push(p + '\t' + h + '\t' + (exists ? size : 'NO-BLOB'));
}
fs.writeFileSync('.recovery/recent-map.tsv', lines.join('\n'));
