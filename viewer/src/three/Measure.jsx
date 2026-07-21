import React, { useEffect, useRef, useState } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import { store, useStore } from '../store.js'
import { collider, _ray } from './shared.js'

// 3D-Messwerkzeug: zwei Punkte auf dem Mesh -> Distanz (kombiniert mit dem Mesh,
// funktioniert in allen Modi via Raycast gegen den Collider).
export default function Measure() {
  const tool = useStore((s) => s.tool)
  const { camera, gl } = useThree()
  const [pts, setPts] = useState([])
  const [preview, setPreview] = useState(null)
  const ptr = useRef(new THREE.Vector2())

  useEffect(() => { if (tool !== 'measure') { setPts([]); setPreview(null) } }, [tool])

  useEffect(() => {
    if (tool !== 'measure') return
    const el = gl.domElement
    const onMove = (e) => {
      const r = el.getBoundingClientRect()
      ptr.current.set(((e.clientX - r.left) / r.width) * 2 - 1,
                      -((e.clientY - r.top) / r.height) * 2 + 1)
    }
    const onClick = () => {
      const hit = cast(ptr.current, camera)
      if (!hit) return
      setPts((prev) => (prev.length >= 2 ? [hit] : [...prev, hit]))
    }
    const onKey = (e) => { if (e.key === 'Escape') store.set({ tool: null }) }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [tool, camera, gl])

  useFrame(() => {
    if (tool === 'measure' && pts.length === 1) {
      const hit = cast(ptr.current, camera)
      setPreview(hit || null)
    }
  })

  if (tool !== 'measure') return null
  const line = pts.length === 2 ? pts : (pts.length === 1 && preview ? [pts[0], preview] : null)
  const dist = line ? line[0].distanceTo(line[1]) : 0

  return (
    <group>
      {pts.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.05, 16, 16]} />
          <meshBasicMaterial color="#ffcb35" depthTest={false} />
        </mesh>
      ))}
      {line && (
        <>
          <Line points={line} color="#ffcb35" lineWidth={2} depthTest={false} />
          <Html position={line[0].clone().lerp(line[1], 0.5)} center>
            <div className="measure-label">{dist.toFixed(2)} m</div>
          </Html>
        </>
      )}
    </group>
  )
}

function cast(ptr, camera) {
  if (!collider.object) return null
  _ray.setFromCamera(ptr, camera)
  const h = _ray.intersectObject(collider.object, true)
  return h.length ? h[0].point.clone() : null
}
