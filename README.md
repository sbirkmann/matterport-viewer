# MPD — Matterport Downloader & Viewer

Lädt öffentliche Matterport-Touren vollständig herunter und zeigt sie in einem
eigenen, wiederverwendbaren React/Three.js-Viewer an — inklusive Panorama-
Rundgang, texturiertem **Dollhouse-3D-Mesh**, Grundriss, Etagenauswahl,
Navigationspunkten auf dem Boden und 3D-Messwerkzeug.

Der Viewer ist **modell-agnostisch**: alle Daten liegen lokal unter
`model/<id>/`, der Viewer wird nur mit der ID aufgerufen (`?id=<id>`).

Beispiel-Tour: Schloss Elgersburg – Hotel (`m=fxbHRAB3nuY`).

---

## Schnellstart

```bash
# 1) Tour herunterladen + Dollhouse-Mesh konvertieren  ->  model/<id>/
./fetch.sh fxbHRAB3nuY

# 2) Viewer starten
cd viewer && npm install && npm run dev
# öffnen:  http://localhost:5173/?id=fxbHRAB3nuY
```

Voraussetzungen: `python3` (nur Standardbibliothek), `node`/`npm`, optional
`ffmpeg` (für equirektangulares Stitching).

---

## Komponenten

| Datei          | Aufgabe |
|----------------|---------|
| `download.py`  | GraphQL-Metadaten + Skyboxen (6 Cube-Faces/Punkt) + Dollhouse-Mesh (`.dam`) + Texturen → `model/<id>/` |
| `dam2mesh.py`  | Dekodiert das proprietäre `.dam`-Mesh → `dollhouse.glb` (glTF, texturiert) |
| `stitch.py`    | Optional: 6 Cube-Faces → equirektangulares 360°-Bild (`ffmpeg v360`) |
| `fetch.sh`     | One-Shot: download → dam2mesh (→ optional stitch) |
| `viewer/`      | React + Vite + three/@react-three/fiber Viewer, lädt `model/<id>` dynamisch |

### Datenablage `model/<id>/`

```
model.json            kompakt: Sweeps, Etagen, Positionen, Nachbar-Graph, Skybox-URLs
model.raw.json        vollständige GraphQL-Rohantwort
thumb.jpg             Vorschaubild
pano/<uuid>/faceN.jpg 6 Cubemap-Flächen je Aufnahmepunkt (N=0..5)
pano/<uuid>/equi.jpg  (optional) gestitchtes 360°-Bild
mesh/*.dam            Rohmesh   |   mesh/dollhouse.glb  konvertiert   |   mesh/tex_NNN.jpg
```

---

## Reverse-Engineering (Kurzfassung)

Alles wurde aus der öffentlichen Matterport-Showcase abgeleitet — es werden nur
bereits im Player geladene, öffentliche Assets abgerufen.

- **Metadaten**: `POST https://my.matterport.com/api/mp/models/graph` mit der
  rekonstruierten Query `GetModelPrefetch` (voller Query-Text, keine Auth für
  öffentliche Modelle). Liefert Sweeps mit `position`, `rotation` (Quaternion),
  `neighbors`, `floor`, `sweepUuid` und Skybox-/Mesh-Asset-URLs (signiert).
- **Panoramen**: pro Sweep 6 Skybox-Flächen `pan/high/~/<uuid>_skybox<face>.jpg`.
- **Dollhouse-Mesh** (`.dam`): **Protobuf-Container** aus wiederholten Chunks.
  Pro Chunk: `f1.f1` = Positionen (`float32` xyz), `f1.f2` = UVs (`float32`),
  `f2` = Indizes (**varint**, je 3 = Dreieck), `f3` = Name, `f4` = Texturdatei.
  → siehe Kommentar in [`dam2mesh.py`](dam2mesh.py).

### Wichtig: Koordinatensystem

Matterport arbeitet **Z-up**. Der Viewer rechnet global nach Y-up um:
`(x, y, z) → (x, z, −y)` (= `R_x(−90°)`). Das gilt für Sweep-Positionen, das
Mesh und die Panorama-Ausrichtung — nur so passen Mesh, Punkte und Bild zusammen.

### Panorama-Ausrichtung

Die 6 Faces werden als `THREE.CubeTexture` (`scene.background`) gerendert
(korrekte Innenansicht ohne manuelles Spiegeln). Die Face-Zuordnung wurde per
**Kantenabgleich** der Bilder deterministisch bestimmt:
`[px,nx,py,ny,pz,nz] = Faces [2,4,0,5,1,3]` (f0=oben, f5=unten, Ring f1→f2→f3→f4).
Das Heading kommt aus dem Sweep-Quaternion (Drehung um die Hochachse) und ist
damit **deckungsgleich mit dem Mesh**.

---

## Viewer-Funktionen

- **Rundgang** – 360°-Panorama, Umsehen per Drag, Zoom per Mausrad. Ein
  unsichtbares, deckungsgleiches Mesh dient als Raycast-Fläche: der Cursor
  (Reticle) liegt immer auf der Oberfläche und richtet sich nach deren Normale.
  Klick auf Boden/Punkt → Animation zum nächstgelegenen Aufnahmepunkt.
  Aufnahmepunkte der Etage liegen als Ringe am Boden und werden hinter Wänden
  verdeckt.
- **Dollhouse** – texturiertes 3D-Modell. Dem Betrachter zugewandte Wände werden
  ausgeblendet (Reinschauen), aktive Etage opak, übrige halbtransparent.
  Doppelklick → Fly-in in den Rundgang.
- **Grundriss** – Draufsicht der aktiven Etage (Decke aufgeschnitten).
- **Etagenauswahl**, **Messwerkzeug** (zwei Punkte auf dem Mesh → Distanz in m).

---

## Deployment

Enthält `Dockerfile` + `deploy/nginx.conf`: baut den Viewer (Vite) und liefert
den statischen Build **plus die Modelldaten** (`/model`) über nginx aus.

```bash
docker build -t mpd .
docker run -p 8080:80 mpd        # http://localhost:8080/?id=fxbHRAB3nuY
```

Ohne `?id` wird das Standard-Demo-Modell geladen. Für Coolify/Git-Deploy einfach
das Repo verbinden (Build-Pack: Dockerfile, Port 80).

## Andere Modelle

```bash
./fetch.sh <MODEL_ID>
# Viewer:  http://localhost:5173/?id=<MODEL_ID>
```

Der Viewer liest ausschließlich `model/<id>/` — keine Codeänderung nötig.

> Hinweis: Es werden nur öffentliche Touren unterstützt. Signierte Asset-URLs
> sind zeitlich begrenzt gültig; der Download muss vor Ablauf erfolgen.
