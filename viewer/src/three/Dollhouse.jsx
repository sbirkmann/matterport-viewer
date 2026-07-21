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
    // Zuordnung über die AUFSTANDSHÖHE (Unterkante): der Chunk gehört zur
    // höchsten Etage, deren Boden nicht über ihm liegt. So bleibt z.B. die
    // Decke von Etage 1 bei Etage 1 (statt fälschlich bei Etage 2).
    const elevs = model.floors.map((f) => f.elevation)
    const mf = meshes.map(({ mesh, base }) => {
      let f = 0
      for (let i = 0; i < elevs.length; i++) if (elevs[i] <= base + 0.6) f = i
      return { mesh, floor: f }
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
