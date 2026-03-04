import { useEffect, useRef, useState } from 'react'

interface HUDProps {
  nodeCount: number
  linkCount: number
  visibleNodeCount: number
  simDone: boolean
  onResetCamera: () => void
  breadcrumb?: string | null
}

export function HUD({ nodeCount, linkCount, visibleNodeCount, simDone, onResetCamera, breadcrumb }: HUDProps) {
  const [fps, setFps] = useState(0)
  const frameTimesRef = useRef<number[]>([])
  const lastFrameRef = useRef(performance.now())

  useEffect(() => {
    let rafId: number
    function tick() {
      const now = performance.now()
      const delta = now - lastFrameRef.current
      lastFrameRef.current = now

      frameTimesRef.current.push(delta)
      if (frameTimesRef.current.length > 60) frameTimesRef.current.shift()

      const avg = frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length
      setFps(Math.round(1000 / avg))

      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  return (
    <div style={{
      position: 'fixed',
      top: 16,
      left: 16,
      fontFamily: '"Courier New", monospace',
      fontSize: '12px',
      color: '#00a8cc',
      lineHeight: '1.7',
      userSelect: 'none',
      textShadow: '0 0 8px #00a8cc44',
    }}>
      <div style={{ pointerEvents: 'none' }}>
        <div>NODES: {nodeCount}</div>
        <div>VISIBLE: {visibleNodeCount}</div>
        <div>LINKS: {linkCount}</div>
        <div>FPS: {fps}</div>
        <div style={{ marginTop: 4, color: simDone ? '#00d4ff' : '#ff6b35' }}>
          {simDone ? '■ SIM STABLE' : '◌ SIMULATING'}
        </div>
        {breadcrumb && (
          <div style={{ marginTop: 4, color: '#00d4ff', fontSize: 10, letterSpacing: '0.06em' }}>
            {breadcrumb}
          </div>
        )}
      </div>
      <button
        onClick={onResetCamera}
        style={{
          marginTop: 8,
          background: 'rgba(0,0,0,0.7)',
          border: '1px solid #1a3a4a',
          color: '#00a8cc',
          borderRadius: 4,
          padding: '4px 10px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 11,
          letterSpacing: '0.08em',
          pointerEvents: 'auto',
        }}
      >[ RESET ]</button>
    </div>
  )
}
