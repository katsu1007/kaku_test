import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { cadSymbolParts, recognizeSymbols, symbolStatus, drawingSymbolMatches } from '../js/reader2/symbols.js';

const dictionary = JSON.parse(readFileSync(new URL('../js/reader2/symbol_dictionary.json', import.meta.url), 'utf8'));
const observed = dictionary.symbols.filter(x => x.entry_type === 'observed');
const newFurniture = ['desk_bench','desk_bench_set','desk_meeting_set','chair_task','chair_arm','chair_recliner'];
const newSeats = ['chair_sofa_two','chair_sofa_three','chair_sofa_sectional','chair_high','chair_ottoman'];
const symbol = (id, x, y, angle=0, mirror=false, resize=1) => {
  const e = observed.find(q=>q.id===id), s = resize*Math.max(e.features.width_mm,e.features.depth_mm)/1000;
  const c = Math.cos(angle), t = Math.sin(angle);
  const p = (a,b) => { if (mirror) a=-a; return [x+s*(a*c-b*t),y+s*(a*t+b*c)]; };
  return e.segments.map(([a,b,u,v]) => [...p(a,b),...p(u,v)]);
};
const rect = (x,y,w,h) => [[x,y,x+w,y],[x+w,y,x+w,y+h],[x+w,y+h,x,y+h],[x,y+h,x,y]];
const parts = (lines, layer='', group=null) => lines.map(s => ({kind:'line',layer,group,segs:[s]}));
const recognize = o => recognizeSymbols(o,dictionary).matches;

test('辞書に出典と実形状があり、汎用パターンとは区別する', () => {
  assert.equal(observed.length,18);
  for (const e of observed) {
    assert.equal(e.provenance.license,'CC0-1.0');
    assert.match(e.provenance.sha256,/^[a-f0-9]{64}$/);
    assert.ok(e.segments.length>4);
    assert.ok(e.features.width_mm>0);
  }
  assert.equal(dictionary.symbols.filter(x => x.entry_type==='generic_pattern' && !x.segments && x.provenance.kind==='original_heuristic').length,6);
});

test('家具6形状は、旧辞書で種類を絞れない角度・寸法違いの展開図形でも個別に検出する', () => {
  const older = {...dictionary,symbols:dictionary.symbols.filter(e=>!newFurniture.includes(e.id))};
  for (const [i,id] of newFurniture.entries()) {
    const segs=symbol(id,5,7,.38,i%2===0,i%2===0 ? .91 : 1.08);
    const prior = recognizeSymbols({segs},older).matches;
    assert.deepEqual(prior.map(r=>[r.id,r.status]),id==='desk_bench' ? [['generic_desk','similar']] : [],id);
    assert.deepEqual(recognize({segs}).map(r=>[r.id,r.status]),[[id,'match']],id);
  }
});

test('ソファ3種・ハイチェア・オットマンを回転、鏡像、寸法差がある展開図形でも区別する', () => {
  for (const [i,id] of newSeats.entries()) {
    const segs=symbol(id,7,9,i%2 ? -.47 : .38,i%2===0,i%2 ? .93 : 1.07);
    assert.deepEqual(recognize({segs}).map(r=>[r.id,r.status]),[[id,'match']],id);
  }
  // 外周だけでは角丸の箱と同じ。二重輪郭がない場合にはオットマンと判定しない。
  assert.deepEqual(recognize({segs:symbol('chair_ottoman',2,3,.43).slice(0,36)}),[]);
});

test('丸スツールは脚線のある円を類似に出す。円だけ、同心円、中心で交わる線は除外', () => {
  const p=(a,r)=>[3+r*Math.cos(a),4+r*Math.sin(a)];
  const circle=r=>Array.from({length:32},(_,i)=>[...p(i*Math.PI/16,r),...p((i+1)*Math.PI/16,r)]);
  const legs=(n,inner,a=.27)=>Array.from({length:n},(_,i)=>{
    const angle=a+i*2*Math.PI/n;
    return [...p(angle,inner),...p(angle,.21)];
  });
  for (const n of [3,4]) {
    const segs=legs(n,.12), native=cadSymbolParts([{k:'circle',c:[3,4],r:.21},
      ...segs.map(([x,y,u,v])=>({k:'line',a:[x,y],b:[u,v]}))],1);
    for (const geometry of [{segs:[...circle(.21),...segs]},{parts:native}]) {
      assert.deepEqual(recognize(geometry).map(x=>[x.id,x.status]),[['generic_round_stool','similar']]);
    }
  }
  for (const extras of [[],circle(.15),legs(4,0),legs(2,.12),[...legs(3,.12),...legs(1,.12,1.17)]]) {
    assert.deepEqual(recognize({segs:[...circle(.21),...extras]}),[]);
  }
});

