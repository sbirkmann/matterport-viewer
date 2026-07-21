// Laden & Aufbereiten der Modelldaten (model/<id>/model.json).

// Standard-Modell (Demo). Über ?id=<MODEL_ID> überschreibbar.
const DEFAULT_MODEL_ID = 'fxbHRAB3nuY'

export function getModelId() {
  const p = new URLSearchParams(location.search)
  return p.get('id') || p.get('m') || DEFAULT_MODEL_ID
}

export function panoBase(id, uuid) {
  return `/model/${id}/pano/${uuid}`
}

// Matterport-Modelraum ist Z-up. Umrechnung nach THREE (Y-up):
//   R_x(-90°):  (x, y, z) -> (x, z, -y)
export function convVec(p) {
  return { x: p.x, y: p.z, z: -p.y }
}

export async function loadModel(id) {
  const res = await fetch(`/model/${id}/model.json`)
  if (!res.ok) throw new Error(`model.json nicht gefunden (HTTP ${res.status})`)
  const model = await res.json()

  // Alle Positionen von Z-up nach Y-up konvertieren
  for (const s of model.sweeps) {
    s.position = convVec(s.position)
    if (s.panoPosition) s.panoPosition = convVec(s.panoPosition)
  }

  // Sweep-Lookup + gültige Sweeps (mit Skybox) filtern
  model.sweepById = {}
  for (const s of model.sweeps) model.sweepById[s.id] = s
  model.validSweeps = model.sweeps.filter((s) => s.uuid && s.skyboxTemplate)

  // Etagen anhand konvertierter Höhe (y) neu berechnen & ordnen
  const groups = {}
  for (const s of model.validSweeps) (groups[s.floorId] ??= []).push(s.position.y)
  const order = Object.keys(groups).sort(
    (a, b) => mean(groups[a]) - mean(groups[b]))
  const floorIndex = {}
  order.forEach((fid, i) => (floorIndex[fid] = i))
  for (const s of model.sweeps) s.floor = floorIndex[s.floorId] ?? 0
  model.floorCount = order.length
  model.floors = order.map((fid, i) => ({
    index: i, id: fid, elevation: mean(groups[fid]), sweepCount: groups[fid].length,
  }))

  model.meshUrl = `/model/${id}/mesh/dollhouse.glb`
  return model
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length

// Höhen-Grenzen zwischen den Etagen (Mittelpunkte). Damit werden Sweeps UND
// Mesh-Chunks nach demselben Kriterium einer Etage zugeordnet.
export function floorBounds(model) {
  const e = model.floors.map((f) => f.elevation)
  const b = []
  for (let i = 0; i < e.length - 1; i++) b.push((e[i] + e[i + 1]) / 2)
  return b
}
export function floorOfY(model, y) {
  let f = 0
  for (const b of floorBounds(model)) if (y > b) f++
  return f
}

// nächster Sweep zu einem Weltpunkt (optional gleiche Etage bevorzugen)
export function nearestSweep(model, point, opts = {}) {
  const { floor = null, exclude = null, maxDist = Infinity } = opts
  let best = null, bestD = Infinity
  for (const s of model.validSweeps) {
    if (exclude && s.id === exclude) continue
    if (floor != null && s.floor !== floor) continue
    const p = s.position
    const dx = p.x - point[0], dy = p.y - point[1], dz = p.z - point[2]
    // Horizontaldistanz stärker gewichten (Etagenwechsel via Boden-Klick)
    const d = Math.sqrt(dx * dx + dz * dz) + Math.abs(dy) * 0.5
    if (d < bestD) { bestD = d; best = s }
  }
  return bestD <= maxDist ? best : best
}
