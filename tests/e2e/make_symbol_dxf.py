"""CAD読み込み試験用。許諾確認済みの元DXFからネイティブの円弧やINSERTを組む。"""
import json
import math
from pathlib import Path
import sys

import ezdxf
from ezdxf import bbox, units

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "tools"))
from build_symbol_dictionary import symbol_entities

input_dir, output_dir = map(Path, sys.argv[1:])
sources = json.loads((root / "tools/symbol_sources.json").read_text())
dictionary = json.loads((root / "js/reader2/symbol_dictionary.json").read_text())
by_id = {e["id"]: e for e in dictionary["symbols"]}
doc = ezdxf.new("R2010", units=4)
for layer in ("WALL", "SYMBOLS"):
    doc.layers.new(layer)
model = doc.modelspace()
columns, pitch = 10, 5200
top = pitch * (1 + math.ceil(len(sources) / columns))
model.add_lwpolyline([(0, 0), (columns*pitch, 0), (columns*pitch, top), (0, top)],
                     close=True, dxfattribs={"layer": "WALL"})
model.add_text("OFFICE", dxfattribs={"insert": (6000, 1600), "height": 120})

for i, e in enumerate(sources):
    src = ezdxf.readfile(input_dir / f"{e['slug']}.dxf")
    entities = list(symbol_entities(src, e, units.conversion_factor(src.units, units.MM)))
    base = bbox.extents(entities).center
    key = by_id[e["id"]].get("source_block", f"ANON_{i}")
    block = doc.blocks.new(key, base_point=base)
    for obj in entities:
        obj.dxf.layer = "0"
        block.add_foreign_entity(obj)
    factor = .92 if i % 3 == 0 else 1.06
    ref = model.add_blockref(block.name, (2600 + pitch*(i % columns), 7800 + pitch*(i // columns)),
                             dxfattribs={"layer": "SYMBOLS", "rotation": 22 if i % 2 else 90,
                                         "xscale": -factor if i == 5 else factor, "yscale": factor, "zscale": factor})
    if e["id"] in {"urinal_wall", "desk_straight", "chair_task", "desk_meeting_set", "chair_sofa_sectional", "chair_ottoman"}:
        ref.explode()
model.add_lwpolyline([(3000, 3500), (4200, 3500), (4200, 3950), (3000, 3950)],
                     close=True, dxfattribs={"layer": "SYMBOLS"})
for x in (3400, 3800):
    model.add_line((x, 3500), (x, 3950), dxfattribs={"layer": "SYMBOLS"})
def stool(cx, angles, inner=120):
    model.add_circle((cx, 3500), 210, dxfattribs={"layer": "SYMBOLS"})
    for a in angles:
        x, y = math.cos(a), math.sin(a)
        model.add_line((cx + inner*x, 3500 + inner*y), (cx + 210*x, 3500 + 210*y),
                       dxfattribs={"layer": "SYMBOLS"})

# 4本の既存例、1本・2本の追加例、円だけ・中心に届く線の対照。
stool(7000, [.31 + i * math.pi / 2 for i in range(4)])
stool(8500, [-.31])
stool(12000, [.31, .31 + math.pi / 2])
stool(16000, [])
stool(17500, [.31], inner=0)
model.add_lwpolyline([(14000, 3500), (14480, 3500), (14480, 4000), (14000, 4000)],
                     close=True, dxfattribs={"layer": "SYMBOLS"})
doc.saveas(output_dir / "symbol-test-office.dxf")

single = ezdxf.new("R2010", units=4)
first = ezdxf.readfile(input_dir / f"{sources[0]['slug']}.dxf")
(insert,) = first.modelspace().query("INSERT")
for obj in insert.virtual_entities():
    obj.dxf.layer = "0"
    single.modelspace().add_foreign_entity(obj)
single.saveas(output_dir / "symbol-test-no-room.dxf")

# 辞書の形状を使わず、従来のKAKUだけが拾える衛生器具を用意する。
legacy = ezdxf.new("R2010", units=4)
legacy.layers.new("WALL")
legacy.layers.new("PLUMB")
model = legacy.modelspace()
walls = [(0, 0), (4000, 0), (4000, 3000), (0, 3000), (0, 0)]
for a, b in zip(walls, walls[1:]):
    model.add_line(a, b, dxfattribs={"layer": "WALL"})
model.add_lwpolyline([(130, 250), (1690, 250), (1690, 1060), (130, 1060)],
                     close=True, dxfattribs={"layer": "PLUMB"})
model.add_ellipse((910, 655), major_axis=(700, 0), ratio=.49, dxfattribs={"layer": "PLUMB"})
legacy.saveas(output_dir / "symbol-legacy-bath.dxf")
