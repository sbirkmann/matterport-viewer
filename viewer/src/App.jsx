import React, { useEffect, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { store, useStore } from './store.js'
import { getModelId, loadModel } from './data.js'
import World from './three/World.jsx'
import Floorplan from './Floorplan.jsx'
import { Icon } from './ui/Icon.jsx'

export default function App() {
  const status = useStore((s) => s.status)

  useEffect(() => {
    const id = getModelId()
    if (!id) {
      store.set({ status: 'error', error: 'Keine Modell-ID. Aufruf mit ?id=<MODEL_ID>' })
      return
    }
    store.set({ status: 'loading', id })
    loadModel(id)
      .then((model) => {
        const first = model.validSweeps[0]
        store.set({
          model, status: 'ready',
          currentSweep: first || null,
          floor: first ? first.floor : 0,
        })
        document.title = `${model.name || id} · MPD`
      })
      .catch((e) => store.set({ status: 'error', error: e.message }))
  }, [])

  if (status === 'loading') return <Loading />
  if (status === 'error') return <ErrorView />
  return <Viewer />
}

function Loading() {
  return (
    <div className="center-msg">
      <div className="spinner" />
      <div>Modell wird geladen …</div>
    </div>
  )
}

function ErrorView() {
  const error = useStore((s) => s.error)
  return (
    <div className="center-msg">
      <h2>⚠︎ {error}</h2>
      <div className="hint">
        Erst herunterladen:&nbsp;<code>./fetch.sh &lt;MODEL_ID&gt;</code><br />
        dann Viewer öffnen mit&nbsp;<code>?id=&lt;MODEL_ID&gt;</code>
      </div>
    </div>
  )
}

function Viewer() {
  const model = useStore((s) => s.model)
  return (
    <div className="viewer">
      <Canvas
        camera={{ fov: 75, near: 0.05, far: 1000, position: [0, 1.6, 0] }}
        gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <World />
        </Suspense>
      </Canvas>
      <img className="pano-fade" id="pano-fade" alt="" />
      <FloorplanLayer />
      <TopBar model={model} />
      <FloorSelector />
      <ModeBar />
      <Tools />
      <HelpPanel />
    </div>
  )
}

function FloorplanLayer() {
  const mode = useStore((s) => s.mode)
  if (mode !== 'floorplan') return null
  return <Floorplan />
}


function TopBar({ model }) {
  const sweepCount = model.validSweeps.length
  return (
    <div className="topbar">
      <div>
        <div className="title">{model.name || model.id}</div>
        <div className="sub">{sweepCount} Aufnahmepunkte · {model.floorCount} Etagen</div>
      </div>
    </div>
  )
}

function FloorSelector() {
  const { model, floor } = useStore()
  const floors = model.floors
  return (
    <div className="floors">
      <div className="lbl">Etage</div>
      {[...floors].reverse().map((f) => (
        <button
          key={f.index}
          className={f.index === floor ? 'active' : ''}
          title={`${f.sweepCount} Punkte`}
          onClick={() => selectFloor(model, f.index)}
        >
          {f.index + 1}
        </button>
      ))}
    </div>
  )
}

function selectFloor(model, index) {
  // beim Etagenwechsel im Pano-Modus zum ersten Sweep der Etage springen
  const s = store.get()
  store.set({ floor: index })
  if (s.mode === 'pano') {
    const target = model.validSweeps.find((sw) => sw.floor === index)
    if (target && target.id !== s.currentSweep?.id) {
      store.set({ transition: { from: s.currentSweep, to: target, t: 0 } })
    }
  }
}

function ModeBar() {
  const mode = useStore((s) => s.mode)
  const set = (m) => store.set({ mode: m, tool: null })
  const items = [
    ['pano', 'walk', 'Rundgang'],
    ['dollhouse', 'cube', 'Dollhouse'],
    ['floorplan', 'plan', 'Grundriss'],
  ]
  return (
    <div className="modebar">
      {items.map(([m, icon, label]) => (
        <button key={m} className={mode === m ? 'active' : ''} onClick={() => set(m)}>
          <Icon name={icon} /> {label}
        </button>
      ))}
    </div>
  )
}

function Tools() {
  const { tool, showMesh, mode } = useStore()
  return (
    <div className="tools">
      <button
        className={'tool-btn' + (tool === 'measure' ? ' active' : '')}
        title="Messen (2 Punkte anklicken)"
        onClick={() => store.set({ tool: tool === 'measure' ? null : 'measure' })}
      >
        <Icon name="ruler" />
      </button>
      {mode === 'pano' && (
        <button
          className={'tool-btn' + (showMesh ? ' active' : '')}
          title="3D-Mesh einblenden"
          onClick={() => store.set({ showMesh: !showMesh })}
        >
          <Icon name="mesh" />
        </button>
      )}
    </div>
  )
}

function HelpPanel() {
  const { mode, tool } = useStore()
  if (tool === 'measure')
    return <div className="hud-hint">Messen: zwei Punkte anklicken · ESC beendet</div>
  const txt = {
    pano: <><b>Rundgang:</b> Ziehen zum Umsehen · auf Boden/Punkt klicken zum Bewegen · Rad = Zoom</>,
    dollhouse: <><b>Dollhouse:</b> Ziehen = drehen · Rad = Zoom · Punkte anklicken</>,
    floorplan: <><b>Grundriss:</b> Draufsicht der Etage · Punkte anklicken</>,
  }[mode]
  return <div className="help">{txt}</div>
}
