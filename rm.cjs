const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[2],"utf8").replace(/^﻿/,""));const entries=(s.recentSnapshot&&s.recentSnapshot.entries)||[];const out=[];for(const e of entries){const u=e.resource||"";if(u.indexOf("openmic")<0)continue;const p=decodeURIComponent(u).replace("file:///c:/Users/pderm/dev/openmic/","");const h=e.currentHash||e.originalHash;const blob=process.argv[3]+"/contents/"+h;const exists=fs.existsSync(blob);const size=exists?fs.statSync(blob).size:0;out.push(p+"	"+h+"	"+(exists?size:"NO-BLOB"));}
fs.writeFileSync("recent-map.tsv",out.join("
"));
