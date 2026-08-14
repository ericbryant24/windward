import {PNG} from 'pngjs'; import {readFile,writeFile} from 'node:fs/promises';
const [,,src,dst,x0,y0,w,h,scale=4]=process.argv;
const p=PNG.sync.read(await readFile(src));
const S=Number(scale), W=Number(w)*S, H=Number(h)*S;
const o=new PNG({width:W,height:H});
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const sx=Number(x0)+Math.floor(x/S), sy=Number(y0)+Math.floor(y/S);
  const si=(sy*p.width+sx)*4, di=(y*W+x)*4;
  for(let k=0;k<4;k++)o.data[di+k]=p.data[si+k];
}
await writeFile(dst,PNG.sync.write(o));
