/**
 * Packs the whole game into one self-contained HTML file: bundled JavaScript,
 * inlined CSS, and the terrain baked in as base64. Nothing is fetched at
 * runtime, so the result runs anywhere a file can be opened — including hosts
 * that block outbound requests.
 *
 *   node tools/build-standalone.mjs [out.html]
 */
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

const out = process.argv[2] || 'dist/windward.html';

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
const meta = JSON.parse(await readFile('data/jungfrau.json', 'utf8'));
const png = (await readFile('data/jungfrau.png')).toString('base64');
const buildings = (await readFile('data/buildings.bin.gz')).toString('base64');
const network = (await readFile('data/network.bin.gz')).toString('base64');

// The artifact host wraps this in its own document skeleton, so emit page
// content only — no doctype, html, head or body tags.
const html = `<title>Windward</title>
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
window.WINDWARD_EMBED = {
  meta: ${JSON.stringify(meta)},
  png: "${png}"
};
window.WINDWARD_BUILDINGS = "${buildings}";
window.WINDWARD_NETWORK = "${network}";
</script>
<script>
${js}
</script>
`;

await writeFile(out, html);
const mb = (s) => (Buffer.byteLength(s) / 1048576).toFixed(2);
console.log(`wrote ${out}`);
console.log(`  script  ${mb(js)} MB`);
console.log(`  terrain ${mb(png)} MB (base64)`);
console.log(`  buildings ${mb(buildings)} MB (base64)`);
console.log(`  network ${mb(network)} MB (base64)`);
console.log(`  total   ${mb(html)} MB`);
