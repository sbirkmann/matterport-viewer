import React, { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store.js'
import { floorBounds } from '../data.js'

// Textured Dollhouse-Mesh.
//
// Das Matterport-Mesh ist NICHT nach Etagen gruppiert, sondern in ~9 Chunks
// pro TEXTUR — jeder Chunk erstreckt sich über ALLE Etagen. Deshalb wird pro
// DREIECK zugeordnet: das Dreieck gehört zu der Etage seines nächsten Sweeps
// (die Aufnahmepunkte tragen Matterports echte Etagen-Labels). Das ist
// achsen- und deckenhöhen-unabhängig und funktioniert für jedes Modell.
//
// Decken werden entfernt (nach oben offen), Texturen unlit (vorbeleuchtet).
export default function Dollhouse({ mode, floor }) {
  const model = useStore((s) => s.model)
  const gltf = useGLTF(model.meshUrl)

  const { group, floorMeshes } = useMemo(() => {
    const src = gltf.scene.clone(true)
    src.rotation.x = -Math.PI / 2 // Z-up -> Y-up
    src.updateMatrixWorld(true)

    const nFloor = model.floors.length
    // Etagen-Zuordnung PRO DREIECK über die Höhe (Mittelpunkts-Grenzen zwischen
    // den Etagen-Basishöhen) — dasselbe Kriterium wie für die Sweeps. Da pro
    // Dreieck (nicht pro Textur-Chunk) zugeordnet wird, gibt es keine Bleed.
    const bounds = floorBounds(model)
    const floorOf = (y) => { let f = 0; for (const b of bounds) if (y > b) f++; return f }

    const chunks = []
    src.traverse((o) => { if (o.isMesh) chunks.push(o) })

    // Pro Etage: Positions/UVs (Weltraum, non-indexed) + Textur getrennt sammeln
    const perFloor = Array.from({ length: nFloor }, () => new Map()) // texId -> {pos:[],uv:[],map}
    const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3()

    for (const o of chunks) {
      const geo = o.geometry
      const pos = geo.getAttribute('position')
      const uv = geo.getAttribute('uv')
      const index = geo.index
      const mw = o.matrixWorld
      const map = o.material.map
      if (map) map.colorSpace = THREE.SRGBColorSpace
      const texId = map ? map.uuid : 'none'
      const ntri = index ? index.count / 3 : pos.count / 3
      for (let t = 0; t < ntri; t++) {
        const ia = index ? index.getX(t * 3) : t * 3
        const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1
        const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2
        _a.fromBufferAttribute(pos, ia).applyMatrix4(mw)
        _b.fromBufferAttribute(pos, ib).applyMatrix4(mw)
        _c.fromBufferAttribute(pos, ic).applyMatrix4(mw)
        const cy = (_a.y + _b.y + _c.y) / 3
        const f = floorOf(cy)
        let bucket = perFloor[f].get(texId)
        if (!bucket) { bucket = { pos: [], uv: [], map }; perFloor[f].set(texId, bucket) }
        // Wicklung UMKEHREN (a,c,b): das Mesh ist auswärts gewickelt; gedreht
        // zeigt die Vorderseite nach INNEN (zum Sweep = erfasste Seite). Mit
        // FrontSide wird nur die erfasste Seite gerendert, nie die texturlose
        // Rückseite einer Wand.
        bucket.pos.push(_a.x, _a.y, _a.z, _c.x, _c.y, _c.z, _b.x, _b.y, _b.z)
        if (uv) bucket.uv.push(uv.getX(ia), uv.getY(ia), uv.getX(ic), uv.getY(ic), uv.getX(ib), uv.getY(ib))
      }
    }

    const group = new THREE.Group()
    const floorMeshes = []
    for (let f = 0; f < nFloor; f++) {
      for (const b of perFloor[f].values()) {
        if (!b.pos.length) continue
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
        if (b.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2))
        const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: b.map, side: THREE.FrontSide }))
        mesh.userData.floor = f
        group.add(mesh)
        floorMeshes.push({ mesh, floor: f, geo: g })
      }
    }
    return { group, floorMeshes }
  }, [gltf, model])

  useEffect(() => {
    // Aktive Etage opak, übrige stark abgeschwächt. BackSide blendet
    // sichtabhängig die vorderen Wände aus (Reinschauen) und aktualisiert
    // sich beim Drehen automatisch (GPU-Culling nach Blickrichtung).
    for (const { mesh, floor: mfl } of floorMeshes) {
      const active = mfl === floor
      mesh.visible = true
      mesh.material.transparent = !active
      mesh.material.opacity = active ? 1 : 0.16
      mesh.material.depthWrite = active
      mesh.renderOrder = active ? 0 : 1
    }
  }, [floor, floorMeshes])

  return <primitive object={group} />
}
