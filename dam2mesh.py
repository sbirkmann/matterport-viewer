#!/usr/bin/env python3
"""
Matterport .dam  ->  glTF-Binary (.glb)  Decoder
================================================

Das Matterport-Dollhouse-Mesh liegt als proprietäres ``.dam`` vor. Reverse-
Engineering ergab: es ist ein Protobuf-Container aus wiederholten *Chunks*.

Chunk (protobuf, top-level field 1, wiederholt):
    field 1 (LEN)  geometry:
        field 1 (LEN)  positions : float32[nv*3]  (x,y,z)
        field 2 (LEN)  uvs       : float32[nv*2]  (u,v)
    field 2 (LEN)  indices : varint-Liste  (je 3 = ein Dreieck, 0-basiert lokal)
    field 3 (LEN)  name    : z.B. "chunk000_group000_sub004"
    field 4 (LEN)  texture : Dateiname des Atlas, z.B. "..._50k_000.jpg"

Erzeugt eine ``dollhouse.glb`` mit einer Primitive pro Chunk, gruppiert nach
Textur-Atlas (Material). Die Texturen werden als relative Image-URIs
(``tex_000.jpg`` …) referenziert und müssen im selben Ordner wie die .glb liegen.

Nutzung:
    python3 dam2mesh.py model/<id>/mesh/mesh_50k.dam
    python3 dam2mesh.py <id>          # Kurzform, sucht mesh unter model/<id>/mesh/
"""
import json
import os
import struct
import sys


def read_varint(b, o):
    s = r = 0
    while True:
        by = b[o]; o += 1
        r |= (by & 0x7f) << s
        s += 7
        if not by & 0x80:
            return r, o


def parse_fields(b, off, end):
    """Gibt Liste (field_num, wire_type, payload_start, payload_end/value) zurück."""
    out = []
    o = off
    while o < end:
        tag, o = read_varint(b, o)
        f, wt = tag >> 3, tag & 7
        if wt == 2:
            ln, o = read_varint(b, o)
            out.append((f, wt, o, o + ln)); o += ln
        elif wt == 0:
            v, o = read_varint(b, o); out.append((f, wt, v, None))
        elif wt == 5:
            out.append((f, wt, o, o + 4)); o += 4
        elif wt == 1:
            out.append((f, wt, o, o + 8)); o += 8
        else:
            break
    return out


