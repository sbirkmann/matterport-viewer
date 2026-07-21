import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree, useLoader } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { store, useStore } from '../store.js'
import { panoBase, nearestSweep } from '../data.js'
import { collider, raycastMesh } from './shared.js'
import Dollhouse from './Dollhouse.jsx'
import Measure from './Measure.jsx'

export default function World() {
  const mode = useStore((s) => s.mode)
  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[5, 12, 8]} intensity={0.6} />
      <Collider />
      {mode === 'pano' && <PanoWorld />}
      {mode === 'dollhouse' && <OverviewWorld mode={mode} />}
      <Measure />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Collider: GLB laden, zu einem unsichtbaren Raycast-Mesh mergen       */
/* ------------------------------------------------------------------ */
function Collider() {
  const model = useStore((s) => s.model)
  const gltf = useGLTF(model.meshUrl)
  const ref = useRef()

  const geometry = useMemo(() => {
    const geos = []
    gltf.scene.traverse((o) => {
      if (o.isMesh) {
        const g = o.geometry.clone()
        g.applyMatrix4(o.matrixWorld)
        // nur Position für Raycast
        const pos = g.getAttribute('position')
        const ng = new THREE.BufferGeometry()
        ng.setAttribute('position', pos)
        if (g.index) ng.setIndex(g.index)
        geos.push(ng)
      }
    })
    if (!geos.length) return null
    const merged = mergeGeometries(geos, false)
    merged.rotateX(-Math.PI / 2) // Z-up -> Y-up (wie alle anderen Koordinaten)
    return merged
  }, [gltf])

  useEffect(() => {
    collider.geometry = geometry
    collider.object = ref.current
    return () => { collider.object = null }
  }, [geometry])

  const mode = useStore((s) => s.mode)
  const transition = useStore((s) => s.transition)
  if (!geometry) return null
  // Im Pano-Modus schreibt der Collider nur Tiefe (colorWrite=false), damit
  // Punkte/Reticle hinter Wänden verdeckt werden. Während des Übergangs
  // ausgeblendet (das WalkMesh übernimmt die Tiefe). Raycast läuft immer.
  return (
    <mesh ref={ref} geometry={geometry} visible={mode === 'pano' && !transition} renderOrder={0}>
      {/* DoubleSide: Raycast (Cursor/Verdeckung/Messen) trifft die Flächen von
          innen unabhängig von der Wicklung. */}
      <meshBasicMaterial colorWrite={false} depthWrite={true} side={THREE.DoubleSide} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ */
/* Panorama-Welt: Skybox + First-Person-Controls + Navigation          */
/* ------------------------------------------------------------------ */
function PanoWorld() {
  const model = useStore((s) => s.model)
  const current = useStore((s) => s.currentSweep)
  const transition = useStore((s) => s.transition)
  const { camera, gl } = useThree()

  const shown = transition ? transition.to : current

  // FOV beim Betreten des Rundgangs zurücksetzen (Grundriss nutzt kleines FOV)
  useEffect(() => {
    camera.fov = 75; camera.updateProjectionMatrix()
  }, [camera])

  // ---- First-Person Look (lon/lat) ----
  const look = useRef({ lon: 0, lat: 0, down: false, moved: false, px: 0, py: 0 })
  const pointer = useRef(new THREE.Vector2(0, 0))

  useEffect(() => {
    const el = gl.domElement
    const l = look.current
    const onDown = (e) => { l.down = true; l.moved = false; l.px = e.clientX; l.py = e.clientY }
    const onMove = (e) => {
      const r = el.getBoundingClientRect()
      pointer.current.set(((e.clientX - r.left) / r.width) * 2 - 1,
                          -((e.clientY - r.top) / r.height) * 2 + 1)
      if (!l.down) return
      const dx = e.clientX - l.px, dy = e.clientY - l.py
      if (Math.abs(dx) + Math.abs(dy) > 4) l.moved = true
      l.lon -= dx * 0.12
      l.lat = Math.max(-85, Math.min(85, l.lat + dy * 0.12))
      l.px = e.clientX; l.py = e.clientY
    }
    const onUp = (e) => {
      l.down = false
      if (!l.moved && store.get().tool !== 'measure') tryNavigate()
    }
    const onWheel = (e) => {
      e.preventDefault()
      camera.fov = Math.max(30, Math.min(90, camera.fov + e.deltaY * 0.03))
      camera.updateProjectionMatrix()
    }
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl, camera])

  function tryNavigate() {
    const hit = raycastMesh(pointer.current, camera)
    if (!hit) return
    const p = [hit.point.x, hit.point.y, hit.point.z]
    const s = store.get()
    const target = nearestSweep(model, p, { exclude: s.currentSweep?.id })
    if (target) startTransition(target)
  }

  // "Hinlaufen": Kamera fährt durch das texturierte Mesh von A nach B (echte
  // Parallaxe). Ein Schnappschuss der Startansicht blendet dabei weich aus.
  function startTransition(target) {
    const s = store.get()
    if (!s.currentSweep || target.id === s.currentSweep.id) return
    const el = document.getElementById('pano-fade')
    if (el) {
      try {
        el.src = gl.domElement.toDataURL('image/jpeg', 0.85)
        el.style.transition = 'none'
        el.style.transformOrigin = '50% 50%'
        el.style.opacity = '1'
        el.style.transform = 'scale(1)'
        void el.offsetWidth
        el.style.transition = 'opacity 0.45s ease-in, transform 0.85s ease-in'
        el.style.opacity = '0'
        el.style.transform = 'scale(1.25)'
      } catch (e) { /* preserveDrawingBuffer nötig */ }
    }
    const p = s.currentSweep.panoPosition
    store.set({ transition: { fromPos: { x: p.x, y: p.y, z: p.z }, to: target, t: 0, dur: 0.85, walk: true } })
  }

  // ---- Kamera & Navigation pro Frame ----
  const tmp = useRef(new THREE.Vector3())
  useFrame((_, dt) => {
    const s = store.get()
    const l = look.current
    let camPos
    if (s.transition) {
      // Fly-in aus der Übersicht: Kamera-Fahrt in den Zielpunkt
      const tr = s.transition
      // Blick in Flugrichtung ausrichten (einmalig beim Start des Fly-ins)
      if (tr.lookLon !== undefined && !tr._lookApplied) {
        l.lon = tr.lookLon; l.lat = 0; tr._lookApplied = true
      }
      tr.t = Math.min(1, tr.t + dt / (tr.dur || 0.9))
      const a = tr.fromPos, b = tr.to.panoPosition, e = easeInOut(tr.t)
      camPos = tmp.current.set(
        a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, a.z + (b.z - a.z) * e)
      if (tr.t >= 1) {
        store.set({ currentSweep: tr.to, transition: null, floor: tr.to.floor })
      }
    } else if (shown) {
      camPos = tmp.current.set(shown.panoPosition.x, shown.panoPosition.y, shown.panoPosition.z)
    }
    if (camPos) camera.position.copy(camPos)
    // Blickrichtung
    const phi = THREE.MathUtils.degToRad(90 - l.lat)
    const theta = THREE.MathUtils.degToRad(l.lon)
    const dir = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta))
    camera.lookAt(camera.position.x + dir.x, camera.position.y + dir.y, camera.position.z + dir.z)
  })

  return (
    <>
      {shown && <Skybox sweep={shown} />}
      {transition && <WalkMesh />}
      <Reticle pointer={pointer} />
      <SweepMarkers onPick={startTransition} />
      <DollhouseOverlay />
    </>
  )
}

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2 }

