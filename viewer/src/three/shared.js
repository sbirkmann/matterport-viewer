import * as THREE from 'three'

// Geteilter Zustand für Raycasting gegen das (unsichtbare) Mesh.
export const collider = { geometry: null, object: null }

// Reusable Objekte
export const _ray = new THREE.Raycaster()
export const _v2 = new THREE.Vector2()

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

