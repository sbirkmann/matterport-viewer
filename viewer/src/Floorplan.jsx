import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { store, useStore } from './store.js'

// 2D-Grundriss aus dem originalen Matterport-Floorplan-Bild (colorplan_alpha).
// Punkte werden per origin+resolution georeferenziert und darüber gelegt.
export default function Floorplan() {
  const model = useStore((s) => s.model)
  const floor = useStore((s) => s.floor)
  const fp = model.floorplan
  const floorId = model.floors[floor]?.id
  const file = fp && fp.files ? fp.files[floorId] : null

  const ref = useRef(null)
  const [view, setView] = useState({ s: 1, tx: 0, ty: 0 })
  const drag = useRef(null)

  // Sweeps dieser Etage -> Pixelkoordinaten im Bild
  const pts = useMemo(() => {
    if (!fp) return []
    const { resolution: res, origin, height } = fp
    return model.validSweeps
      .filter((s) => s.floor === floor)
      .map((s) => {
        const rawX = s.position.x
        const rawY = -s.position.z // Umkehr von convVec: viewer.z = -raw.y
        const px = (rawX - origin.x) * res
        const py = height - (rawY - origin.y) * res // Bild-Y invertiert
        return { s, px, py }
      })
  }, [model, floor, fp])

  // Anfangs auf die Punkte-Bounding-Box einpassen
  const fit = useCallback(() => {
    const el = ref.current
    if (!el || !pts.length) return
    const vw = el.clientWidth, vh = el.clientHeight
    const xs = pts.map((p) => p.px), ys = pts.map((p) => p.py)
    const pad = 2.2 // Meter Rand
    const m = (fp.resolution) * pad
    const minX = Math.min(...xs) - m, maxX = Math.max(...xs) + m
    const minY = Math.min(...ys) - m, maxY = Math.max(...ys) + m
    const bw = maxX - minX, bh = maxY - minY
    const s = Math.min(vw / bw, vh / bh)
    const tx = (vw - s * (minX + maxX)) / 2
    const ty = (vh - s * (minY + maxY)) / 2
    setView({ s, tx, ty })
  }, [pts, fp])

  useEffect(() => { fit() }, [fit])
  useEffect(() => {
    const on = () => fit()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [fit])

  if (!fp || !file) {
    return <div className="fp-msg">Kein Grundriss für diese Etage vorhanden.</div>
  }
  const url = `/model/${model.id}/floorplan/${file}`

  // Pan & Zoom
  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty } }
  const onMove = (e) => {
    if (!drag.current) return
    setView((v) => ({ ...v, tx: drag.current.tx + (e.clientX - drag.current.x), ty: drag.current.ty + (e.clientY - drag.current.y) }))
  }
  const onUp = () => { drag.current = null }
  const onWheel = (e) => {
    e.preventDefault()
    const el = ref.current.getBoundingClientRect()
    const mx = e.clientX - el.left, my = e.clientY - el.top
    const f = Math.exp(-e.deltaY * 0.0015)
    setView((v) => {
      const s = Math.max(0.05, Math.min(20, v.s * f))
      const k = s / v.s
      return { s, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k }
    })
  }

  const enter = (s) => {
    store.set({ mode: 'pano', currentSweep: s, floor: s.floor, transition: null })
  }

  const current = store.get().currentSweep

  return (
    <div className="fp-root" ref={ref}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
      onPointerLeave={onUp} onWheel={onWheel}>
      <div className="fp-canvas"
        style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})` }}>
        <img className="fp-img" src={url} alt="" draggable={false}
          style={{ width: fp.width, height: fp.height }} />
        {pts.map(({ s, px, py }) => (
          <button key={s.id}
            className={'fp-dot' + (current && s.id === current.id ? ' cur' : '')}
            style={{ left: px, top: py, transform: `translate(-50%,-50%) scale(${1 / view.s})` }}
            title={s.uuid}
            onClick={(e) => { e.stopPropagation(); enter(s) }} />
        ))}
      </div>
    </div>
  )
}
