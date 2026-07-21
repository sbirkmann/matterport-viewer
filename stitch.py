#!/usr/bin/env python3
"""
Skybox -> Equirektangular Stitching (ffmpeg v360)
=================================================

Erzeugt pro Sweep aus den 6 Cubemap-Flächen (face0..face5.jpg) ein
equirektangulares 360°-Panorama ``equi.jpg`` unter ``model/<id>/pano/<uuid>/``.

Der Viewer selbst nutzt die schärferen Cube-Faces direkt; diese Funktion ist
für Export / Weiterverwendung (z.B. andere 360°-Player) gedacht.

Benötigt ffmpeg mit v360-Filter.

Nutzung:  python3 stitch.py <id> [--size 4096]
"""
import argparse
import os
import subprocess
import sys

# Reihenfolge/Orientierung der Matterport-Faces -> ffmpeg cubemap "6x1" (rludfb).
# Ermittelt durch visuellen Abgleich im Viewer:
#   face0=back(-Z) face1=? ...  ffmpeg-Eingangsreihenfolge via in_forder/in_frot.
# Matterport-Face-Index -> Position im 6x1-Streifen  [right,left,up,down,front,back]
FACE_ORDER = [1, 0, 2, 3, 5, 4]   # right,left,up,down,front,back  = mp faces
# Rotation je Streifenposition (Grad), falls Faces gedreht vorliegen
IN_FROT = "0 0 0 0 0 0"


def stitch_one(face_dir, out, size):
    faces = [os.path.join(face_dir, f"face{i}.jpg") for i in range(6)]
    if not all(os.path.exists(f) for f in faces):
        return False
    ordered = [faces[i] for i in FACE_ORDER]
    inputs = []
    for f in ordered:
        inputs += ["-i", f]
    # 6 Faces horizontal aneinander -> v360 c6x1 -> equirectangular
    fc = ("[0][1][2][3][4][5]hstack=inputs=6[cube];"
          f"[cube]v360=c6x1:e:in_frot='{IN_FROT}':w={size}:h={size//2}[o]")
    cmd = ["ffmpeg", "-y", "-loglevel", "error", *inputs,
           "-filter_complex", fc, "-map", "[o]", "-q:v", "3", out]
    return subprocess.run(cmd).returncode == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model_id")
    ap.add_argument("--size", type=int, default=4096)
    ap.add_argument("--out", default="model")
    args = ap.parse_args()
    pano = os.path.join(args.out, args.model_id, "pano")
    if not os.path.isdir(pano):
        print("Kein pano-Ordner:", pano); sys.exit(1)
    dirs = [d for d in os.listdir(pano) if os.path.isdir(os.path.join(pano, d))]
    ok = 0
    for i, d in enumerate(dirs, 1):
        fd = os.path.join(pano, d)
        out = os.path.join(fd, "equi.jpg")
        if os.path.exists(out):
            ok += 1; continue
        if stitch_one(fd, out, args.size):
            ok += 1
        print(f"\r  {i}/{len(dirs)} gestitcht", end="", flush=True)
    print(f"\n{ok}/{len(dirs)} Panoramen erzeugt.")


if __name__ == "__main__":
    main()
