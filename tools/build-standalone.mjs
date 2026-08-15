/**
 * Packs the game into one self-contained HTML file: bundled JavaScript,
 * inlined CSS, and one region's data baked in as base64. Nothing is fetched at
 * runtime, so the result runs anywhere a file can be opened — including hosts
 * that block outbound requests.
 *
 * One region per file, deliberately. Both together is eleven megabytes before
 * the reader has decided which map they want, and the hosted build already
 * offers the switch.
 *
 *   node tools/build-standalone.mjs [jungfrau|chicago] [out.html]
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { regionFromArgv, paths } from './regions.mjs';

const R = regionFromArgv();
const OUT = paths(R);
const out = process.argv.find((a) => a.endsWith('.html')) ?? `dist/windward-${R.id}.html`;

const bundle = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2022'],
  legalComments: 'none',
  write: false,
});
const js = bundle.outputFiles[0].text;

const css = await readFile('src/ui/style.css', 'utf8');
const meta = JSON.parse(await readFile(OUT.meta, 'utf8'));
const png = (await readFile(OUT.terrain)).toString('base64');
const buildings = (await readFile(OUT.buildings)).toString('base64');
const network = (await readFile(OUT.network)).toString('base64');
const vegetation = meta.vegetation ? (await readFile(OUT.vegetation)).toString('base64') : null;

// The artifact host wraps this in its own document skeleton, so emit page
// content only — no doctype, html, head or body tags.
const html = `<title>Windward — ${R.name}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<meta name="theme-color" content="#0b1622" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<style>
${css}
</style>
<canvas id="view"></canvas>
<div id="ui"></div>
<script>
window.WINDWARD_REGION = ${JSON.stringify(R.id)};
window.WINDWARD_EMBED = {
  meta: ${JSON.stringify(meta)},
  png: "${png}"${vegetation ? `,\n  vegetation: "${vegetation}"` : ''}
};
window.WINDWARD_BUILDINGS = "${buildings}";
window.WINDWARD_NETWORK = "${network}";
</script>
<script>
${js}
</script>
`;

await mkdir('dist', { recursive: true });
await writeFile(out, html);
const mb = (s) => (Buffer.byteLength(s) / 1048576).toFixed(2);
console.log(`wrote ${out} (${R.name})`);
console.log(`  script    ${mb(js)} MB`);
console.log(`  terrain   ${mb(png)} MB (base64)`);
if (vegetation) console.log(`  parks     ${mb(vegetation)} MB (base64)`);
console.log(`  buildings ${mb(buildings)} MB (base64)`);
console.log(`  network   ${mb(network)} MB (base64)`);
console.log(`  total     ${mb(html)} MB`);
