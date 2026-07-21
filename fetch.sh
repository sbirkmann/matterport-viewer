#!/usr/bin/env bash
# Komplett-Pipeline: Matterport-Tour laden + Dollhouse-Mesh konvertieren.
#
#   ./fetch.sh <MODEL_ID> [--res high|2k|low] [--stitch]
#
# Ergebnis liegt unter model/<MODEL_ID>/ und ist direkt im Viewer nutzbar.
set -euo pipefail
cd "$(dirname "$0")"

ID="${1:-}"
if [[ -z "$ID" ]]; then echo "Nutzung: ./fetch.sh <MODEL_ID> [--res high|2k|low] [--stitch]"; exit 1; fi
shift || true

RES="high"; STITCH=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --res) RES="$2"; shift 2;;
    --stitch) STITCH=1; shift;;
    *) echo "unbekannt: $1"; exit 1;;
  esac
done

echo "==> [1] Download (Skyboxen + Mesh + Texturen)"
python3 download.py "$ID" --res "$RES" --mesh

echo "==> [2] Dollhouse-Mesh .dam -> dollhouse.glb"
python3 dam2mesh.py "$ID" || echo "  (Mesh-Konvertierung übersprungen)"

if [[ "$STITCH" -eq 1 ]]; then
  echo "==> [3] Equirektangular-Stitching (ffmpeg)"
  python3 stitch.py "$ID" || echo "  (Stitching übersprungen)"
fi

echo "==> Fertig. Daten unter model/$ID/"
echo "    Viewer starten:  cd viewer && npm install && npm run dev"
echo "    dann öffnen:     http://localhost:5173/?id=$ID"
