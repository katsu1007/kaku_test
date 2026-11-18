/* 実測シンボルと汎用ルールを照合。入力の座標・単位は図面と同じ m / Y上向き。 */
const VERSION = 'kaku_symbol_dictionary_v3';
const STRIDE = 0.35, PAD = 0.012, MAX_PARTS = 50000, MAX_CANDIDATES = 1600;
const DROP = /寸法|通り?[芯心]|基準線|文字|注記|図枠|表題|凡例|ハッチ|配線|電気|照明|(?:^|[-_ ])(?:DIM\w*|GRID|TEXT|ANNO\w*|HATCH|TITLE|LEGEND|FRAME|WIRE|LIGHT|WALLS?)(?:$|[-_ ])/i;
let pending;

export function loadSymbolDictionary() {
  if (!pending) pending = fetch(new URL('./symbol_dictionary.json', import.meta.url))
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(d => { if (d.schema_version !== VERSION || !Array.isArray(d.symbols)) throw new Error('辞書形式が違います'); return d; })
    .catch(e => { pending = null; throw e; });
  return pending;
}

const blankBox = () => [Infinity, Infinity, -Infinity, -Infinity];
const bounds = segs => {
  const b = blankBox();
  for (const [x,y,u,v] of segs) {
    b[0] = Math.min(b[0],x,u); b[1] = Math.min(b[1],y,v);
    b[2] = Math.max(b[2],x,u); b[3] = Math.max(b[3],y,v);
  }
  return b;
};
const width = b => b[2]-b[0], height = b => b[3]-b[1];
const length = ([x,y,u,v]) => Math.hypot(u-x,v-y);
const inside = (a,b,p=0) => a[0] >= b[0]-p && a[1] >= b[1]-p && a[2] <= b[2]+p && a[3] <= b[3]+p;
const near = (a,b,p=0) => a[0] <= b[2]+p && a[2]+p >= b[0] && a[1] <= b[3]+p && a[3]+p >= b[1];
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const closeSize = (a,b) => Math.min(a,b)/Math.max(a,b);
const between = (x,range) => !!range && x >= range[0] && x <= range[1];
const round = v => Number(v.toFixed(5));

// Legacy CAD reader already resolves DXF INSERT and JWW group scales. Don't reparse the file.
export function cadSymbolParts(ents, metresPerUnit) {
  const parts = [];
  if (!(metresPerUnit > 0)) return parts;
  for (const e of ents) {
    if (parts.length > MAX_PARTS) break;
    const kind = e.ell ? 'ellipse' : e.k;
    let pts = e.ell || e.pts;
    if (kind === 'line') pts = [e.a,e.b];
    if (kind === 'circle' && e.r > 0) pts = Array.from({length: 33}, (_,i) => {
      const a = i*Math.PI/16;
      return [e.c[0]+e.r*Math.cos(a), e.c[1]+e.r*Math.sin(a)];
    });
    if (!['ellipse','line','circle','arc','poly'].includes(kind) || e.dash || !pts || pts.length < 2) continue;
    if (pts.length > 361) continue;
    if (e.closed && (pts[0][0] !== pts.at(-1)[0] || pts[0][1] !== pts.at(-1)[1])) pts = [...pts,pts[0]];
    const segs = [];
    for (let i=1; i<pts.length; i++) segs.push([...pts[i-1],...pts[i]].map(v => v*metresPerUnit));
    const groups=[];
    for (let o=e.o; o && groups.length<8; o=o.o) groups.push(o.id);
    parts.push({kind, curved: !!e.bul || ['ellipse','circle','arc'].includes(kind), groups, layer: e.ly || '', segs});
  }
  return parts;
}

const validSegment = s => Array.isArray(s) && s.length === 4 && s.every(Number.isFinite) && length(s) > 0.00005;

