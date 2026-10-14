import { readFile, mkdir, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
export async function bundle() {
  const core = (await readFile(new URL('src/core.js', root), 'utf8')).replaceAll('export ', '');
  const renderer = (await readFile(new URL('src/renderer.js', root), 'utf8')).replace(/^import .*;\n/m, '').replaceAll('export ', '');
  return `(()=>{\n${core}\n${renderer}\ninstallTokenSpeed();\n})();`;
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  await mkdir(new URL('dist/', root), { recursive:true });
  await writeFile(new URL('dist/inject.js', root), await bundle());
}