/* ---- Textur-Mesh für den "Hinlaufen"-Übergang (echte Parallaxe) ---- */
function WalkMesh() {
  const model = useStore((s) => s.model)
  const gltf = useGLTF(model.meshUrl)
  const { scene, mats } = useMemo(() => {
    const s = gltf.scene.clone(true)
    s.rotation.x = -Math.PI / 2
    const mats = []
    s.traverse((o) => {
      if (o.isMesh) {
        const map = o.material.map
        if (map) map.colorSpace = THREE.SRGBColorSpace
        o.material = new THREE.MeshBasicMaterial({ map, side: THREE.BackSide, transparent: true })
        o.renderOrder = 1
        mats.push(o.material)
      }
    })
    return { scene: s, mats }
  }, [gltf])
  // gegen Ende ausblenden -> weicher Übergang ins scharfe Ziel-Panorama
  useFrame(() => {
    const tr = store.get().transition
    const t = tr ? tr.t : 1
    const op = t < 0.72 ? 1 : Math.max(0, 1 - (t - 0.72) / 0.28)
    for (const m of mats) m.opacity = op
  })
  return <primitive object={scene} />
}

/* ---- Skybox als CubeTexture (scene.background) ----
   THREE.CubeTexture behandelt die Innenansicht/Face-Orientierung korrekt (kein
   manuelles Spiegeln). Reihenfolge der Bilder: [px, nx, py, ny, pz, nz].
   Topologie per Kantenabgleich ermittelt: f0=oben, f5=unten, Ring f1->f2->f3->f4. */
