// ローカルでの読み込み試験用。JWWの全図形はブロックなしの線分として書く。
import { readFileSync, writeFileSync } from 'node:fs';
import { jww } from '../../js/cad.js';
const D = JSON.parse(readFileSync(new URL('../../js/reader2/symbol_dictionary.json', import.meta.url)));
const rect = (x,y,w,h) => [[x,y,x+w,y],[x+w,y,x+w,y+h],[x+w,y+h,x,y+h],[x,y+h,x,y]];
const shell = rect(0,0,19,17);
const lockers = [...rect(3,15,1.2,.45),[3.4,15,3.4,15.45],[3.8,15,3.8,15.45]];
const scale = (e,x,y,angle=0,factor=1) => {
  const s=factor*Math.max(e.features.width_mm,e.features.depth_mm)/1000, c=Math.cos(angle), t=Math.sin(angle);
  const p=(a,b)=>[x+s*(a*c-b*t),y+s*(a*t+b*c)];
  return e.segments.map(([a,b,u,v])=>[...p(a,b),...p(u,v)]);
};
const symbols = D.symbols.filter(x=>x.entry_type==='observed').flatMap((e,i)=>
  scale(e,2+i%5*3.6,2+Math.floor(i/5)*3.5,i%2 ? .38 : 0,i%3===0 ? .92 : 1.06));
const circle = (x,y,r,n=32) => Array.from({length:n},(_,i)=>{
  const p=j=>[x+r*Math.cos(j*2*Math.PI/n),y+r*Math.sin(j*2*Math.PI/n)];
  return [...p(i),...p(i+1)];
});
const stool = (x, angles, inner=.12) => [...circle(x,15,.21),...angles.map(a=>{
  const p=r=>[x+r*Math.cos(a),15+r*Math.sin(a)];
  return [...p(inner),...p(.21)];
})];
const stools = [
  ...stool(7,[.23,.23+2*Math.PI/3,.23+4*Math.PI/3]),
  ...stool(8.5,[-.31]),
  ...stool(12,[.31,.31+Math.PI/2]),
  ...stool(16,[]),
  ...stool(17.5,[.31],0),
];
// --include-unknown で線の欠けた机を加え、3種類の表示を同じ図面で確認する。
const weak = process.argv.includes('--include-unknown') ?
  scale(D.symbols.find(x=>x.id==='desk_straight'),10.6,15).filter((_,j)=>j%3!==1) : [];
writeFileSync(process.argv[2],jww({lines:[...shell,...symbols,...lockers,...weak,...stools,...rect(14,15,.48,.5)],
  texts:[{s:'事務室',x:6,y:16,h:2.5,layer:2}]},50));
