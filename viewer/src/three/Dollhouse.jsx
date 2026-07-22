import React, { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh'
import { useStore } from '../store.js'
import { dollhouse } from './shared.js'

// BVH für schnelle Sichtlinien-Raycasts (Etagenzuordnung)
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
THREE.Mesh.prototype.raycast = acceleratedRaycast

// Textured Dollhouse-Mesh.
//
// Das Matterport-Mesh ist NICHT nach Etagen gruppiert, sondern in ~9 Chunks
// pro TEXTUR — jeder Chunk erstreckt sich über ALLE Etagen. Deshalb wird pro
// DREIECK zugeordnet: das Dreieck gehört zu der Etage des nächsten Sweeps, den
// es OHNE Hindernis „sieht" (Sichtlinie nicht durch Wand/Decke blockiert). So
// wird die Decke eines Raums nicht dem Sweep der Etage darüber zugeordnet, nur
// weil der geometrisch näher (durch die Decke hindurch) liegt.
//
// Decken werden entfernt (nach oben offen), Texturen unlit (vorbeleuchtet).
const K = 14 // Anzahl nächster Sweeps, die per Sichtlinie geprüft werden

export default function Dollhouse({ mode, floor }) {
  const model = useStore((s) => s.model)
  const showAll = useStore((s) => s.showAllFloors)
  const gltf = useGLTF(model.meshUrl)

  const { group, floorMeshes } = useMemo(() => {
    const src = gltf.scene.clone(true)
    src.rotation.x = -Math.PI / 2 // Z-up -> Y-up
    src.updateMatrixWorld(true)

    const nFloor = model.floors.length
    const sw = model.validSweeps
    const N = sw.length
    const SX = new Float32Array(N), SY = new Float32Array(N), SZ = new Float32Array(N), SF = new Int32Array(N)
    sw.forEach((s, i) => { const p = s.panoPosition; SX[i] = p.x; SY[i] = p.y; SZ[i] = p.z; SF[i] = s.floor })

    const chunks = []
    src.traverse((o) => { if (o.isMesh) chunks.push(o) })

    // Pass 1: alle Dreiecke in Weltraum sammeln (Positionen für BVH + je-Dreieck
    // Zentrum/UV/Textur zum späteren Einsortieren).
    let total = 0
    for (const o of chunks) { const g = o.geometry; total += (g.index ? g.index.count : g.getAttribute('position').count) / 3 }
    const TP = new Float32Array(total * 9)   // a,b,c (Weltraum, Originalwicklung)
    const TUV = new Float32Array(total * 6)
    const TTEX = new Int32Array(total)
    const CX = new Float32Array(total), CY = new Float32Array(total), CZ = new Float32Array(total)
    const maps = []; const mapIndex = new Map()
    const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3()
    let t = 0
    for (const o of chunks) {
      const geo = o.geometry
      const pos = geo.getAttribute('position'); const uv = geo.getAttribute('uv')
      const index = geo.index; const mw = o.matrixWorld
      const map = o.material.map
      if (map) map.colorSpace = THREE.SRGBColorSpace
      let mi = mapIndex.get(map ? map.uuid : 'none')
      if (mi === undefined) { mi = maps.length; maps.push(map); mapIndex.set(map ? map.uuid : 'none', mi) }
      const ntri = index ? index.count / 3 : pos.count / 3
      for (let k = 0; k < ntri; k++) {
        const ia = index ? index.getX(k * 3) : k * 3
        const ib = index ? index.getX(k * 3 + 1) : k * 3 + 1
        const ic = index ? index.getX(k * 3 + 2) : k * 3 + 2
        _a.fromBufferAttribute(pos, ia).applyMatrix4(mw)
        _b.fromBufferAttribute(pos, ib).applyMatrix4(mw)
        _c.fromBufferAttribute(pos, ic).applyMatrix4(mw)
        const o9 = t * 9
        TP[o9] = _a.x; TP[o9 + 1] = _a.y; TP[o9 + 2] = _a.z
        TP[o9 + 3] = _b.x; TP[o9 + 4] = _b.y; TP[o9 + 5] = _b.z
        TP[o9 + 6] = _c.x; TP[o9 + 7] = _c.y; TP[o9 + 8] = _c.z
        const o6 = t * 6
        if (uv) {
          TUV[o6] = uv.getX(ia); TUV[o6 + 1] = uv.getY(ia)
          TUV[o6 + 2] = uv.getX(ib); TUV[o6 + 3] = uv.getY(ib)
          TUV[o6 + 4] = uv.getX(ic); TUV[o6 + 5] = uv.getY(ic)
        }
        TTEX[t] = mi
        CX[t] = (_a.x + _b.x + _c.x) / 3; CY[t] = (_a.y + _b.y + _c.y) / 3; CZ[t] = (_a.z + _b.z + _c.z) / 3
        t++
      }
    }

    // BVH über das gesamte Mesh für Sichtlinien-Tests
    const losGeo = new THREE.BufferGeometry()
    losGeo.setAttribute('position', new THREE.BufferAttribute(TP, 3))
    losGeo.computeBoundsTree()
    const losMesh = new THREE.Mesh(losGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    const ray = new THREE.Raycaster(); ray.firstHitOnly = true
    const _o = new THREE.Vector3(), _d = new THREE.Vector3()
    const cand = new Int32Array(K), candD = new Float32Array(K)

    // Etagen eines Dreiecks = ALLE Etagen, von denen aus es ein Sweep OHNE
    // Hindernis sieht (freie Sichtlinie). Besonderheit: sieht man es von zwei
    // Etagen (z.B. Treppenhaus-/Luftraum-Wand), gehört es zu BEIDEN. Ergebnis
    // als Bitmaske; Rückfall auf den geometrisch nächsten, wenn keiner frei ist.
    const floorsMaskOfTri = (cx, cy, cz) => {
      for (let j = 0; j < K; j++) candD[j] = Infinity
      for (let i = 0; i < N; i++) {
        const dx = SX[i] - cx, dy = SY[i] - cy, dz = SZ[i] - cz
        const d = dx * dx + dy * dy + dz * dz
        if (d < candD[K - 1]) {
          let j = K - 1
          while (j > 0 && candD[j - 1] > d) { candD[j] = candD[j - 1]; cand[j] = cand[j - 1]; j-- }
          candD[j] = d; cand[j] = i
        }
      }
      let mask = 0
      for (let k = 0; k < K; k++) {
        if (candD[k] === Infinity) break
        const i = cand[k], f = SF[i]
        if (mask & (1 << f)) continue // diese Etage schon bestätigt
        const dist = Math.sqrt(candD[k])
        _d.set((SX[i] - cx) / dist, (SY[i] - cy) / dist, (SZ[i] - cz) / dist)
        _o.set(cx + _d.x * 0.06, cy + _d.y * 0.06, cz + _d.z * 0.06)
        ray.set(_o, _d); ray.near = 0; ray.far = dist - 0.14
        if (ray.intersectObject(losMesh, false).length === 0) mask |= (1 << f) // freie Sicht
      }
      return mask || (1 << SF[cand[0]]) // Rückfall: geometrisch nächster
    }

    // Pass 2: pro (sichtbarer) Etage nach Textur einsortieren. Ein von zwei
    // Etagen sichtbares Dreieck wird in BEIDE einsortiert.
    const perFloor = Array.from({ length: nFloor }, () => new Map()) // texIndex -> {pos:[],uv:[]}
    for (let i = 0; i < total; i++) {
      const mask = floorsMaskOfTri(CX[i], CY[i], CZ[i])
      const mi = TTEX[i]
      const p = i * 9, u = i * 6
      for (let f = 0; f < nFloor; f++) {
        if (!(mask & (1 << f))) continue
        let bucket = perFloor[f].get(mi)
        if (!bucket) { bucket = { pos: [], uv: [] }; perFloor[f].set(mi, bucket) }
        bucket.pos.push(TP[p], TP[p + 1], TP[p + 2], TP[p + 6], TP[p + 7], TP[p + 8], TP[p + 3], TP[p + 4], TP[p + 5])
        bucket.uv.push(TUV[u], TUV[u + 1], TUV[u + 4], TUV[u + 5], TUV[u + 2], TUV[u + 3])
      }
    }
    losGeo.disposeBoundsTree()

    const group = new THREE.Group()
    const floorMeshes = []
    for (let f = 0; f < nFloor; f++) {
      for (const [mi, b] of perFloor[f]) {
        if (!b.pos.length) continue
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
        if (b.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2))
        const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: maps[mi], side: THREE.FrontSide }))
        mesh.userData.floor = f
        group.add(mesh)
        floorMeshes.push({ mesh, floor: f, geo: g })
      }
    }
    return { group, floorMeshes }
  }, [gltf, model])

  useEffect(() => { dollhouse.group = group; return () => { if (dollhouse.group === group) dollhouse.group = null } }, [group])

  useEffect(() => {
    // Aktive Etage opak, alle anderen (darunter UND darüber) schwach
    // halbtransparent. showAll: alle Etagen voll sichtbar.
    for (const { mesh, floor: mfl } of floorMeshes) {
      const active = showAll || mfl === floor
      mesh.visible = true
      const wasTransparent = mesh.material.transparent
      mesh.material.transparent = !active
      mesh.material.opacity = active ? 1 : 0.14
      mesh.material.depthWrite = active
      mesh.renderOrder = active ? 0 : 1
      // transparent-Flag-Wechsel erfordert Shader-Neubau, sonst bleibt es opak
      if (wasTransparent !== mesh.material.transparent) mesh.material.needsUpdate = true
    }
  }, [floor, floorMeshes, showAll])

  return <primitive object={group} />
}
