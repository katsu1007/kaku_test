"""CAD読み込み試験用。許諾確認済みの元DXFからネイティブの円弧やINSERTを組む。"""
import json
from pathlib import Path
import sys

import ezdxf

input_dir, output_dir = map(Path, sys.argv[1:])
sources = json.loads((Path(__file__).resolve().parents[2] / "tools/symbol_sources.json").read_text())
doc = ezdxf.new("R2010", units=4)
for layer in ("WALL", "SYMBOLS"):
    doc.layers.new(layer)
model = doc.modelspace()
model.add_lwpolyline([(0, 0), (12000, 0), (12000, 6000), (0, 6000)], close=True, dxfattribs={"layer": "WALL"})
model.add_text("OFFICE", dxfattribs={"insert": (6000, 3500), "height": 120})

for i, e in enumerate(sources):
    src = ezdxf.readfile(input_dir / f"{e['slug']}.dxf")
    (insert,) = src.modelspace().query("INSERT")
    block = doc.blocks.new(f"ANON_{i}")  # 名前が照合に使われないことを確認
    for obj in insert.virtual_entities():
        obj.dxf.layer = "0"
        block.add_foreign_entity(obj)
    ref = model.add_blockref(block.name, (1200 + 1370*i, 1600 + 1100*(i % 2)),
                             dxfattribs={"layer": "SYMBOLS", "rotation": 22 if i % 2 else 90, "xscale": -1 if i == 5 else 1})
    if i in (2, 4):
        ref.explode()
model.add_lwpolyline([(8000, 4000), (9200, 4000), (9200, 4450), (8000, 4450)],
                     close=True, dxfattribs={"layer": "SYMBOLS"})
for x in (8400, 8800):
    model.add_line((x, 4000), (x, 4450), dxfattribs={"layer": "SYMBOLS"})
doc.saveas(output_dir / "symbol-test-office.dxf")

single = ezdxf.new("R2010", units=4)
first = ezdxf.readfile(input_dir / f"{sources[0]['slug']}.dxf")
(insert,) = first.modelspace().query("INSERT")
for obj in insert.virtual_entities():
    obj.dxf.layer = "0"
    single.modelspace().add_foreign_entity(obj)
single.saveas(output_dir / "symbol-test-no-room.dxf")
