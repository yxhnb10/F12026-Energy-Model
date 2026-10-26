import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,relative} from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
const allowed=new Set([
  '.gitignore','package.json','LICENSE','README.md','CONTRIBUTING.md','THIRD_PARTY_NOTICES.md','PROVENANCE.json',
  'docs/MODEL_CARD.md','examples/race.mjs','examples/synthetic-race.mjs','test/model.test.mjs','scripts/release-check.mjs',
  'src/index.mjs','src/energy-ensemble.mjs','src/energy-balance.mjs','src/energy-calibration.mjs','src/energy-planner.mjs',
  'src/practice-fit.mjs','src/power-domains.mjs','src/event-filter.mjs','src/lap-trace.mjs'
]);
const files=[];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){assert(!e.isSymbolicLink(),'No symbolic links allowed');const p=resolve(dir,e.name);if(e.isDirectory())await walk(p);else files.push(relative(root,p).replaceAll('\\','/'));}}
await walk(root);
assert.deepEqual(new Set(files),allowed,'Unexpected/missing release file; do not include datasets, credentials or site history');
const manifest=JSON.parse(await readFile(resolve(root,'PROVENANCE.json'),'utf8'));
assert.deepEqual(new Set(Object.keys(manifest.files)),new Set(files.filter(x=>x!=='PROVENANCE.json')));
for(const name of files){
 const data=await readFile(resolve(root,name)),text=data.toString('utf8');
 if(name!=='PROVENANCE.json')assert.equal(createHash('sha256').update(data).digest('hex'),manifest.files[name],'Changed release file: '+name);
 assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}|\bAKIA[A-Z0-9]{16}\b/.test(text),'Credential pattern: '+name);
 if(name.startsWith('src/')){
   assert(!/\b(?:fetch|XMLHttpRequest|WebSocket|eval)\s*\(|\bimport\s*\(/.test(text),'Unexpected executable network/dynamic code: '+name);
   for(const [,specifier] of text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g))assert(specifier.startsWith('./')&&allowed.has('src/'+specifier.slice(2)),'External dependency: '+specifier);
 }
}
const pkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
assert.equal(pkg.license,'MIT');assert(!pkg.dependencies&&!pkg.devDependencies);
console.log('PASS: '+files.length+' allowlisted files; matching digests; local-only source imports; no detected credential patterns. This is not a legal or complete secret audit.');
