import React, { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store.js'

// Textured Dollhouse-Mesh. Matterport-Texturen sind vorbeleuchtet -> unlit
// (MeshBasicMaterial) für den vollen, hellen Look. Chunks werden nach Höhe
// einer Etage zugeordnet; aktive Etage opak, übrige halbtransparent.
export default function Dollhouse({ mode, floor }) {
  const model = useStore((s) => s.model)
  const gltf = useGLTF(model.meshUrl)

  const { scene, meshFloors } = useMemo(() => {
    const s = gltf.scene.clone(true)
    s.rotation.x = -Math.PI / 2 // Z-up -> Y-up
    s.updateMatrixWorld(true)
    const meshes = []
    const box = new THREE.Box3()
    s.traverse((o) => {
      if (o.isMesh) {
        // unlit, damit die eingebrannten Texturen voll zur Geltung kommen
        const map = o.material.map
        if (map) map.colorSpace = THREE.SRGBColorSpace
        o.material = new THREE.MeshBasicMaterial({ map, side: THREE.BackSide })
        box.setFromObject(o)
        const c = box.getCenter(new THREE.Vector3())
        meshes.push({ mesh: o, cx: c.x, cz: c.z, base: box.min.y })
      }
    })
    // Zuordnung über den nächstgelegenen Sweep, wobei die AUFSTANDSHÖHE des
    // Chunks (Unterkante) mit der Etagenhöhe des Sweeps (position.y) verglichen
    // wird. Nutzt LOKALE Etagenhöhen -> korrekt auch bei Split-Level/Hanglage.
    const sweeps = model.validSweeps
    const mf = meshes.map(({ mesh, cx, cz, base }) => {
      let best = 0, bd = Infinity
      for (const s2 of sweeps) {
        const dx = s2.position.x - cx, dz = s2.position.z - cz
        const dy = s2.position.y - base
        const d = dx * dx + dz * dz + 3 * dy * dy
        if (d < bd) { bd = d; best = s2.floor }
      }
      return { mesh, floor: best }
    })
    return { scene: s, meshFloors: mf }
  }, [gltf, model])

  useEffect(() => {
    // Aktive Etage opak, übrige halbtransparent. BackSide: verdeckt
    // sichtabhängig die vorderen Wände (Reinschauen) und zeigt die von innen
    // aufgenommenen Texturen korrekt orientiert.
    for (const { mesh, floor: mfl } of meshFloors) {
      const opacity = mfl === floor ? 1 : 0.18
      mesh.material.side = THREE.BackSide
      mesh.visible = true
      mesh.material.transparent = opacity < 1
      mesh.material.opacity = opacity
      mesh.material.depthWrite = opacity >= 1
      mesh.renderOrder = opacity >= 1 ? 0 : 1
    }
  }, [floor, meshFloors])

  return <primitive object={scene} />
}
