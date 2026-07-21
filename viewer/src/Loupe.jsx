import React, { useEffect, useRef } from 'react'
import { useStore } from './store.js'
import { measureState } from './three/shared.js'

// Lupe: zeigt beim Messen eine vergrößerte, kreisrunde Ansicht rund um den
// Cursor (aus dem WebGL-Canvas) mit Fadenkreuz — für präzises Anvisieren von
// Ecken/Kanten. Farbe des Fadenkreuzes signalisiert den Snap (Ecke/Kante).
const SIZE = 156
const ZOOM = 2.8
const SRC = SIZE / ZOOM

export default function Loupe() {
  const tool = useStore((s) => s.tool)
  const ref = useRef(null)

  useEffect(() => {
    if (tool !== 'measure') return
    let raf = 0
    const el = ref.current
    const cx = el.getContext('2d')
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const main = document.querySelector('.viewer canvas')
      if (!main) return
      const rect = main.getBoundingClientRect()
      const mx = measureState.x - rect.left
      const my = measureState.y - rect.top
      if (mx < 0 || my < 0 || mx > rect.width || my > rect.height) { el.style.opacity = '0'; return }
      el.style.opacity = '1'
      // Lupe nahe dem Cursor platzieren (oben-rechts, sonst gespiegelt)
      let lx = measureState.x + 24, ly = measureState.y - SIZE - 24
      if (lx + SIZE > window.innerWidth) lx = measureState.x - SIZE - 24
      if (ly < 60) ly = measureState.y + 24
      el.style.left = lx + 'px'; el.style.top = ly + 'px'

      const sx = main.width / rect.width, sy = main.height / rect.height
      cx.clearRect(0, 0, SIZE, SIZE)
      cx.save()
      cx.beginPath(); cx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2); cx.clip()
      cx.imageSmoothingEnabled = true
      try {
        cx.drawImage(main,
          (mx - SRC / 2) * sx, (my - SRC / 2) * sy, SRC * sx, SRC * sy,
          0, 0, SIZE, SIZE)
      } catch (e) { /* preserveDrawingBuffer nötig */ }
      cx.restore()
      const col = measureState.snap === 'corner' ? '#ffcb35'
        : measureState.snap === 'edge' ? '#35d0ff' : 'rgba(255,255,255,0.85)'
      cx.strokeStyle = col; cx.lineWidth = 1.5
      const c = SIZE / 2
      cx.beginPath()
      cx.moveTo(c - 12, c); cx.lineTo(c - 4, c); cx.moveTo(c + 4, c); cx.lineTo(c + 12, c)
      cx.moveTo(c, c - 12); cx.lineTo(c, c - 4); cx.moveTo(c, c + 4); cx.lineTo(c, c + 12)
      cx.stroke()
      cx.beginPath(); cx.arc(c, c, 4, 0, Math.PI * 2); cx.stroke()
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [tool])

  if (tool !== 'measure') return null
  return <canvas ref={ref} className="loupe" width={SIZE} height={SIZE} />
}
