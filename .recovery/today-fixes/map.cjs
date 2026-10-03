const fs=require('fs');
const s=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^﻿/,''));
const pairs=s.initialFileContents||[];
const out=pairs
  .filter(([u])=>u.startsWith('file:///c%3A/Users/pderm/dev/openmic/'))
  .map(([u,h])=>{
    const p=decodeURIComponent(u.replace('file:///c%3A/Users/pderm/dev/openmic/',''));
    return p+'\t'+h;
  });
fs.writeFileSync('restore-map.tsv', out.join('\n'));
console.log('mapped files:', out.length);
