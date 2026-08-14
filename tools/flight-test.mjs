import * as THREE from '../vendor/three.module.js';
import { Air, Glider } from '../src/flight.js';
const hf = { halfSize:19000, minHeight:500, maxHeight:4200, heightAt:()=>500,
  normalAt:(x,z,s,out=new THREE.Vector3())=>out.set(0,1,0), isWater:()=>false };
const air = new Air(hf, { sunDir:new THREE.Vector3(0,1,0) });
air.thermals=[]; air.windSpeed=0;
const g = new Glider(air); const dt=1/120;
function sim(input, seconds){ for(let i=0;i<seconds/dt;i++) g.update(dt,{roll:0,pitch:0,brake:0,boost:false,...input}); }
function show(l){ console.log(l.padEnd(30),'V',g.airspeed.toFixed(1).padStart(5),'bank',g.bankDeg.toFixed(0).padStart(4),
  'hdg',g.headingDeg.toFixed(0).padStart(3),'alt',g.position.y.toFixed(0).padStart(5),'g',g.loadFactor.toFixed(2)); }

g.reset(new THREE.Vector3(0,3000,0),0,34); sim({},6); show('trimmed, heading 0');
sim({roll:1},2); show('full right stick, 2 s');
sim({roll:1},8); show('...held 8 s more');
sim({},4); show('stick released 4 s');
g.reset(new THREE.Vector3(0,3000,0),0,34); sim({},4);
sim({roll:-1},10); show('full LEFT stick 10 s');
g.reset(new THREE.Vector3(0,3000,0),90,45); sim({},3);
sim({roll:0.55,pitch:0.25},14); show('coordinated turn 14 s');
// 360 turn timing at full bank
g.reset(new THREE.Vector3(0,3000,0),0,40); sim({},3);
let t=0; const h0=g.headingDeg; let turned=0, prev=h0;
while(t<90){ sim({roll:1,pitch:0.3},dt); t+=dt; let d=g.headingDeg-prev; if(d>180)d-=360; if(d<-180)d+=360; turned+=d; prev=g.headingDeg; if(turned>=360)break; }
console.log('360 deg turn:', t.toFixed(1)+'s', 'radius ~', (g.airspeed*t/(2*Math.PI)).toFixed(0)+'m', 'alt lost', (3000-g.position.y).toFixed(0)+'m');
