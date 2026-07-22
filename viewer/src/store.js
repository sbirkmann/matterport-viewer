import { useSyncExternalStore } from 'react'

// Minimaler globaler Store (ohne externe Abhängigkeit).
let state = {
  model: null,          // geladene model.json
  id: null,
  status: 'loading',    // loading | ready | error
  error: null,
  mode: 'pano',         // pano | dollhouse | floorplan
  floor: 0,             // aktive Etage (index)
  currentSweep: null,   // aktueller Sweep (Objekt) im Pano-Modus
  tool: null,           // null | 'measure'
  showMesh: false,      // Mesh im Pano sichtbar (Debug/Overlay)
  showAllFloors: false, // Dollhouse: alle Etagen einblenden statt nur aktive
  transition: null,     // {from, to, t}  laufende Navigation
  hoverPoint: null,     // [x,y,z] Cursor-Treffer auf Oberfläche
}

const listeners = new Set()
function emit() { state = { ...state }; listeners.forEach((l) => l()) }

export const store = {
  get: () => state,
  set: (patch) => { Object.assign(state, patch); emit() },
  subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) },
}

if (typeof window !== 'undefined') window.__store = store

export function useStore(selector = (s) => s) {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()))
}
