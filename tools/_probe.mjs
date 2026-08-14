import {PNG} from 'pngjs'; import {readFile} from 'node:fs/promises';
const meta=JSON.parse(await readFile('data/jungfrau.json','utf8'));
const png=PNG.sync.read(await readFile('data/jungfrau.png'));
const N=meta.size, step=meta.step, half=meta.halfSize;
const h=(x,z)=>{const fx=Math.min(N-1.001,Math.max(0,(x+half)/step)),fz=Math.min(N-1.001,Math.max(0,(z+half)/step));
 const i=fx|0,j=fz|0,dx=fx-i,dz=fz-j; const g=(a,b)=>{const q=(b*N+a)*4;return (png.data[q]*256+png.data[q+1])/2-512;};
 return (g(i,j)*(1-dx)+g(i+1,j)*dx)*(1-dz)+(g(i,j+1)*(1-dx)+g(i+1,j+1)*dx)*dz;};
const P={Jungfrau:[46.5367,7.9625,4158],Eiger:[46.5775,8.0053,3967],'Mönch':[46.5586,7.9961,4107],
 Schilthorn:[46.5556,7.8347,2970],Interlaken:[46.686,7.863,567],Grindelwald:[46.6242,8.0413,1034],
 Lauterbrunnen:[46.5936,7.9088,796],'Kleine Scheidegg':[46.5853,7.9614,2061],'Wetterhorn':[46.6403,8.1128,3692],
 'Männlichen':[46.6142,7.9394,2343],'Thunersee':[46.6805,7.7365,558]};
for(const[k,[lat,lon,real]]of Object.entries(P)){
  const x=(lon-meta.centerLon)*111320*Math.cos(meta.centerLat*Math.PI/180), z=(meta.centerLat-lat)*111320;
  console.log(k.padEnd(18), 'x='+x.toFixed(0).padStart(7), 'z='+z.toFixed(0).padStart(7), 'dem='+h(x,z).toFixed(0).padStart(5), 'real='+real);
}
