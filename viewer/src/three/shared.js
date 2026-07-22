import * as THREE from 'three'

// Geteilter Zustand für Raycasting gegen das (unsichtbare) Mesh.
export const collider = { geometry: null, object: null }

// Dollhouse-Gruppe (pro-Etage-Meshes mit userData.floor) für Klick-Auswahl.
export const dollhouse = { group: null }

// Reusable Objekte
export const _ray = new THREE.Raycaster()
export const _v2 = new THREE.Vector2()

// Zustand für die Lupe (vom Messwerkzeug geschrieben, von der Lupe gelesen).
export const measureState = { x: 0, y: 0, snap: null, active: false }

// Snapping: Treffer auf nächste Ecke (Vertex) oder Kante des Meshes ziehen.
// Schwellen in Bildschirm-Pixeln -> funktioniert in jeder Entfernung.
const _va = new THREE.Vector3(); const _vb = new THREE.Vector3(); const _vc = new THREE.Vector3()
const _cp = new THREE.Vector3(); const _pp = new THREE.Vector3()
function _toPx(v, camera, w, h) {
  _pp.copy(v).project(camera)
  return [(_pp.x * 0.5 + 0.5) * w, (-_pp.y * 0.5 + 0.5) * h]
}
function _closestOnSeg(p, a, b, out) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z
  const t = Math.max(0, Math.min(1,
    ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) /
    (abx * abx + aby * aby + abz * abz || 1)))
  return out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t)
}
export function snapHit(hit, camera, px, py, w, h) {
  if (!hit || !hit.face) return { point: hit ? hit.point.clone() : null, type: 'surface' }
  const geo = hit.object.geometry
  const pos = geo.getAttribute('position')
  const m = hit.object.matrixWorld
  _va.fromBufferAttribute(pos, hit.face.a).applyMatrix4(m)
  _vb.fromBufferAttribute(pos, hit.face.b).applyMatrix4(m)
  _vc.fromBufferAttribute(pos, hit.face.c).applyMatrix4(m)
  const verts = [_va, _vb, _vc]
  // Ecke
  let bc = Infinity, bcv = null
  for (const v of verts) {
    const [sx, sy] = _toPx(v, camera, w, h)
    const d = Math.hypot(sx - px, sy - py)
    if (d < bc) { bc = d; bcv = v }
  }
  if (bc < 26) return { point: bcv.clone(), type: 'corner' }
  // Kante
  let be = Infinity, bev = null
  for (let i = 0; i < 3; i++) {
    _closestOnSeg(hit.point, verts[i], verts[(i + 1) % 3], _cp)
    const [sx, sy] = _toPx(_cp, camera, w, h)
    const d = Math.hypot(sx - px, sy - py)
    if (d < be) { be = d; bev = _cp.clone() }
  }
  if (be < 16) return { point: bev, type: 'edge' }
  return { point: hit.point.clone(), type: 'surface' }
}

// UV-Transformation live testen (Ergebnis wird später in dam2mesh gebacken).
export function applyUV(geo, mode) {
  if (!mode || mode === 'none') return geo
  const src = geo.getAttribute('uv')
  if (!src) return geo
  const g = geo.clone()
  const a = src.clone()
  for (let i = 0; i < a.count; i++) {
    let u = a.getX(i), v = a.getY(i)
    if (mode === 'swap') { const t = u; u = v; v = t }
    else if (mode === 'rot90') { const t = u; u = v; v = 1 - t }
    else if (mode === 'rot270') { const t = u; u = 1 - v; v = t }
    else if (mode === 'rot180') { u = 1 - u; v = 1 - v }
    else if (mode === 'flipv') { v = 1 - v }
    else if (mode === 'fliph') { u = 1 - u }
    a.setXY(i, u, v)
  }
  g.setAttribute('uv', a)
  return g
}

// Cursor -> Weltpunkt auf dem Mesh (Matterport-Prinzip: Cursor liegt auf Fläche).
// pointer: {x,y} in NDC [-1..1]; camera aus useThree.
export function raycastMesh(pointer, camera) {
  if (!collider.object) return null
  _ray.setFromCamera(pointer, camera)
  const hits = _ray.intersectObject(collider.object, true)
  return hits.length ? hits[0] : null
}