const DEFAULT_CAL = {
  faceOrder: [2, 4, 0, 5, 1, 3], // [px,nx,py,ny,pz,nz] -> Matterport-Face-Index
  useQ: true,                    // Pano-Ausrichtung (Quaternion) anwenden
  yawOffset: Math.PI / 2,        // konstanter Heading-Offset (Matterport-Referenz)
}
function Skybox({ sweep }) {
  const id = useStore((s) => s.model.id)
  const cal = useStore((s) => s.cal || DEFAULT_CAL)
  const { scene } = useThree()
  const urls = useMemo(
    () => Array.from({ length: 6 }, (_, i) => `${panoBase(id, sweep.uuid)}/face${i}.jpg`),
    [id, sweep.uuid])
  const textures = useLoader(THREE.TextureLoader, urls)

  const cubeTex = useMemo(() => {
    const imgs = cal.faceOrder.map((i) => textures[i].image)
    const ct = new THREE.CubeTexture(imgs)
    ct.colorSpace = THREE.SRGBColorSpace
    ct.needsUpdate = true
    return ct
  }, [textures, cal])

  const q = sweep.rotation
  const euler = useMemo(() => {
    // Pano-Rotation (Modelraum, Z-up) korrekt in den Y-up-Weltraum überführen:
    // Ähnlichkeitstransformation  q_world = C · q_model · C⁻¹  mit C = R_x(-90°).
    const C = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
    const base = (cal.useQ && q) ? new THREE.Quaternion(q.x, q.y, q.z, q.w)
                                 : new THREE.Quaternion()
    const qw = C.clone().multiply(base).multiply(C.clone().invert())
    if (cal.yawOffset) qw.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cal.yawOffset))
    return new THREE.Euler().setFromQuaternion(qw)
  }, [q, cal])

  useEffect(() => {
    scene.background = cubeTex
    if (scene.backgroundRotation) scene.backgroundRotation.copy(euler)
    return () => { scene.background = null }
  }, [scene, cubeTex, euler])

  return null
}

/* ---- Reticle: Cursor auf der Oberfläche ---- */
function Reticle({ pointer }) {
  const ref = useRef()
  const { camera } = useThree()
  const N = useRef(new THREE.Vector3())
  useFrame(() => {
    if (store.get().tool === 'measure') { if (ref.current) ref.current.visible = false; return }
    const hit = raycastMesh(pointer.current, camera)
    if (hit && ref.current) {
      ref.current.visible = true
      // leicht von der Fläche abheben gegen Z-Fighting
      const n = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0)
      n.transformDirection(hit.object.matrixWorld)
      N.current.copy(n)
      ref.current.position.copy(hit.point).addScaledVector(n, 0.01)
      // Ring in die Flächenebene legen: lokale +Z auf die Normale ausrichten
      ref.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
      // Skalierung mit Distanz, damit der Ring optisch konstant bleibt
      const d = camera.position.distanceTo(hit.point)
      ref.current.scale.setScalar(THREE.MathUtils.clamp(d * 0.12, 0.4, 3))
    } else if (ref.current) {
      ref.current.visible = false
    }
  })
  return (
    <mesh ref={ref} visible={false} renderOrder={999}>
      <ringGeometry args={[0.05, 0.075, 40]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.95}
        side={THREE.DoubleSide} depthTest={false} depthWrite={false} />
    </mesh>
  )
}

/* ---- Sweep-Punkte am Boden ----
   position.y (Matterport-Bodenschätzung) sitzt nicht exakt auf der Mesh-
   Oberfläche (v.a. an Treppen). Deshalb strahlen wir von der Kamera-Position
   jedes Sweeps senkrecht nach unten auf das Collider-Mesh und setzen den Marker
   genau auf den sichtbaren Boden. */
