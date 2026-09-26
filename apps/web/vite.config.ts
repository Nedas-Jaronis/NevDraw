import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// In dev, Vite serves the app on :3000 and forwards the room socket to the
// Effect server on :3001. In production the Effect server serves both.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    host: true,
    allowedHosts: [".trycloudflare.com"],
    proxy: { "/ws": { target: "ws://localhost:3001", ws: true } },
    // WSL can't watch files on the Windows drive (/mnt/c); poll there instead.
    watch: { usePolling: process.cwd().startsWith("/mnt/") },
  },
})
