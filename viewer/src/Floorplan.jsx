import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { store, useStore } from './store.js'

// 2D-Grundriss aus dem originalen Matterport-Floorplan-Bild (colorplan_alpha).
// Alle Etagen teilen dieselbe origin+resolution -> gleiche Einpassung, damit die
// Etagen deckungsgleich übereinander liegen. Verschieben nur im Zoom.
export default function Floorplan() {
  const model = useStore((s) => s.model)
  const floor = useStore((s) => s.floor)
  const fp = model.floorplan
  const floorId = model.floors[floor]?.id
  const file = fp && fp.files ? fp.files[floorId] : null

  const ref = useRef(null)
  const [view, setView] = useState(null)     // {s, tx, ty}
  const fitRef = useRef(null)                 // Einpass-Transform (Basis)
  const drag = useRef(null)

  const toPx = useCallback((s) => {
    const rawX = s.position.x
    const rawY = -s.position.z // Umkehr von convVec: viewer.z = -raw.y
    return [(rawX - fp.origin.x) * fp.resolution,
            fp.height - (rawY - fp.origin.y) * fp.resolution]
  }, [fp])

  // Fit basiert auf ALLEN Sweeps (alle Etagen) -> für jede Etage identisch.
  const allPts = useMemo(
    () => (fp ? model.validSweeps.map(toPx) : []),
    [model, fp, toPx])
  // Marker der aktiven Etage
  const pts = useMemo(() => (fp
    ? model.validSweeps.filter((s) => s.floor === floor).map((s) => {
        const [px, py] = toPx(s); return { s, px, py }
      })
    : []), [model, floor, fp, toPx])

  const computeFit = useCallback(() => {
    const el = ref.current
    if (!el || !allPts.length) return null
    const vw = el.clientWidth, vh = el.clientHeight
    const xs = allPts.map((p) => p[0]), ys = allPts.map((p) => p[1])
    const pad = fp.resolution * 2.5
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad
    const s = Math.min(vw / (maxX - minX), vh / (maxY - minY))
    return { s, tx: (vw - s * (minX + maxX)) / 2, ty: (vh - s * (minY + maxY)) / 2 }
  }, [allPts, fp])

  // Einmalig / bei Modell- oder Größenänderung einpassen (NICHT bei Etagenwechsel,
  // damit die Etagen deckungsgleich bleiben).
  useEffect(() => {
    const f = computeFit()
    if (f) { fitRef.current = f; setView(f) }
  }, [computeFit])
  useEffect(() => {
    const on = () => {
      const f = computeFit()
      if (f) { fitRef.current = f; setView((v) => (v && v.s > f.s * 1.01 ? v : f)) }
    }
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [computeFit])

  if (!fp || !file) return <div className="fp-msg">Kein Grundriss für diese Etage vorhanden.</div>
  const url = `/model/${model.id}/floorplan/${file}`
  const fit = fitRef.current
  const zoomedIn = view && fit && view.s > fit.s * 1.01

  // Pan nur im Zoom
  const onDown = (e) => {
    if (!zoomedIn) return
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
  }
  const onMove = (e) => {
    if (!drag.current) return
    setView((v) => ({ ...v, tx: drag.current.tx + (e.clientX - drag.current.x), ty: drag.current.ty + (e.clientY - drag.current.y) }))
  }
  const onUp = () => { drag.current = null }
  const onWheel = (e) => {
    e.preventDefault()
    if (!fit) return
    const el = ref.current.getBoundingClientRect()
    const mx = e.clientX - el.left, my = e.clientY - el.top
    const f = Math.exp(-e.deltaY * 0.0015)
    setView((v) => {
      const s = Math.max(fit.s, Math.min(fit.s * 14, v.s * f))
      if (s <= fit.s * 1.001) return { ...fit }        // ausgezoomt -> exakt einpassen
      const k = s / v.s
      return { s, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k }
    })
  }

  const enter = (s) => store.set({ mode: 'pano', currentSweep: s, floor: s.floor, transition: null })
  const current = store.get().currentSweep
  const v = view || { s: 1, tx: 0, ty: 0 }

  return (
    <div className={'fp-root' + (zoomedIn ? ' zoomed' : '')} ref={ref}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
      onPointerLeave={onUp} onWheel={onWheel}>
      <div className="fp-canvas"
        style={{ transform: `translate(${v.tx}px, ${v.ty}px) scale(${v.s})` }}>
        <img className="fp-img" src={url} alt="" draggable={false}
          style={{ width: fp.width, height: fp.height }} />
        {pts.map(({ s, px, py }) => (
          <button key={s.id}
            className={'fp-dot' + (current && s.id === current.id ? ' cur' : '')}
            style={{ left: px, top: py, transform: `translate(-50%,-50%) scale(${1 / v.s})` }}
            title={s.uuid}
            onClick={(e) => { e.stopPropagation(); enter(s) }} />
        ))}
      </div>
    </div>
  )
}
