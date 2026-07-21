#!/usr/bin/env python3
"""
Matterport Tour Downloader
==========================

Lädt eine öffentliche Matterport-Tour komplett herunter und speichert alle
Assets unter ``model/<id>/`` in einem eigenen, offline nutzbaren Format:

    model/<id>/
        model.json            kompakte Beschreibung: Sweeps, Etagen, Positionen,
                              Nachbar-Graph, Panorama-URLs (Template)
        model.raw.json        vollständige GraphQL-Antwort (Rohdaten)
        thumb.jpg             Vorschaubild
        pano/<sweepUuid>/
            face0.jpg .. face5.jpg   die 6 Cubemap-Flächen (Skybox)
            equi.jpg                 (optional) equirektangulär gestitcht (stitch.py)
        mesh/                 Dollhouse-Mesh (.dam) + Texturen  (best effort)

Nutzung:
    python3 download.py <MODEL_ID> [--res high|2k|low] [--mesh] [--jobs N]

Beispiel (Schloss Elgersburg):
    python3 download.py fxbHRAB3nuY

Es werden nur öffentliche, bereits im Player geladene Assets abgerufen.
"""

import argparse
import concurrent.futures as cf
import json
import os
import sys
import urllib.request
import urllib.error

GRAPH_URL = "https://my.matterport.com/api/mp/models/graph"
REFERER = "https://my.matterport.com/"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# Vollständige Query, aus MP_PREFETCHED_MODELDATA / GetModelPrefetch rekonstruiert.
# Der öffentliche Endpoint akzeptiert den kompletten Query-Text ohne Auth.
QUERY = """
query GetModelPrefetch($id: ID!) {
  model(id: $id) {
    id
    rootModelId
    state
    locations {
      id
      index
      floor { id }
      room { id }
      neighbors
      position { x y z }
      pano {
        id
        sweepUuid
        label
        placement
        source
        position { x y z }
        rotation { x y z w }
        resolutions
        skyboxes {
          resolution
          status
          tileResolution
          tileCount
          tileUrlTemplate
          urlTemplate
        }
      }
    }
    assets {
      meshes   { id filename format resolution url }
      textures { id format resolution quality urlTemplate }
      tilesets { id }
      floorplans { format width height resolution url origin { x y } floor { id } }
    }
  }
}
"""

# Zusatz-Query für Anzeigenamen der Tour (best effort, darf fehlschlagen)
NAME_QUERY = "query N($id: ID!){ model(id:$id){ name description } }"


def graphql(query, variables):
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(
        GRAPH_URL, data=body,
        headers={"content-type": "application/json",
                 "user-agent": UA, "referer": REFERER},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def fetch(url, dest, referer=True):
    """Lädt url nach dest, überspringt vorhandene Dateien. Gibt True/False zurück."""
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return True
    headers = {"user-agent": UA}
    if referer:
        headers["referer"] = REFERER
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
        tmp = dest + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, dest)
        return True
    except urllib.error.HTTPError as e:
        print(f"  ! {e.code} {os.path.basename(dest)}  ({url.split('?')[0]})")
        return False
    except Exception as e:  # noqa
        print(f"  ! FEHLER {os.path.basename(dest)}: {e}")
        return False


def pick_skybox(pano, res):
    boxes = {s["resolution"]: s for s in pano.get("skyboxes") or []}
    order = [res, "high", "2k", "low"]
    for r in order:
        s = boxes.get(r)
        if s and s.get("status") == "available" and s.get("urlTemplate"):
            return s
    return None