// Two routes: explicit INSERT groups and spatial clusters, including exploded geometry.
function clusters(P) {
  const cells = new Map(), blocks = new Map(), par = P.map((_,i) => i);
  const root = i => { while (i !== par[i]) { par[i] = par[par[i]]; i = par[i]; } return i; };
  P.forEach((p,i) => {
    for (const id of p.groups || (p.group == null ? [] : [p.group])) {
      if (!blocks.has(id)) blocks.set(id, []);
      blocks.get(id).push(p);
    }
    const [x,y,u,v] = p.b, seen = new Set();
    for (let a=Math.floor((x-PAD)/STRIDE); a<=Math.floor((u+PAD)/STRIDE); a++) {
      for (let b=Math.floor((y-PAD)/STRIDE); b<=Math.floor((v+PAD)/STRIDE); b++) {
        const k = `${p.layer}\0${a},${b}`, prev = cells.get(k) || [];
        if (!prev.length) cells.set(k,prev);
        if (prev.length >= 180) continue; // dense hatch/annotation zones are not useful anchors
        for (const j of prev) {
          if (seen.has(j)) continue;
          seen.add(j);
          if (near(p.b,P[j].b,PAD)) par[root(j)] = root(i);
        }
        prev.push(i);
      }
    }
  });
  const spatial = new Map();
  P.forEach((p,i) => {
    const r = root(i);
    if (!spatial.has(r)) spatial.set(r,[]);
    spatial.get(r).push(p);
  });
  const result = [...blocks.values()];
  for (const group of spatial.values()) {
    if (group.length>360) continue;
    const box=bounds(group.flatMap(p=>p.segs)), [x,y,u,v]=box;
    if (Math.min(width(box),height(box))<0.14 || Math.max(width(box),height(box))>4.5) continue;
    const ids=new Set(), layer=group[0].layer;
    for (let a=Math.floor((x-PAD)/STRIDE); a<=Math.floor((u+PAD)/STRIDE); a++) {
      for (let b=Math.floor((y-PAD)/STRIDE); b<=Math.floor((v+PAD)/STRIDE); b++) {
        for (const j of cells.get(`${layer}\0${a},${b}`) || []) if (inside(P[j].b,box,PAD)) ids.add(j);
      }
    }
    // Disconnected curves, drains and desk details inside an exploded outer contour.
    if (ids.size && ids.size<=360) result.push([...ids].map(i=>P[i]));
    if (ids.size!==group.length) result.push(group);
  }
  return result;
}

function oriented(segs,a) {
  const c = Math.cos(a), s = Math.sin(a);
  const [ox,oy] = segs[0];
  const rr = segs.map(([x,y,u,v]) => {
    x-=ox; u-=ox; y-=oy; v-=oy;
    return [x*c+y*s,-x*s+y*c,u*c+v*s,-u*s+v*c];
  });
  const b = bounds(rr), w = width(b), h = height(b), sc = Math.max(w,h);
  if (Math.min(w,h) < 0.14 || sc > 3.3) return null;
  const x0 = (b[0]+b[2])/2, y0 = (b[1]+b[3])/2;
  return {w:w*1000,h:h*1000,ratio:w/h,rr,b,c,s,segs:rr.map(([x,y,u,v]) => [(x-x0)/sc,(y-y0)/sc,(u-x0)/sc,(v-y0)/sc])};
}

function angles(segs) {
  const bins = new Map(), q = Math.PI/2, a0 = Math.PI/36;
  for (const s of segs) {
    const l = length(s); if (l < 0.14) continue;
    const a = ((Math.atan2(s[3]-s[1],s[2]-s[0])+Math.PI*2+q/2)%q)-q/2;
    const k = Math.round(a/a0), g = bins.get(k) || [0,0];
    g[0] += l; g[1] += a*l; bins.set(k,g);
  }
  const A = [0,...[...bins.values()].sort((a,b) => b[0]-a[0]).slice(0,2).map(([w,v]) => v/w)];
  return A.filter((x,i) => !A.slice(0,i).some(y => Math.abs(x-y) < 0.01));
}

function transform(segs, turn, mirror) {
  const T = (x,y) => turn === 0 ? [x,y] : turn === 1 ? [y,-x] : turn === 2 ? [-x,-y] : [-y,x];
  return segs.map(([x,y,u,v]) => [...T(mirror ? -x : x,y),...T(mirror ? -u : u,v)]);
}

function dist2(x,y,[a,b,c,d]) {
  const dx=c-a, dy=d-b, l=dx*dx+dy*dy;
  const t=l ? clamp(((x-a)*dx+(y-b)*dy)/l,0,1) : 0;
  return (x-a-t*dx)**2+(y-b-t*dy)**2;
}

function coverage(a,b) {
  let score=0, w=0;
  for (const [x,y,u,v] of a) {
    const len=Math.hypot(u-x,v-y);
    const n=Math.max(1,Math.ceil(len/0.035));
    for (let i=0;i<n;i++) {
      const t=(i+0.5)/n, p=x+t*(u-x), q=y+t*(v-y);
      let m=Infinity;
      for (const edge of b) { m=Math.min(m,dist2(p,q,edge)); if (m<0.000009) break; }
      // Curves may be flattened with different tolerances by the two readers.
      score+=len/n*(1-clamp((Math.sqrt(m)-0.008)/0.045,0,1)); w+=len/n;
    }
  }
  return score/w;
}

