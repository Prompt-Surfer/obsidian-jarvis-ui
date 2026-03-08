import { useRef, useEffect } from 'react'

interface MinimapProps {
  nodes: Array<{ id: string; x: number; y: number; z: number; color?: number }>
  cameraPosition: { x: number; y: number; z: number } | null
  cameraTarget: { x: number; y: number; z: number } | null
  onClickPosition: (x: number, z: number) => void
}

const WIDTH = 180
const HEIGHT = 120
const PADDING = 8
const THROTTLE_MS = 33 // ~30fps

export function Minimap({ nodes, cameraPosition, cameraTarget, onClickPosition }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastDrawRef = useRef(0)
  const boundsRef = useRef({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 })

  useEffect(() => {
    const now = Date.now()
    if (now - lastDrawRef.current < THROTTLE_MS) return
    lastDrawRef.current = now

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    ctx.fillStyle = 'rgba(10,15,30,0.85)'
    ctx.fillRect(0, 0, WIDTH, HEIGHT)

    if (nodes.length === 0) return

    // Compute bounds from node positions
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const n of nodes) {
      if (n.x < minX) minX = n.x
      if (n.x > maxX) maxX = n.x
      if (n.z < minZ) minZ = n.z
      if (n.z > maxZ) maxZ = n.z
    }
    const rangeX = maxX - minX || 1
    const rangeZ = maxZ - minZ || 1
    boundsRef.current = { minX, maxX, minZ, maxZ }

    const toCanvas = (x: number, z: number) => ({
      cx: PADDING + ((x - minX) / rangeX) * (WIDTH - PADDING * 2),
      cy: PADDING + ((z - minZ) / rangeZ) * (HEIGHT - PADDING * 2),
    })

    // Draw nodes
    for (const n of nodes) {
      const { cx, cy } = toCanvas(n.x, n.z)
      const r = n.color ?? 0x00d4ff
      const rr = (r >> 16) & 0xff
      const gg = (r >> 8) & 0xff
      const bb = r & 0xff
      ctx.fillStyle = `rgba(${rr},${gg},${bb},0.7)`
      ctx.beginPath()
      ctx.arc(cx, cy, 2, 0, Math.PI * 2)
      ctx.fill()
    }

    // Draw camera viewport rect
    if (cameraPosition && cameraTarget) {
      const { cx: ccx, cy: ccy } = toCanvas(cameraPosition.x, cameraPosition.z)
      const hw = Math.max(8, Math.min(40, 20))
      const hh = Math.max(6, Math.min(30, 15))
      ctx.strokeStyle = '#00d4ff'
      ctx.lineWidth = 1
      ctx.strokeRect(ccx - hw, ccy - hh, hw * 2, hh * 2)
    }
  }, [nodes, cameraPosition, cameraTarget])

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const { minX, maxX, minZ, maxZ } = boundsRef.current
    const worldX = minX + ((px - PADDING) / (WIDTH - PADDING * 2)) * (maxX - minX)
    const worldZ = minZ + ((py - PADDING) / (HEIGHT - PADDING * 2)) * (maxZ - minZ)
    onClickPosition(worldX, worldZ)
  }

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      onClick={handleClick}
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        width: WIDTH,
        height: HEIGHT,
        zIndex: 150,
        borderRadius: 4,
        border: '1px solid #00d4ff',
        boxShadow: '0 0 8px rgba(0,212,255,0.3)',
        cursor: 'crosshair',
        background: 'rgba(10,15,30,0.85)',
      }}
    />
  )
}