function SweepMarkers({ onPick }) {
  const model = useStore((s) => s.model)
  const floor = useStore((s) => s.floor)
  const current = useStore((s) => s.currentSweep)
  const [placed, setPlaced] = useState([])
  const doneFor = useRef(null)

  // Sweeps der aktiven Etage + Treppen-Nachbarn auf angrenzenden Etagen,
  // damit man über Treppen hoch/runter navigieren kann.
  const sweeps = useMemo(() => {
    const set = new Map()
    const onFloor = model.validSweeps.filter((s) => s.floor === floor)
    onFloor.forEach((s) => set.set(s.id, s))
    onFloor.forEach((s) => (s.neighbors || []).forEach((nid) => {
      const nb = model.sweepById[nid]
      if (nb && nb.uuid && nb.skyboxTemplate && Math.abs(nb.floor - floor) === 1)
        set.set(nb.id, nb)
    }))
    return [...set.values()]
  }, [model, floor])

  // Platzierung (Downcast auf Boden) + Verdeckung (Strahl von der Kamera zum
  // Punkt; steht eine Wand davor -> ausblenden). Neu berechnet bei Etagen- oder
  // Sweep-Wechsel (Verdeckung ändert sich nur beim Bewegen, nicht beim Drehen).
  useFrame(() => {
    const cur = store.get().currentSweep
    const key = floor + ':' + (cur ? cur.id : '-') + ':' + (collider.object ? '1' : '0')
    if (doneFor.current === key) return
    if (!collider.object || !cur) return
    doneFor.current = key
    const ray = new THREE.Raycaster()
    const down = new THREE.Vector3(0, -1, 0)
    const eye = new THREE.Vector3(cur.panoPosition.x, cur.panoPosition.y, cur.panoPosition.z)
    const dir = new THREE.Vector3()
    const res = []
    for (const s of sweeps) {
      if (s.id === cur.id) continue
      const p = s.panoPosition
      ray.set(new THREE.Vector3(p.x, p.y + 0.2, p.z), down); ray.far = 4
      const hit = ray.intersectObject(collider.object, true)
      const y = (hit.length ? hit[0].point.y : s.position.y) + 0.03
      // Sichtlinie prüfen
      const target = new THREE.Vector3(p.x, y, p.z)
      dir.copy(target).sub(eye)
      const dist = dir.length()
      ray.set(eye, dir.normalize()); ray.far = dist - 0.6
      if (ray.far > 0.3 && ray.intersectObject(collider.object, true).length) continue
      res.push({ s, x: p.x, y, z: p.z })
    }
    setPlaced(res)
  })

  return (
    <group>
      {placed.map(({ s, x, y, z }) => (
        <mesh
          key={s.id}
          position={[x, y, z]}
          rotation={[-Math.PI / 2, 0, 0]}
          onClick={(e) => { e.stopPropagation(); onPick(s) }}
          onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
          onPointerOut={() => { document.body.style.cursor = '' }}
        >
          <ringGeometry args={[0.1, 0.17, 28]} />
          {/* Verdeckte Punkte sind bereits aussortiert -> sichtbare immer zeichnen */}
          <meshBasicMaterial color="#35a7ff" transparent opacity={0.85}
            side={THREE.DoubleSide} depthWrite={false} depthTest={false} />
        </mesh>
      ))}
    </group>
  )
}

/* ---- optionales Mesh-Overlay im Pano (transparent) ---- */
function DollhouseOverlay() {
  const show = useStore((s) => s.showMesh)
  const model = useStore((s) => s.model)
  const gltf = useGLTF(model.meshUrl)
  const scene = useMemo(() => {
    const s = gltf.scene.clone(true)
    s.rotation.x = -Math.PI / 2 // Z-up -> Y-up (wie Collider/Dollhouse)
    s.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone()
        o.material.wireframe = true
        o.material.transparent = true
        o.material.opacity = 0.35
        o.material.depthTest = true
      }
    })
    return s
  }, [gltf])
  if (!show) return null
  return <primitive object={scene} />
}

