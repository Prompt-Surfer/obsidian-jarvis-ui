import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'
import os from 'os'
import yaml from 'js-yaml'

// Read port from YAML config file
const YAML_CONFIG_PATH = path.join(os.homedir(), '.jarvis-config.yaml')
const DEFAULT_API_PORT = 3002
const DEFAULT_VITE_PORT = 5173

let apiPort = DEFAULT_API_PORT
let vitePort = DEFAULT_VITE_PORT
try {
  const raw = fs.readFileSync(YAML_CONFIG_PATH, 'utf-8')
  const cfg = yaml.load(raw) as any
  if (cfg?.server?.port && typeof cfg.server.port === 'number') {
    apiPort = cfg.server.port
  }
  if (cfg?.vite?.port && typeof cfg.vite.port === 'number') {
    vitePort = cfg.vite.port
  }
} catch {
  // Config missing or malformed — use defaults
}

export default defineConfig({
  server: {
    port: vitePort,
    proxy: {
      '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
    },
  },
})
