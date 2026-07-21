import React from 'react'

const P = {
  walk: 'M13 4a2 2 0 1 0 0-.01M9 21l1.5-6L8 13v-3l4-1 3 2 2 1M11 21l1-4',
  cube: 'M12 2l9 5v10l-9 5-9-5V7l9-5zM12 12l9-5M12 12v10M12 12L3 7',
  plan: 'M3 3h18v18H3zM3 10h18M10 10v11',
  ruler: 'M4 16L16 4l4 4L8 20zM8 12l2 2M12 8l2 2M6 14l1 1',
  mesh: 'M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10M7.5 4.5l9 5M16.5 4.5l-9 5',
}

export function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={P[name] || ''} />
    </svg>
  )
}