/* ------------------------------------------------------------------ */
/* Übersicht: Dollhouse / Grundriss                                     */
/* ------------------------------------------------------------------ */
function OverviewWorld({ mode }) {
  const model = useStore((s) => s.model)
  const floor = useStore((s) => s.floor)
  const { camera, gl } = useThree()
  const controls = useRef()
  const ptr = useRef(new THREE.Vector2())

  // Fly-in: aus der Übersicht in den Sweep hineinfliegen und den Blick in
  // Flugrichtung (Kamera -> Zielpunkt) ausrichten.
  const flyTo = (target) => {
    const p = camera.position
    const dx = target.panoPosition.x - p.x, dz = target.panoPosition.z - p.z
    const lookLon = Math.atan2(dz, dx) * 180 / Math.PI
    store.set({
      mode: 'pano', floor: target.floor,
      transition: { fromPos: { x: p.x, y: p.y, z: p.z }, to: target, t: 0, dur: 1.1, lookLon },
    })
  }

  useEffect(() => {
    const el = gl.domElement
    const onMove = (e) => {
      const r = el.getBoundingClientRect()
      ptr.current.set(((e.clientX - r.left) / r.width) * 2 - 1,
                      -((e.clientY - r.top) / r.height) * 2 + 1)
    }
    const onDbl = () => {
      const hit = raycastMesh(ptr.current, camera)
      if (!hit) return
      const t = nearestSweep(model, [hit.point.x, hit.point.y, hit.point.z])
      if (t) flyTo(t)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('dblclick', onDbl)
    return () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('dblclick', onDbl) }
  }, [gl, camera, model])

  // Echtes Modell-Zentrum aus der Mesh-Bounding-Box (Y-up gedreht), damit die
  // Drehung wie ein Drehteller um das Objekt wirkt (nicht die Kamera schwenkt).
  const meshGltf = useGLTF(model.meshUrl)
  const info = useMemo(() => {
    const s = meshGltf.scene.clone(true)
    s.rotation.x = -Math.PI / 2
    s.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(s)
    const c = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const r = Math.max(size.x, size.z) * 0.6 + 2
    return { c, r }
  }, [meshGltf])

  // Drehteller: Ziel = Modell-Zentrum. Kamera nur einmal beim Betreten setzen,
  // danach steuert der Nutzer frei (Drehen um das Zentrum, Rad = Zoom zum Zentrum).
  useEffect(() => {
    camera.position.set(info.c.x + info.r, info.c.y + info.r * 0.7, info.c.z + info.r)
    camera.fov = 55
    camera.near = 0.05; camera.far = info.r * 20
    camera.updateProjectionMatrix()
    if (controls.current) { controls.current.target.copy(info.c); controls.current.update() }
  }, [info]) // nur bei (Neu-)Betreten / Modellwechsel

  return (
    <>
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12}
        maxPolarAngle={Math.PI / 2.05} minDistance={info.r * 0.15} maxDistance={info.r * 6} />
      <Dollhouse mode={mode} floor={floor} />
      <OverviewMarkers onEnter={flyTo} />
    </>
  )
}

function OverviewMarkers({ onEnter }) {
  const model = useStore((s) => s.model)
  const floor = useStore((s) => s.floor)
  const mode = useStore((s) => s.mode)
  const flat = mode === 'floorplan'
  // position.y ist Matterports Bodenpunkt des Sweeps -> Punkte auf Bodenhöhe.
  // (Kein Downcast: der träfe im Raum oft Möbel und läge dann zu hoch.)
  const sweeps = model.validSweeps.filter((s) => s.floor === floor)
  return (
    <group>
      {sweeps.map((s) => (
        <mesh key={s.id} position={[s.position.x, s.position.y + 0.04, s.position.z]}
          rotation={flat ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}
          onDoubleClick={(e) => { e.stopPropagation(); onEnter(s) }}
          onPointerOver={() => (document.body.style.cursor = 'pointer')}
          onPointerOut={() => (document.body.style.cursor = '')}>
          {flat ? <circleGeometry args={[0.16, 24]} /> : <sphereGeometry args={[0.1, 16, 16]} />}
          <meshBasicMaterial color="#35a7ff" depthTest={false} />
        </mesh>
      ))}
    </group>
  )
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length
const span = (a) => Math.max(...a) - Math.min(...a)

useGLTF.preload && null
