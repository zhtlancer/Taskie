// Copies hanzi-writer-data's stroke files into the build so stroke animations work without
// reaching a CDN; the app loads /hanzi-data/<字>.json on demand. The data is distributed under the
// Arphic Public License, which travels with it.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const source = dirname(createRequire(import.meta.url).resolve('hanzi-writer-data/package.json'));
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'hanzi-data');
mkdirSync(target, { recursive: true });
let count = 0;
for (const name of readdirSync(source)) {
  if (/^\p{Script=Han}\.json$/u.test(name)) {
    cpSync(join(source, name), join(target, name));
    count++;
  }
}
cpSync(join(source, 'ARPHICPL.TXT'), join(target, 'ARPHICPL.TXT'));
console.log(`hanzi-data: copied ${count} characters`);
