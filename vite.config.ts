import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The Cloudflare plugin runs the Worker (API, D1, R2, Workflows) inside Vite's dev server,
// so `npm run dev` serves the React app and /api/* together.
export default defineConfig({
  plugins: [react(), cloudflare()],
})
