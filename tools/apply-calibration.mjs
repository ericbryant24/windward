/**
 * Writes the calibrator's own numbers back into src/regions.js, and deletes the
 * proposals it could not fly.
 *
 * With eighty-odd challenges in the table, reading a calibration report and
 * hand-editing ladders is not work a person should be doing — it is exactly the
 * kind of transcription that put a gate in a cliff and a corridor through a
 * skyscraper. So the tool that measures hands off to a tool that applies.
 *
 * It only ever touches a challenge carrying `calibrate: true`. Every ladder that
 * was measured and argued over by hand stays exactly as it is; a proposal either
 * gets the measured ladder and loses the flag, or gets removed from the table.
 *
 *   node tools/calibrate-challenges.mjs --json > cal.json
 *   node tools/apply-calibration.mjs cal.json
 *   node tools/apply-calibration.mjs cal.json --dry
 */
import { readFile, writeFile } from 'node:fs/promises';

const file = process.argv[2];
const DRY = process.argv.includes('--dry');
if (!file) throw new Error('usage: apply-calibration.mjs <cal.json> [--dry]');

const { proposals, problems } = JSON.parse(await readFile(file, 'utf8'));
const src = new URL('../src/regions.js', import.meta.url);
let text = await readFile(src, 'utf8');

/**
 * Which ids are actually beyond saving, as opposed to merely mis-laddered.
 *
 * Most complaints about a fresh proposal are the placeholder ladder being wrong,
 * which is the whole reason it is a placeholder — "gold is unreachable" against
 * a made-up gold says nothing about the course. What cannot be fixed by writing
 * the measured numbers in is a course nobody finished, one with too narrow a
 * spread to hang three rungs off, or a timed one whose bronze will not fit under
 * its cap however the ladder is squeezed.
 */
const FATAL = [/not one of \d+ lines finished/, /too little to hang three rungs/, /NOT COMPLETABLE/];
const broken = new Set();
for (const p of problems ?? []) {
  if (!FATAL.some((re) => re.test(String(p)))) continue;
  const id = String(p).split(':')[0].trim();
  if (id) broken.add(id);
}

/** The source span of one challenge object, found by its id line. */
function spanOf(id) {
  const needle = `      id: '${id}',`;
  const at = text.indexOf(needle);
  if (at < 0) return null;
  const open = text.lastIndexOf('\n    {', at);
  const close = text.indexOf('\n    },', at);
  if (open < 0 || close < 0) return null;
  return { from: open + 1, to: close + '\n    },'.length };
}

const kept = [];
const dropped = [];
const skipped = [];

for (const [id, prop] of Object.entries(proposals ?? {})) {
  const span = spanOf(id);
  if (!span) continue;
  let block = text.slice(span.from, span.to);
  // Hand-authored ladders are not this tool's business.
  if (!/calibrate:\s*true/.test(block)) {
    skipped.push(id);
    continue;
  }
  if (broken.has(id)) {
    dropped.push(id);
    text = text.slice(0, span.from) + text.slice(span.to + 1);
    continue;
  }
  // A timed course the ladder cannot be squeezed into is a course with a gate
  // too many, and the tool says so rather than the applier inventing a limit.
  if (prop?.tooLong) {
    dropped.push(`${id} (too long for its cap)`);
    text = text.slice(0, span.from) + text.slice(span.to + 1);
    continue;
  }
  if (!prop || !Array.isArray(prop.medals) || prop.medals.some((m) => !isFinite(m))) {
    dropped.push(id);
    text = text.slice(0, span.from) + text.slice(span.to + 1);
    continue;
  }
  const medals = prop.medals.map((m) => Math.round(m));
  block = block.replace(/      medals: \[[^\]]*\],/, `      medals: [${medals.join(', ')}],`);
  // A timed course's fail limit is measured too, and a bronze that lands past it
  // makes finishing and bronzing the same event.
  if (prop.limit != null && /      limit: \d+,/.test(block)) {
    block = block.replace(/      limit: \d+,/, `      limit: ${Math.round(prop.limit)},`);
  }
  block = block.replace(/\n      calibrate: true,/, '');
  text = text.slice(0, span.from) + block + text.slice(span.to);
  kept.push(id);
}

// Anything still flagged was never reached by the report at all — a challenge
// the calibrator skipped is a challenge nobody measured, so it does not ship.
for (const m of [...text.matchAll(/      id: '([^']+)',/g)]) {
  const id = m[1];
  const span = spanOf(id);
  if (!span) continue;
  if (!/calibrate:\s*true/.test(text.slice(span.from, span.to))) continue;
  dropped.push(`${id} (never measured)`);
  text = text.slice(0, span.from) + text.slice(span.to + 1);
}

console.log(`kept ${kept.length}, dropped ${dropped.length}, left alone ${skipped.length}`);
if (dropped.length) console.log(`dropped: ${dropped.join(', ')}`);
if (!DRY) await writeFile(src, text);
else console.log('(dry run — nothing written)');
