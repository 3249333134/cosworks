import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require=createRequire(resolve('apps/server/package.json'));
// Bundle from the canonical sources. sharp is installed for the target Linux runtime.
const esbuild=require('esbuild');
await esbuild.build({entryPoints:['apps/server/src/index.ts'],bundle:true,platform:'node',format:'esm',target:'node22',outfile:'apps/server/release/index.js',external:['sharp'],banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"}});
mkdirSync('apps/server/release',{recursive:true});
writeFileSync('apps/server/release/package.json',JSON.stringify({name:'ruxiju-server-release',private:true,type:'module',dependencies:{sharp:'0.35.4'}},null,2)+'\n');
console.log('Release built from apps/server/src into apps/server/release');
