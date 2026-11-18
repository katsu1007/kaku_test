#!/usr/bin/env python3
"""Build the KAKU browser dictionary from individually reviewed open DXF files."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import ezdxf
from ezdxf import bbox, disassemble, path, units

ROOT = Path(__file__).resolve().parent.parent
HERE = ROOT / "tools"
LICENSE = {
    "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "MIT": "https://opensource.org/license/mit",
    "BSD-2-Clause": "https://opensource.org/license/bsd-2-clause",
    "BSD-3-Clause": "https://opensource.org/license/bsd-3-clause",
}
KINDS = {
    "LINE": "line", "ARC": "arc", "CIRCLE": "circle", "ELLIPSE": "ellipse",
    "LWPOLYLINE": "polyline", "POLYLINE": "polyline", "SPLINE": "spline",
}
CONTEXT_CATEGORIES = {"plumbing", "opening", "electrical"}
CATEGORIES = {"toilet", "urinal", "washbasin", "desk", "chair", "locker",
              "bath", "sink", "table", "bed", "storage", "appliance", "hvac"} | CONTEXT_CATEGORIES
VENDOR = "https://www.innerscene.com"
LIMIT = 10_000_000


def read_json(p):
    return json.loads(p.read_text(encoding="utf-8"))


def symbol_entities(doc, entry, mm_per_unit):
    """For a reviewed assembly, optionally select complete entities inside a model-space box."""
    box = entry.get("selection_box_mm")
    if box is not None and (len(box) != 4 or not all(math.isfinite(v) for v in box)
                            or box[0] >= box[2] or box[1] >= box[3]):
        raise ValueError(f"invalid selection box: {entry['id']}")
    for e in disassemble.recursive_decompose(doc.modelspace()):
        if e.dxftype() not in KINDS or e.dxf.get("invisible", 0):
            continue
        if box is not None:
            b = bbox.extents([e])
            if not b.has_data or not (
                box[0] - 1e-6 <= b.extmin.x * mm_per_unit <= b.extmax.x * mm_per_unit <= box[2] + 1e-6
                and box[1] - 1e-6 <= b.extmin.y * mm_per_unit <= b.extmax.y * mm_per_unit <= box[3] + 1e-6
            ):
                continue
        yield e


def sample(entry, input_dir, download):
    if "slug" in entry:
        slug = entry["slug"]
        if not slug or not all(c.isascii() and (c.isalnum() or c == "-") for c in slug):
            raise ValueError("invalid Innerscene slug")
        name = slug + ".dxf"
        source = VENDOR + "/tools/library/drawings/" + slug
        license_id = "CC0-1.0"
        direct = VENDOR + "/api/library/" + slug + "/download"
    else:
        name, source, license_id = (entry[k] for k in ("file", "source_url", "license"))
        direct = None
    if Path(name).name != name or Path(name).suffix.lower() != ".dxf":
        raise ValueError("expected a DXF basename")
    u = urlparse(source)
    if u.scheme != "https" or not u.hostname or license_id not in LICENSE:
        raise ValueError("each file needs a reviewed HTTPS source and a supported license")
    notice = entry.get("notice")
    if license_id != "CC0-1.0" and (not isinstance(notice, str) or not notice.strip()):
        raise ValueError("MIT/BSD entries must include the upstream copyright and license text in notice")
    f = input_dir / name
    if download and direct and not f.exists():
        request = Request(direct, headers={"User-Agent": "KAKU-Symbol-Dictionary/1.0"})
        with urlopen(request, timeout=30) as response:
            data = response.read(LIMIT + 1)
        if len(data) > LIMIT or hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise ValueError(f"download is too large or SHA-256 mismatch: {name}")
        f.write_bytes(data)
    if f.stat().st_size > LIMIT:
        raise ValueError(f"DXF exceeds size limit: {name}")
    data = f.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != entry["sha256"]:
        raise ValueError(f"SHA-256 mismatch: {name}")
    if direct and b"dedicated under CC0 1.0 Universal" not in data:
        raise ValueError(f"missing Innerscene CC0 notice: {name}")
    doc = ezdxf.readfile(f)
    unit = doc.units or entry.get("insunits")
    if not unit:
        raise ValueError(f"unitless DXF requires an explicit insunits override: {name}")
    m = units.conversion_factor(unit, units.MM)
    counts, strokes, length = Counter(), [], Counter()
    for e in symbol_entities(doc, entry, m):
        kind = KINDS[e.dxftype()]
        if kind == "line":
            points = [e.dxf.start, e.dxf.end]
        elif kind in {"arc", "circle", "ellipse"}:
            points = list(e.flattening(0.35 / m))
        else:
            if kind == "polyline" and e.dxftype() == "POLYLINE" and (e.is_polygon_mesh or e.is_poly_face_mesh):
                continue
            points = list(path.make_path(e).flattening(0.35 / m, segments=4))
        pairs = [(p.x * m, p.y * m) for p in points]
        if not all(math.isfinite(v) for p in pairs for v in p):
            raise ValueError(f"non-finite coordinate: {name}")
        a = [(x, y, u, v) for (x, y), (u, v) in zip(pairs, pairs[1:]) if math.hypot(u-x, v-y) > 1e-8]
        if not a:
            continue
        if len(strokes) + len(a) > 2400:
            raise ValueError(f"not a single symbol, or too detailed: {name}")
        counts[kind] += 1
        length[kind] += sum(math.hypot(u-x, v-y) for x,y,u,v in a)
        strokes.extend(a)
    if not strokes:
        raise ValueError(f"no supported geometry: {name}")
    xs = [s[k] for s in strokes for k in (0, 2)]
    ys = [s[k] for s in strokes for k in (1, 3)]
    w, h = max(xs)-min(xs), max(ys)-min(ys)
    if min(w, h) <= 0:
        raise ValueError(f"degenerate symbol: {name}")
    cx, cy, scale = (min(xs)+max(xs))/2, (min(ys)+max(ys))/2, max(w,h)
    geometry = [[round(v, 6) for v in ((x-cx)/scale, (y-cy)/scale, (u-cx)/scale, (v-cy)/scale)]
                for x,y,u,v in strokes]
    context = entry.get("match_context", entry["category"] if entry["category"] in CONTEXT_CATEGORIES else None)
    source_block = None
    if context is not None:
        if context not in CONTEXT_CATEGORIES | {"block"}:
            raise ValueError(f"unsupported match context: {context}")
        inserts = list(doc.modelspace().query("INSERT"))
        if len(inserts) != 1:
            raise ValueError(f"context matching requires one identifiable DXF INSERT: {name}")
        source_block = inserts[0].dxf.name.strip().upper()
    stroke_ratio = entry.get("min_stroke_ratio")
    if stroke_ratio is not None and not 0 < stroke_ratio <= 1:
        raise ValueError(f"invalid min_stroke_ratio: {entry['id']}")
    return {
        "id": entry["id"], "category": entry["category"], "label": entry["label"], "entry_type": "observed",
        **({"match_context": context, "source_block": source_block} if context else {}),
        "provenance": {"license": license_id, "license_url": LICENSE[license_id], "source_url": source,
                       "source_file": name, "sha256": digest, **({"notice": notice} if notice else {}),
                       **({"selection_box_mm": entry["selection_box_mm"]} if "selection_box_mm" in entry else {})},
        "features": {"width_mm": round(w, 3), "depth_mm": round(h, 3), "aspect_ratio": round(w/h, 6),
                     "primitive_counts": dict(sorted(counts.items())),
                     "primitive_ratios": {k: round(v/sum(counts.values()), 6) for k,v in sorted(counts.items())},
                     "primitive_length_ratios": {k: round(v/sum(length.values()), 6) for k,v in sorted(length.items())},
                     **({"min_normalized_stroke_length": round(stroke_ratio*sum(length.values())/scale, 5)}
                        if stroke_ratio is not None else {})},
        "segments": geometry,
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input_dir", type=Path)
    p.add_argument("--manifest", type=Path, default=HERE / "symbol_sources.json")
    p.add_argument("--patterns", type=Path, default=HERE / "symbol_patterns.json")
    p.add_argument("--output", type=Path, default=ROOT / "js" / "reader2" / "symbol_dictionary.json")
    p.add_argument("--download", action="store_true", help="fetch missing reviewed Innerscene sources")
    args = p.parse_args()
    if args.download:
        args.input_dir.mkdir(parents=True, exist_ok=True)
    try:
        sources, patterns = read_json(args.manifest), read_json(args.patterns)
        ids = set()
        for e in sources + patterns:
            if not e["id"] or e["id"] in ids or e["category"] not in CATEGORIES or not e["label"]:
                raise ValueError(f"invalid or duplicate entry: {e['id']}")
            ids.add(e["id"])
        observed = [sample(e, args.input_dir, args.download) for e in sources]
        shapes = set()
        for e in observed:
            # Text-only distinctions in otherwise identical electrical marks
            # are safe only when the original, unique INSERT name is required.
            key = (e["source_block"] if e.get("match_context") == "block" else None,
                   e["features"]["width_mm"], e["features"]["depth_mm"],
                   tuple(sorted(tuple(sorted((tuple(s[:2]), tuple(s[2:])))) for s in e["segments"])))
            if key in shapes:
                raise ValueError(f"duplicate geometry: {e['id']}")
            shapes.add(key)
        generic = [{**e, "entry_type": "generic_pattern", "provenance": {"kind": "original_heuristic"}} for e in patterns]
    except (OSError, ValueError, KeyError, TypeError, ezdxf.DXFError) as exc:
        p.exit(1, f"辞書は出力されませんでした: {exc}\n")
    header = {"schema_version": "kaku_symbol_dictionary_v4", "coordinate_system": "bbox_center_longest_side_1_xy_up",
              "unit": "mm"}
    prefix = json.dumps(header, ensure_ascii=False, indent=2)[:-2]
    rows = [json.dumps(e, ensure_ascii=False, separators=(",", ":"), allow_nan=False) for e in observed + generic]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(prefix + ',\n  "symbols": [\n    ' + ',\n    '.join(rows) + "\n  ]\n}\n", encoding="utf-8")
    print(f"{args.output}: {len(observed)} observed + {len(generic)} generic patterns")


if __name__ == "__main__":
    main()
