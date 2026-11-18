"""CAD読み込み試験用。許諾確認済みの元DXFからネイティブの円弧やINSERTを組む。"""
import json
from pathlib import Path
import sys

import ezdxf
from ezdxf import bbox, units

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "tools"))
from build_symbol_dictionary import symbol_entities

input_dir, output_dir = map(Path, sys.argv[1:])
sources = json.loads((root / "tools/symbol_sources.json").read_text())
doc = ezdxf.new("R2010", units=4)
for layer in ("WALL", "SYMBOLS"):
    doc.layers.new(layer)
model = doc.modelspace()
model.add_lwpolyline([(0, 0), (16000, 0), (16000, 13000), (0, 13000)], close=True, dxfattribs={"layer": "WALL"})
model.add_text("OFFICE", dxfattribs={"insert": (6000, 10500), "height": 120})

for i, e in enumerate(sources):
    src = ezdxf.readfile(input_dir / f"{e['slug']}.dxf")
    entities = list(symbol_entities(src, e, units.conversion_factor(src.units, units.MM)))
    base = bbox.extents(entities).center
    block = doc.blocks.new(f"ANON_{i}", base_point=base)  # 名前が照合に使われないことを確認
    for obj in entities:
        obj.dxf.layer = "0"
        block.add_foreign_entity(obj)
    factor = .92 if i % 3 == 0 else 1.06
    ref = model.add_blockref(block.name, (2000 + 3000*(i % 5), 2000 + 3000*(i // 5)),
                             dxfattribs={"layer": "SYMBOLS", "rotation": 22 if i % 2 else 90,
                                         "xscale": -factor if i == 5 else factor, "yscale": factor, "zscale": factor})
    if e["id"] in {"urinal_wall", "desk_straight", "chair_task", "desk_meeting_set"}:
        ref.explode()
model.add_lwpolyline([(3000, 11000), (4200, 11000), (4200, 11450), (3000, 11450)],
                     close=True, dxfattribs={"layer": "SYMBOLS"})
for x in (3400, 3800):
    model.add_line((x, 11000), (x, 11450), dxfattribs={"layer": "SYMBOLS"})
model.add_lwpolyline([(13000, 10000), (13480, 10000), (13480, 10500), (13000, 10500)],
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
