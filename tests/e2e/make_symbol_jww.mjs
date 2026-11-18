// ローカルでの読み込み試験用。JWWの全図形はブロックなしの線分として書く。
import { readFileSync, writeFileSync } from 'node:fs';
import { jww } from '../../js/cad.js';
const D = JSON.parse(readFileSync(new URL('../../js/reader2/symbol_dictionary.json', import.meta.url)));
const rect = (x,y,w,h) => [[x,y,x+w,y],[x+w,y,x+w,y+h],[x+w,y+h,x,y+h],[x,y+h,x,y]];
const shell = rect(0,0,16,13);
const lockers = [...rect(3,11,1.2,.45),[3.4,11,3.4,11.45],[3.8,11,3.8,11.45]];
const scale = (e,x,y,angle=0,factor=1) => {
  const s=factor*Math.max(e.features.width_mm,e.features.depth_mm)/1000, c=Math.cos(angle), t=Math.sin(angle);
  const p=(a,b)=>[x+s*(a*c-b*t),y+s*(a*t+b*c)];
  return e.segments.map(([a,b,u,v])=>[...p(a,b),...p(u,v)]);
};
const symbols = D.symbols.filter(x=>x.entry_type==='observed').flatMap((e,i)=>
  scale(e,2+i%5*3,2+Math.floor(i/5)*3,i%2 ? .38 : 0,i%3===0 ? .92 : 1.06));
// --include-unknown で線の欠けた机を加え、3種類の表示を同じ図面で確認する。
const weak = process.argv.includes('--include-unknown') ?
  scale(D.symbols.find(x=>x.id==='desk_straight'),10.6,11).filter((_,j)=>j%3!==1) : [];
writeFileSync(process.argv[2],jww({lines:[...shell,...symbols,...lockers,...weak,...rect(13,10,.48,.5)],
  texts:[{s:'事務室',x:6,y:10.5,h:2.5,layer:2}]},50));