function intervals(runs) {
  if (!runs.length) return 0;
  runs.sort((a,b) => a[0]-b[0]);
  let [a,b]=runs[0], n=0;
  for (const [c,d] of runs) {
    if (c>b) { n+=b-a; a=c; b=d; } else b=Math.max(b,d);
  }
  return n+b-a;
}

function linearEvidence(v) {
  const [x0,y0,x1,y1] = v.b, w = x1-x0, h = y1-y0;
  const tol=0.012, edge=[[],[],[],[]], div=[], inset=[];
  for (const [x,y,u,z] of v.rr) {
    const horizontal=Math.abs(y-z)<tol && Math.abs(x-u)>tol;
    const vertical=Math.abs(x-u)<tol && Math.abs(y-z)>tol;
    if (horizontal) {
      if (Math.max(Math.abs(y-y0),Math.abs(z-y0))<tol) edge[0].push([Math.min(x,u),Math.max(x,u)]);
      else if (Math.max(Math.abs(y-y1),Math.abs(z-y1))<tol) edge[1].push([Math.min(x,u),Math.max(x,u)]);
      else if (Math.min(x,u)>x0+tol && Math.max(x,u)<x1-tol) inset.push(1);
    }
    if (vertical) {
      if (Math.max(Math.abs(x-x0),Math.abs(u-x0))<tol) edge[2].push([Math.min(y,z),Math.max(y,z)]);
      else if (Math.max(Math.abs(x-x1),Math.abs(u-x1))<tol) edge[3].push([Math.min(y,z),Math.max(y,z)]);
      else if (Math.abs(y-z)>=h-2*tol) div.push((x+u)/2);
      else if (Math.min(y,z)>y0+tol && Math.max(y,z)<y1-tol) inset.push(1);
    }
  }
  const cuts = div.sort((a,b) => a-b).filter((x,i) => !i || x-div[i-1]>tol);
  const xs = [x0,...cuts,x1], gaps = xs.slice(1).map((x,i) => 1000*(x-xs[i]));
  return {edge:Math.min(...edge.map((d,i) => intervals(d)/(i<2?w:h))), cuts:cuts.length, gaps, inset:inset.length};
}

function ruleScore(e,v,parts) {
  if (!between(v.w,e.width_mm) || !between(v.h,e.depth_mm) || !between(v.ratio,e.aspect_ratio)) return 0;
  const p=e.primitive_features, curved=parts.filter(x => x.curved);
  if (e.rule === 'locker' || e.rule === 'desk') {
    const all=v.rr.reduce((s,x) => s+length(x),0);
    const curve=curved.flatMap(x => x.segs).reduce((s,x) => s+length(x),0);
    if (curve/all>p.curve_length_ratio_max) return 0;
    const L=linearEvidence(v);
    if (L.edge<p.outer_edge_coverage_min) return 0;
    if (e.rule==='desk') return L.cuts<=p.partitions_max && L.inset>=p.inset_straight_segments_min ? 0.76 : 0;
    if (L.cuts<p.partitions_min || !L.gaps.every(x => between(x,p.cell_width_mm))) return 0;
    const regular=Math.min(...L.gaps)/Math.max(...L.gaps);
    return regular>=p.cell_spacing_ratio_min ? 0.76+0.07*regular : 0;
  }
  if (!between(curved.length,p.curved_paths)) return 0;
  const closedBowls=curved.filter(x => {
    const a=x.segs[0], z=x.segs.at(-1);
    return Math.hypot(a[0]-z[2],a[1]-z[3])<0.025 &&
      Math.min(width(x.b),height(x.b))>0.13 && x.kind!=='circle';
  });
  if (!closedBowls.length || parts.length===1) return 0;
  const bowl = closedBowls.map(x => {
    const {c,s}=v, b=bounds(x.segs.map(([x,y,u,z])=>[x*c+y*s,-x*s+y*c,u*c+z*s,-u*s+z*c]));
    return { w:width(b)*1000, h:height(b)*1000 };
  });
  if (e.rule==='wc') return bowl.length>=2 && bowl.some(q=>q.w/q.h<0.93) ? 0.78 : 0;
  if (closedBowls.length!==1 || parts.length<2) return 0;
  const q=bowl[0], ratio=q.w/q.h;
  if (q.w < v.w*.33 || q.w > v.w*.94 || q.h < v.h*.3 || q.h > v.h*.94) return 0;
  return (e.rule==='urinal' && ratio<=1.02) || (e.rule==='basin' && ratio>=1.19) ? 0.74 : 0;
}

