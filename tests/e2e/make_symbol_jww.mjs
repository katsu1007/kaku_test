// ローカルでの読み込み試験用。JWWの全図形はブロックなしの線分として書く。
import { readFileSync, writeFileSync } from 'node:fs';
import { jww } from '../../js/cad.js';
const D = JSON.parse(readFileSync(new URL('../../js/reader2/symbol_dictionary.json', import.meta.url)));
const shell = [[0,0,12,0],[12,0,12,6],[12,6,0,6],[0,6,0,0]];
const lockers = [[8,4,9.2,4],[9.2,4,9.2,4.45],[9.2,4.45,8,4.45],[8,4.45,8,4],[8.4,4,8.4,4.45],[8.8,4,8.8,4.45]];
const scale = (e,x,y) => {
  const s=Math.max(e.features.width_mm,e.features.depth_mm)/1000;
  return e.segments.map(([a,b,u,v])=>[x+a*s,y+b*s,x+u*s,y+v*s]);
};
const symbols = D.symbols.filter(x=>x.entry_type==='observed').flatMap((e,i)=>scale(e,1.25+i*1.35,1.6+i%2));
// --include-unknown で線の欠けた机を加え、3種類の表示を同じ図面で確認する。
const weak = process.argv.includes('--include-unknown') ?
  scale(D.symbols.find(x=>x.id==='desk_straight'),10.6,4.8).filter((_,j)=>j%3!==1) : [];
writeFileSync(process.argv[2],jww({lines:[...shell,...symbols,...lockers,...weak],texts:[{s:'事務室',x:6,y:3.5,h:2.5,layer:2}]},50));
