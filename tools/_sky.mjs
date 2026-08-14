import { Sky, skyRadianceAt } from '../src/sky.js';
const sky = new Sky(null);
const mk=(y,h)=>{const l=Math.hypot(h[0],h[1])||1;const r=Math.sqrt(Math.max(0,1-y*y));return [h[0]/l*r,y,h[1]/l*r];};
for (const t of ['afternoon','golden','midday']) {
  sky.setTime(t);
  const s = sky.sunDir;
  console.log(`--- ${t}  sunY=${s.y.toFixed(3)}`);
  console.log('   sunRadiance', sky.sunRadiance().toArray().map(v=>v.toFixed(2)).join(', '));
  console.log('   ambient    ', sky.skyAmbient().toArray().map(v=>v.toFixed(2)).join(', '));
  const probes = {
    zenith:[0,1,0],
    at_sun:[s.x,s.y,s.z],
    horizon_sunward: mk(0.02,[s.x,s.z]),
    up30_sunward: mk(0.5,[s.x,s.z]),
    horizon_anti: mk(0.02,[-s.x,-s.z]),
    up60_anti: mk(0.87,[-s.x,-s.z]),
  };
  for (const [k,d] of Object.entries(probes))
    console.log('   '+k.padEnd(18), skyRadianceAt(sky,d).map(v=>v.toFixed(2)).join(', '));
}