function match(parts,entries) {
  const segs=parts.flatMap(x => x.segs);
  if (segs.length < 4 || segs.length > 360) return null;
  const bb=bounds(segs);
  if (Math.max(width(bb),height(bb))>4.5 || Math.min(width(bb),height(bb))<0.14) return null;
  const found=new Map();
  const add=(e,score) => { if (score>(found.get(e.category)?.score||0)) found.set(e.category,{e,score}); };
  for (const a of angles(segs)) {
    const v=oriented(segs,a); if (!v) continue;
    const v90=oriented(segs,a+Math.PI/2)||v;
    for (const e of entries) {
      if (e.entry_type==='generic_pattern') {
        add(e,Math.max(ruleScore(e,v,parts),ruleScore(e,v90,parts)));
        continue;
      }
      const f=e.features;
      for (let k=0;k<4;k++) {
        const w=k%2?v.h:v.w, h=k%2?v.w:v.h;
        const dims=Math.min(closeSize(w,f.width_mm),closeSize(h,f.depth_mm));
        if (dims<0.72 || closeSize(w/h,f.aspect_ratio)<0.8) continue;
        for (const mirror of [false,true]) {
          const C=transform(v.segs,k,mirror);
          const hit=coverage(e.segments,C);
          if (hit<0.81) continue;
          const reverse=coverage(C,e.segments);
          const shape=Math.min(hit,reverse);
          if (shape>=0.81) add(e,0.86*shape+0.14*dims);
        }
      }
    }
  }
  const [one,two]=[...found.values()].sort((x,y) => y.score-x.score);
  if (!one || one.score<0.73 || (two && one.score-two.score<0.035)) return null;
  return {id:one.e.id,category:one.e.category,label:one.e.label,entry_type:one.e.entry_type,
    score:Math.min(99,Math.floor(one.score*100+1e-8)), b:bb.map(round)};
}

function overlap(a,b) {
  const i=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*
    Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
  return i/(width(a)*height(a)+width(b)*height(b)-i||1);
}

export function recognizeSymbols({parts, segs=[], regions=[]},dictionary) {
  const input=parts?.length ? parts : segs.map(s => ({kind:'line',segs:[s]}));
  if (input.length>MAX_PARTS) return {limited:true,matches:[]};
  const entries=dictionary.symbols.filter(e => e.entry_type==='generic_pattern' ||
    (e.entry_type==='observed' && e.segments?.length && e.features?.width_mm>0 && e.features?.depth_mm>0));
  const excluded=regions.filter(r => r.type==='title'||r.type==='table').map(r => r.box);
  const P=[];
  for (const p of input) {
    if (DROP.test(p.layer||'') || !p.segs?.length || p.segs.length>360) continue;
    const s=p.segs.filter(validSegment); if (!s.length) continue;
    const b=bounds(s);
    if (Math.max(width(b),height(b))>3.3 || excluded.some(q => inside(b,q))) continue;
    P.push({...p,layer:p.layer||'',segs:s,b,index:P.length});
  }
  const found=[], ids=new Set();
  let tried=0, limited=false;
  for (const group of clusters(P)) {
    if (group.length>360) continue;
    const b=bounds(group.flatMap(p => p.segs));
    if (Math.min(width(b),height(b))<0.14 || Math.max(width(b),height(b))>4.5) continue;
    const key=group.map(x=>x.index).sort((a,b)=>a-b).join(',');
    if (ids.has(key)) continue;
    ids.add(key);
    if (tried++>=MAX_CANDIDATES) { limited=true; break; }
    const x=match(group,entries);
    if (x && !excluded.some(q => inside(x.b,q))) found.push(x);
  }
  const matches=[];
  for (const x of found.sort((a,b) => b.score-a.score || a.b[1]-b.b[1] || a.b[0]-b.b[0])) {
    if (matches.length>=300) { limited=true; break; }
    if (!matches.some(y => overlap(x.b,y.b)>0.55)) matches.push(x);
  }
  return {limited,matches};
}