def decode_dam(data):
    """-> Liste von Chunks {positions:[f], uvs:[f], indices:[i], texture:str}"""
    chunks = []
    for f, wt, s, e in parse_fields(data, 0, len(data)):
        if f != 1 or wt != 2:
            continue
        geom = idx_buf = None
        name = texture = None
        for cf, cwt, cs, ce in parse_fields(data, s, e):
            if cf == 1:
                geom = (cs, ce)
            elif cf == 2:
                idx_buf = (cs, ce)
            elif cf == 3:
                name = data[cs:ce].decode('latin1', 'replace')
            elif cf == 4:
                texture = data[cs:ce].decode('latin1', 'replace')
        if not geom or not idx_buf:
            continue
        positions = uvs = None
        for gf, gwt, gs, ge in parse_fields(data, geom[0], geom[1]):
            if gf == 1:
                positions = struct.unpack('<%df' % ((ge - gs) // 4), data[gs:ge])
            elif gf == 2:
                uvs = struct.unpack('<%df' % ((ge - gs) // 4), data[gs:ge])
        # Indices: verschachtelt (field 1) oder direkt als varint-Blob
        inner = parse_fields(data, idx_buf[0], idx_buf[1])
        if inner and inner[0][0] == 1 and inner[0][1] == 2:
            ib_s, ib_e = inner[0][2], inner[0][3]
        else:
            ib_s, ib_e = idx_buf[0], idx_buf[1]
        indices = []
        o = ib_s
        while o < ib_e:
            v, o = read_varint(data, o)
            indices.append(v)
        if positions is None or uvs is None or not indices:
            continue
        chunks.append({
            "positions": positions, "uvs": uvs, "indices": indices,
            "texture": texture, "name": name,
        })
    return chunks


# ---------- Minimaler GLB-Exporter ----------
COMP_FLOAT = 5126
COMP_UINT = 5125
TARGET_ARRAY = 34962
TARGET_ELEMENT = 34963


def align4(n):
    return (n + 3) & ~3


# UV-Transform: die .dam-UVs sind bottom-up (OpenGL), glTF erwartet top-down
# -> vertikal spiegeln (flipv). Empirisch am Viewer bestätigt.
# Modi: "none", "flipv", "fliph", "swap", "rot90", "rot270".
UV_MODE = os.environ.get("MPD_UV", "flipv")


def transform_uvs(uvs):
    out = list(uvs)
    for i in range(0, len(uvs), 2):
        u, v = uvs[i], uvs[i + 1]
        if UV_MODE == "swap":
            u, v = v, u
        elif UV_MODE == "rot90":      # 90° CW
            u, v = v, 1.0 - u
        elif UV_MODE == "rot270":     # 90° CCW
            u, v = 1.0 - v, u
        elif UV_MODE == "flipv":
            v = 1.0 - v
        out[i], out[i + 1] = u, v
    return out


def norm_texname(t):
    """'..._50k_003.jpg' -> 'tex_003.jpg' (einheitliche lokale Dateinamen)."""
    if not t:
        return None
    import re
    m = re.search(r'_(\d{3})\.jpg$', t)
    return f"tex_{m.group(1)}.jpg" if m else os.path.basename(t)


def build_glb(chunks, texture_files):
    bin_parts = []
    offset = 0
    bufferViews = []
    accessors = []

    def add_view(raw, target):
        nonlocal offset
        pad = align4(len(raw)) - len(raw)
        raw = raw + b'\x00' * pad
        bufferViews.append({"buffer": 0, "byteOffset": offset,
                            "byteLength": len(raw) - pad, "target": target})
        bin_parts.append(raw)
        idx = len(bufferViews) - 1
        offset += len(raw)
        return idx

    # Texturen -> images/materials  (Dateinamen normalisieren)
    tex_list = sorted(set(norm_texname(t) for t in texture_files if t))
    images = [{"uri": t} for t in tex_list]
    samplers = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]
    textures = [{"source": i, "sampler": 0} for i in range(len(tex_list))]
    materials = [{
        "name": tex_list[i],
        "pbrMetallicRoughness": {
            "baseColorTexture": {"index": i},
            "metallicFactor": 0.0, "roughnessFactor": 1.0,
        },
        "doubleSided": True,
    } for i in range(len(tex_list))]
    tex_index = {t: i for i, t in enumerate(tex_list)}

    primitives = []
    for c in chunks:
        nv = len(c["positions"]) // 3
        pos = struct.pack('<%df' % len(c["positions"]), *c["positions"])
        tuv = transform_uvs(c["uvs"])
        uv = struct.pack('<%df' % len(tuv), *tuv)
        ind = struct.pack('<%dI' % len(c["indices"]), *c["indices"])

        pv = add_view(pos, TARGET_ARRAY)
        xs = c["positions"][0::3]; ys = c["positions"][1::3]; zs = c["positions"][2::3]
        accessors.append({"bufferView": pv, "componentType": COMP_FLOAT, "count": nv,
                          "type": "VEC3",
                          "min": [min(xs), min(ys), min(zs)],
                          "max": [max(xs), max(ys), max(zs)]})
        a_pos = len(accessors) - 1

        uvv = add_view(uv, TARGET_ARRAY)
        accessors.append({"bufferView": uvv, "componentType": COMP_FLOAT,
                          "count": nv, "type": "VEC2"})
        a_uv = len(accessors) - 1

        iv = add_view(ind, TARGET_ELEMENT)
        accessors.append({"bufferView": iv, "componentType": COMP_UINT,
                          "count": len(c["indices"]), "type": "SCALAR"})
        a_idx = len(accessors) - 1

        mat = tex_index.get(norm_texname(c["texture"]), 0) if tex_list else None
        prim = {"attributes": {"POSITION": a_pos, "TEXCOORD_0": a_uv},
                "indices": a_idx, "mode": 4}
        if mat is not None:
            prim["material"] = mat
        primitives.append(prim)

    bin_data = b''.join(bin_parts)
    gltf = {
        "asset": {"version": "2.0", "generator": "mpd dam2mesh"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        # Matterport: Y-up wie glTF -> keine Rotation nötig
        "nodes": [{"mesh": 0, "name": "dollhouse"}],
        "meshes": [{"primitives": primitives}],
        "buffers": [{"byteLength": len(bin_data)}],
        "bufferViews": bufferViews,
        "accessors": accessors,
    }
    if tex_list:
        gltf.update({"images": images, "samplers": samplers,
                     "textures": textures, "materials": materials})

    json_bytes = json.dumps(gltf, separators=(',', ':')).encode()
    json_bytes += b' ' * (align4(len(json_bytes)) - len(json_bytes))
    bin_pad = bin_data + b'\x00' * (align4(len(bin_data)) - len(bin_data))

    total = 12 + 8 + len(json_bytes) + 8 + len(bin_pad)
    out = bytearray()
    out += struct.pack('<III', 0x46546C67, 2, total)
    out += struct.pack('<II', len(json_bytes), 0x4E4F534A) + json_bytes
    out += struct.pack('<II', len(bin_pad), 0x004E4942) + bin_pad
    return bytes(out)


def reorient_outward(chunks, sweeps):
    """Vereinheitlicht die Dreiecks-Wicklung: alle Normalen zeigen von den
    Räumen weg (auswärts), Referenz ist der nächstgelegene Sweep. Erst dadurch
    funktioniert das sichtabhängige Wände-Ausblenden (BackSide) im Viewer.
    sweeps: Liste (x,y,z) im ROHEN Modelraum (wie die .dam-Positionen)."""
    if not sweeps:
        return 0
    flipped = 0
    for c in chunks:
        p = c["positions"]; idx = list(c["indices"])
        for t in range(0, len(idx) - 2, 3):
            a, b, d = idx[t], idx[t + 1], idx[t + 2]
            ax, ay, az = p[a*3], p[a*3+1], p[a*3+2]
            bx, by, bz = p[b*3], p[b*3+1], p[b*3+2]
            dx, dy, dz = p[d*3], p[d*3+1], p[d*3+2]
            ux, uy, uz = bx-ax, by-ay, bz-az
            vx, vy, vz = dx-ax, dy-ay, dz-az
            nx = uy*vz - uz*vy; ny = uz*vx - ux*vz; nz = ux*vy - uy*vx
            tx, ty, tz = (ax+bx+dx)/3, (ay+by+dy)/3, (az+bz+dz)/3
            # nächster Sweep
            best = None; bd = 1e30
            for sx, sy, sz in sweeps:
                dd = (sx-tx)**2 + (sy-ty)**2 + (sz-tz)**2
                if dd < bd: bd = dd; best = (sx, sy, sz)
            ox, oy, oz = tx-best[0], ty-best[1], tz-best[2]  # weg vom Raum = auswärts
            if nx*ox + ny*oy + nz*oz < 0:   # Normale zeigt zum Raum -> umdrehen
                idx[t+1], idx[t+2] = idx[t+2], idx[t+1]
                flipped += 1
        c["indices"] = idx
    return flipped


def load_sweeps(mesh_dir):
    """Sweep-Positionen (roh) aus ../model.json lesen, falls vorhanden."""
    mj = os.path.join(os.path.dirname(mesh_dir), "model.json")
    if not os.path.exists(mj):
        return []
    m = json.load(open(mj))
    # model.json-Positionen liegen im selben ROHEN Modelraum wie die .dam-Vertices.
    out = []
    for s in m.get("sweeps", []):
        pos = s.get("panoPosition") or s.get("position")
        if pos:
            out.append((pos["x"], pos["y"], pos["z"]))
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    arg = sys.argv[1]
    if os.path.isfile(arg):
        dam_path = arg
    else:  # als Modell-ID interpretieren
        mesh_dir = os.path.join("model", arg, "mesh")
        cand = [f for f in os.listdir(mesh_dir) if f.endswith(".dam")] if os.path.isdir(mesh_dir) else []
        # niedrig aufgelöstes (50k) bevorzugen fürs Dollhouse
        cand.sort(key=lambda f: (("50k" not in f), f))
        if not cand:
            print("Keine .dam-Datei gefunden unter", mesh_dir); sys.exit(1)
        dam_path = os.path.join(mesh_dir, cand[0])

    mesh_dir = os.path.dirname(dam_path)
    print(f"Dekodiere {dam_path} …")
    data = open(dam_path, 'rb').read()
    chunks = decode_dam(data)
    nverts = sum(len(c["positions"]) // 3 for c in chunks)
    ntris = sum(len(c["indices"]) // 3 for c in chunks)
    textures = [c["texture"] for c in chunks if c["texture"]]
    print(f"  {len(chunks)} Chunks, {nverts} Vertices, {ntris} Dreiecke, "
          f"{len(set(textures))} Texturen.")

    sweeps = load_sweeps(mesh_dir)
    if sweeps:
        flipped = reorient_outward(chunks, sweeps)
        print(f"  Wicklung vereinheitlicht (auswärts): {flipped}/{ntris} Dreiecke gedreht.")

    glb = build_glb(chunks, textures)
    out_path = os.path.join(mesh_dir, "dollhouse.glb")
    with open(out_path, 'wb') as f:
        f.write(glb)
    print(f"  -> {out_path} ({len(glb)//1024} KB)")
    missing = [norm_texname(t) for t in set(textures)
               if not os.path.exists(os.path.join(mesh_dir, norm_texname(t)))]
    if missing:
        print(f"  ! Fehlende Texturdateien im Ordner: {missing[:3]} …"
              f"  (mit download.py --mesh laden)")


if __name__ == "__main__":
    main()
