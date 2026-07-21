import React, { useEffect, useRef, useState } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import { store, useStore } from '../store.js'
import { collider, _ray, measureState, snapHit } from './shared.js'

// 3D-Messwerkzeug im Raum: Ecken/Kanten anklicken -> virtuelles Lineal + Meter.
// Snapping auf Vertex (Ecke) oder Kante; die Lupe (DOM) hilft beim präzisen Zielen.
const SNAP_COLOR = { corner: '#ffcb35', edge: '#35d0ff', surface: '#ffffff' }

export default function Measure() {
  const tool = useStore((s) => s.tool)
  const { camera, gl } = useThree()
  const [pts, setPts] = useState([])       // gesetzte Punkte (Polylinie)
  const [snap, setSnap] = useState(null)   // aktueller Snap {point, type}
  const px = useRef({ x: 0, y: 0, ndc: new THREE.Vector2() })

  useEffect(() => {
    measureState.active = tool === 'measure'
    if (tool !== 'measure') { setPts([]); setSnap(null) }
  }, [tool])

  const computeSnap = () => {
    if (!collider.object) return null
    _ray.setFromCamera(px.current.ndc, camera)
    const h = _ray.intersectObject(collider.object, true)
    if (!h.length) return null
    const r = gl.domElement.getBoundingClientRect()
    return snapHit(h[0], camera, px.current.x, px.current.y, r.width, r.height)
  }

  useEffect(() => {
    if (tool !== 'measure') return
    const el = gl.domElement
    const onMove = (e) => {
      const r = el.getBoundingClientRect()
      px.current.x = e.clientX - r.left
      px.current.y = e.clientY - r.top
      px.current.ndc.set((px.current.x / r.width) * 2 - 1, -(px.current.y / r.height) * 2 + 1)
      measureState.x = e.clientX
      measureState.y = e.clientY
    }
    const onClick = () => {
      const s = computeSnap()
      if (s && s.point) setPts((prev) => [...prev, s.point.clone()])
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { if (pts.length) setPts([]); else store.set({ tool: null }) }
      if (e.key === 'Enter' || e.key === 'Backspace') setPts((p) => p.slice(0, -1))
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [tool, gl, camera, pts.length])

  useFrame(() => {
    if (tool !== 'measure') return
    const s = computeSnap()
    setSnap(s)
    measureState.snap = s ? s.type : null
  })

  if (tool !== 'measure') return null

  const chain = snap ? [...pts, snap.point] : pts
  const segments = []
  for (let i = 0; i < chain.length - 1; i++) segments.push([chain[i], chain[i + 1]])

  return (
    <group>
      {/* gesetzte Punkte */}
      {pts.map((p, i) => (
        <mesh key={i} position={p} renderOrder={1000}>
          <sphereGeometry args={[0.03, 16, 16]} />
          <meshBasicMaterial color="#ffcb35" depthTest={false} />
        </mesh>
      ))}
      {/* Snap-Vorschau (Ecke/Kante) */}
      {snap && (
        <mesh position={snap.point} renderOrder={1001}>
          <sphereGeometry args={[snap.type === 'corner' ? 0.045 : 0.035, 16, 16]} />
          <meshBasicMaterial color={SNAP_COLOR[snap.type]} depthTest={false} />
        </mesh>
      )}
      {/* Lineal-Segmente mit Meter-Angabe */}
      {segments.map((seg, i) => {
        const d = seg[0].distanceTo(seg[1])
        return (
          <group key={i}>
            <Line points={seg} color="#ffcb35" lineWidth={2.5} depthTest={false} />
            <Html position={seg[0].clone().lerp(seg[1], 0.5)} center zIndexRange={[100, 0]}>
              <div className="measure-label">{d.toFixed(2)} m</div>
            </Html>
          </group>
        )
      })}
    </group>
  )
}
