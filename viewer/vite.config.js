import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// model/ liegt eine Ebene über viewer/ und wird über public/model (Symlink)
// eingebunden. fs.allow muss das Repo-Root umfassen.
export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [path.resolve(__dirname, '..')] },
    host: true,
  },
})
