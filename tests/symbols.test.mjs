import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { cadSymbolParts, recognizeSymbols, symbolStatus } from '../js/reader2/symbols.js';

const dictionary = JSON.parse(readFileSync(new URL('../js/reader2/symbol_dictionary.json', import.meta.url), 'utf8'));
const observed = dictionary.symbols.filter(x => x.entry_type === 'observed');
const symbol = (id, x, y, angle=0, mirror=false) => {
  const e = observed.find(q=>q.id===id), s = Math.max(e.features.width_mm,e.features.depth_mm)/1000;
  const c = Math.cos(angle), t = Math.sin(angle);
  const p = (a,b) => { if (mirror) a=-a; return [x+s*(a*c-b*t),y+s*(a*t+b*c)]; };
  return e.segments.map(([a,b,u,v]) => [...p(a,b),...p(u,v)]);
};
const rect = (x,y,w,h) => [[x,y,x+w,y],[x+w,y,x+w,y+h],[x+w,y+h,x,y+h],[x,y+h,x,y]];
const parts = (lines, layer='', group=null) => lines.map(s => ({kind:'line',layer,group,segs:[s]}));
const recognize = o => recognizeSymbols(o,dictionary).matches;

test('辞書に出典と実形状があり、汎用パターンとは区別する', () => {
  assert.equal(observed.length,7);
  for (const e of observed) {
    assert.equal(e.provenance.license,'CC0-1.0');
    assert.match(e.provenance.sha256,/^[a-f0-9]{64}$/);
    assert.ok(e.segments.length>4);
    assert.ok(e.features.width_mm>0);
  }
  assert.equal(dictionary.symbols.filter(x => x.entry_type==='generic_pattern' && !x.segments && x.provenance.kind==='original_heuristic').length,5);
});

test('展開された全CC0記号を、平行移動・90度回転・鏡像で拾う（ブロック名なし）', () => {
  for (const [i,e] of observed.entries()) {
    const result=recognize({parts:parts(symbol(e.id,2+i,4,Math.PI/2,true))});
    assert.equal(result.length,1,e.id);
    assert.equal(result[0].id,e.id);
    assert.equal(result[0].entry_type,'observed');
    assert.equal(result[0].status,'match');
    assert.ok(result[0].score>=95);
  }
});

test('任意角の展開図形、ブロックの混在、同じ記号の複数配置', () => {
  const lines = [
    ...parts(symbol('wc_tank',1,1,.36),'FIX',6),
    ...parts(symbol('wc_tank',2,2,.36),'FIX',7),
    ...parts(symbol('desk_corner',5,2,.36,true),'FF'),
    ...parts(rect(0,0,8,4),'WALL'),
  ];
  const r = recognize({parts:lines});
  assert.deepEqual(r.map(x=>x.id).sort(),['desk_corner','wc_tank','wc_tank']);
  assert.ok(r.some(x=>x.b[0]<1 && x.b[2]>1));
});

test('ロッカーの等間隔の仕切りを判定し、ただの長方形・区画・不規則な仕切りは除外', () => {
  const lockers=[...rect(0,0,1.2,.45),[.4,0,.4,.45],[.8,0,.8,.45]];
  const unbalanced=[...rect(6,0,1.2,.45),[6.25,0,6.25,.45],[6.85,0,6.85,.45]];
  const r=recognize({segs:[...lockers,...rect(2,0,1.2,.45),...rect(4,0,2.4,1.1),...unbalanced]});
  assert.equal(r.length,1);
  assert.equal(r[0].category,'locker');
  assert.equal(r[0].entry_type,'generic_pattern');
  assert.equal(r[0].status,'similar');
  assert.deepEqual(r[0].b,[0,0,1.2,.45]);
});

test('注記レイヤー・表題欄・設備表を除外', () => {
  const s=symbol('urinal_wall',2,3);
  for (const type of ['table','title']) assert.deepEqual(recognize({segs:s,regions:[{type,box:[1,2,3,4]}]}),[]);
  assert.deepEqual(recognize({parts:parts(s,'寸法')}),[]);
});

test('判定保留を不明として表示し、重複・表題欄・無関係な器具は除外', () => {
  const segs=symbol('urinal_wall',2,3);
  const fixture = b => ({t:'unknown',b});
  const match = recognize({segs})[0];
  const matches=recognize({segs, fixtures:[
    fixture(match.b), fixture([5,5,5.6,5.7]), fixture([5,5,5.6,5.7]),
    fixture([7,7,7.6,7.9]), fixture([8.1,7,8.13,7.8]), {t:'other',b:[9,9,9.6,9.8]},
  ],regions:[{type:'title',box:[6.8,6.8,8,8]}]});
  assert.deepEqual(matches.map(x=>[x.status,x.reason]),[['match',undefined],['unknown','reader']]);
  assert.deepEqual(matches[1].b,[5,5,5.6,5.7]);
});

test('辞書の種類が拮抗する記号に断定した分類を付けない', () => {
  const shape=observed.find(x=>x.id==='urinal_wall');
  const r=recognizeSymbols({segs:symbol(shape.id,2,3)}, {symbols:[
    shape,{...shape,id:'alternate',category:'basin',label:'洗面台候補'},
  ]}).matches;
  assert.equal(r.length,1);
  assert.equal(r[0].status,'unknown');
  assert.equal(r[0].reason,'ambiguous');
  assert.deepEqual(r[0].hints,[shape.label,'洗面台候補']);
});

test('すでに保存された記号にもスコアと辞書種別で色を付ける', () => {
  assert.equal(symbolStatus({entry_type:'observed',score:95}),'match');
  assert.equal(symbolStatus({entry_type:'observed',score:83}),'similar');
  assert.equal(symbolStatus({entry_type:'generic_pattern',score:80}),'similar');
  assert.equal(symbolStatus({entry_type:'unresolved',status:'unknown',score:99}),'unknown');
});

test('CADの曲線と親INSERTを拾い、元データは変更しない', () => {
  const ents=[{k:'circle',c:[150,150],r:100,ly:'0',o:{id:2,o:{id:1}}},
    {k:'line',a:[0,0],b:[500,0],ly:'0',dash:true},
    {k:'circle',ell:[[300,0],[310,20],[300,0]],ly:'0'}];
  const before=structuredClone(ents), p=cadSymbolParts(ents,0.001);
  assert.equal(p.length,2);
  assert.deepEqual(p[0].groups,[2,1]);
  assert.equal(p[0].segs[0][0],.25);
  assert.equal(p[1].kind,'ellipse');
  assert.deepEqual(ents,before);
});