test('家具の寸法に近くても、四角い外枠・円・ドアの開きは家具と判定しない', () => {
  const rotatingRect=rect(0,0,.633,.666).flatMap(([a,b,u,v]) => {
    const p=(x,y)=>[x*.8-y*.6+3,x*.6+y*.8+2];
    const mid=[(a+u)/2,(b+v)/2];
    return [[...p(a,b),...p(...mid)],[...p(...mid),...p(u,v)]];
  });
  const curve=(x,y,r,angle,n)=>Array.from({length:n},(_,i)=>{
    const p=j=>[x+r*Math.cos(angle*j/n),y+r*Math.sin(angle*j/n)];
    return [...p(i),...p(i+1)];
  });
  const empty=[...rect(0,0,.48,.5),[.24,.24,.25,.24],...rotatingRect,...rect(6,0,2.4,.7),
    ...rect(10,0,1.8,.9),...curve(13,1,.45,2*Math.PI,40),...curve(15,1,.8,Math.PI/2,16),[15,1,15,1.8]];
  assert.deepEqual(recognize({segs:empty}),[]);
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

const display = d=>drawingSymbolMatches(d,{bath:'浴槽',toilet:'便器',urinal:'小便器',counter:'洗面台'});

test('保存済みの器具は辞書なしでも検出として表示。判定保留は不明', () => {
  const d={symbols:{unavailable:true},fixtures:[{t:'bath',b:[1,1,2.6,1.82]},{t:'unknown',b:[4,4,4.6,4.7]}]};
  const before=structuredClone(d);
  assert.deepEqual(display(d).map(x=>[x.status,x.reason,x.label]),[
    ['match','detected','浴槽'],['unknown','reader','種類を特定できない器具'],
  ]);
  assert.deepEqual(d,before);
  delete d.symbols;
  assert.equal(display(d).length,2);
});

test('重複・表題欄・手で追加した器具・壊れた寸法を候補から除外', () => {
  const segs=symbol('urinal_wall',2,3);
  const fixture = b => ({t:'unknown',b});
  const match = recognize({segs})[0];
  const matches=display({symbols:{matches:[match,{b:[19,19,20,20],status:'unknown',reason:'reader'}]}, fixtures:[
    fixture(match.b), fixture([5,5,5.6,5.7]), fixture([5,5,5.6,5.7]),
    {t:'urinal',b:match.b}, {t:'bath',b:[7,7,7.6,7.9]}, fixture([8.1,7,8.1,7.8]), {t:'other',b:[9,9,9.6,9.8]},
    {t:'toilet',b:[10,10,11,11],v:true},{t:'toilet',b:[12,12,13,13],added:true},
  ],analysis:{regions:[{type:'title',box:[6.8,6.8,8,8]}]}});
  assert.deepEqual(matches.map(x=>[x.status,x.reason]),[['match',undefined],['unknown','reader']]);
  assert.deepEqual(matches[1].b,[5,5,5.6,5.7]);
});

test('弱い辞書照合と器具検出が重なったら一枠。手動修正・除外があれば優先', () => {
  const b=[1,1,2,2], similar={id:'shape',status:'similar',b}, match={...similar,status:'match'};
  const of=(s,t,edited=false)=>display({symbols:{matches:[s]},fixtures:[{t,b:[1.02,0.99,2.02,2],edited}]});
  assert.deepEqual(of(similar,'counter').map(x=>x.id),['reader-counter']);
  assert.deepEqual(of(match,'counter').map(x=>x.id),['shape']);
  assert.deepEqual(of(match,'counter',true).map(x=>x.id),['reader-counter']);
  assert.deepEqual(of(match,'unknown',true).map(x=>x.status),['unknown']);
  assert.equal(of(match,'other',true).length,0);
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

test('欠けた図形は辞書に似ていても一致にしない', () => {
  const segs=symbol('desk_straight',10.6,4.8).filter((_,j)=>j%3!==1);
  const r=recognize({segs});
  assert.equal(r.length,1);
  assert.equal(r[0].status,'unknown');
  assert.equal(r[0].reason,'weak');
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