def main():
    ap = argparse.ArgumentParser(description="Matterport Tour Downloader")
    ap.add_argument("model_id")
    ap.add_argument("--res", default="high", choices=["high", "2k", "low"],
                    help="Skybox-Auflösung (Standard: high)")
    ap.add_argument("--mesh", action="store_true",
                    help="Dollhouse-Mesh (.dam) + Texturen mit herunterladen (best effort)")
    ap.add_argument("--jobs", type=int, default=8, help="parallele Downloads")
    ap.add_argument("--out", default="model", help="Zielordner-Basis")
    args = ap.parse_args()

    mid = args.model_id
    base = os.path.join(args.out, mid)
    pano_dir = os.path.join(base, "pano")
    os.makedirs(pano_dir, exist_ok=True)

    print(f"[1/4] Lade Modell-Metadaten für {mid} …")
    resp = graphql(QUERY, {"id": mid})
    if resp.get("errors"):
        print("GraphQL-Fehler:", json.dumps(resp["errors"], indent=2))
        if not resp.get("data"):
            sys.exit(1)
    model = resp["data"]["model"]
    if not model:
        print("Kein Modell gefunden (privat oder falsche ID).")
        sys.exit(1)

    # Rohdaten sichern
    with open(os.path.join(base, "model.raw.json"), "w") as f:
        json.dump(resp, f, indent=1)

    # Anzeigename (best effort)
    name = mid
    try:
        nr = graphql(NAME_QUERY, {"id": mid})
        name = (nr.get("data", {}).get("model") or {}).get("name") or mid
    except Exception:
        pass

    locations = model["locations"]
    print(f"       {len(locations)} Sweeps gefunden.")

    # Etagen anhand distinkter floor-ids + mittlerer Höhe ordnen
    floors = {}
    for loc in locations:
        fid = (loc.get("floor") or {}).get("id") or "unknown"
        floors.setdefault(fid, []).append(loc["position"]["y"])
    floor_order = sorted(floors, key=lambda fid: sum(floors[fid]) / len(floors[fid]))
    floor_map = {fid: i for i, fid in enumerate(floor_order)}

    # Kompakte, viewer-freundliche Struktur bauen
    sweeps = []
    for loc in locations:
        pano = loc.get("pano") or {}
        sb = pick_skybox(pano, args.res)
        fid = (loc.get("floor") or {}).get("id") or "unknown"
        sweeps.append({
            "id": loc["id"],
            "index": loc.get("index"),
            "uuid": pano.get("sweepUuid"),
            "floor": floor_map[fid],
            "floorId": fid,
            "room": (loc.get("room") or {}).get("id"),
            "neighbors": loc.get("neighbors") or [],
            "position": loc["position"],
            "panoPosition": pano.get("position") or loc["position"],
            "rotation": pano.get("rotation"),
            "skyboxResolution": sb["resolution"] if sb else None,
            "skyboxTemplate": sb["urlTemplate"] if sb else None,
        })

    # Grundriss-Bilder (colorplan_alpha) je Etage auswählen
    fps = model["assets"].get("floorplans") or []
    alpha = [f for f in fps if "colorplan_alpha_" in (f.get("url") or "")]
    fp_files = {}
    fp_meta = None
    if alpha:
        f0 = alpha[0]
        fp_meta = {"resolution": f0["resolution"], "origin": f0["origin"],
                   "width": f0["width"], "height": f0["height"], "files": {}}
        for f in alpha:
            fid = (f.get("floor") or {}).get("id")
            if fid:
                fp_files[fid] = (f["url"], f"{fid}.png")
                fp_meta["files"][fid] = f"{fid}.png"

    manifest = {
        "id": mid,
        "name": name,
        "floorCount": len(floor_order),
        "floors": [
            {"index": i, "id": fid,
             "elevation": round(sum(floors[fid]) / len(floors[fid]), 3),
             "sweepCount": len(floors[fid])}
            for i, fid in enumerate(floor_order)
        ],
        "sweeps": sweeps,
        "floorplan": fp_meta,
        "mesh": {
            "meshes": model["assets"]["meshes"],
            "textures": model["assets"]["textures"],
        },
    }
    with open(os.path.join(base, "model.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"       Etagen: {len(floor_order)} | model.json geschrieben.")

    # Thumbnail
    fetch(f"https://my.matterport.com/api/v1/player/models/{mid}/thumb",
          os.path.join(base, "thumb.jpg"))

    # Grundriss-Bilder
    if fp_files:
        fpdir = os.path.join(base, "floorplan")
        os.makedirs(fpdir, exist_ok=True)
        for fid, (url, fname) in fp_files.items():
            fetch(url, os.path.join(fpdir, fname))
        print(f"       {len(fp_files)} Grundriss-Bilder geladen.")

    # Skybox-Flächen sammeln
    tasks = []  # (url, dest)
    for sw in sweeps:
        if not sw["skyboxTemplate"] or not sw["uuid"]:
            continue
        d = os.path.join(pano_dir, sw["uuid"])
        os.makedirs(d, exist_ok=True)
        for face in range(6):
            url = sw["skyboxTemplate"].replace("<face>", str(face))
            tasks.append((url, os.path.join(d, f"face{face}.jpg")))

    print(f"[2/4] Lade {len(tasks)} Skybox-Flächen (Auflösung: {args.res}) …")
    ok = 0
    with cf.ThreadPoolExecutor(max_workers=args.jobs) as ex:
        for r in ex.map(lambda t: fetch(*t), tasks):
            ok += bool(r)
    print(f"       {ok}/{len(tasks)} Flächen geladen.")

    # Mesh (best effort – anonym oft 403)
    if args.mesh:
        print("[3/4] Lade Dollhouse-Mesh + Texturen (best effort) …")
        mdir = os.path.join(base, "mesh")
        os.makedirs(mdir, exist_ok=True)
        for m in model["assets"]["meshes"]:
            if m.get("url") and m.get("filename"):
                fetch(m["url"], os.path.join(mdir, m["filename"]))
        # Texturen des 50k-Dollhouse laden -> tex_000.jpg .. tex_NNN.jpg
        # Der <texture>-Index ist 3-stellig; wir zählen hoch bis der erste fehlt.
        tex = next((t for t in model["assets"]["textures"]
                    if t.get("resolution") == "50k" and t.get("quality") == "high"
                    and t.get("urlTemplate")), None)
        if tex:
            for i in range(64):
                url = tex["urlTemplate"].replace("<texture>", f"{i:03d}")
                dest = os.path.join(mdir, f"tex_{i:03d}.jpg")
                if not fetch(url, dest):
                    break
    else:
        print("[3/4] Mesh übersprungen (--mesh zum Laden; anonym meist 403).")

    print("[4/4] Fertig.")
    print(f"       Panoramen stitchen:  python3 stitch.py {mid}")
    print(f"       Viewer:              http-server starten und viewer/?id={mid} öffnen")


if __name__ == "__main__":
    main()
