import { useEffect, useRef, useState } from 'react'

interface SemanticStatus {
  ready: boolean
  indexed: number
  total: number
  model: string
}

interface HUDProps {
  nodeCount: number
  linkCount: number
  visibleNodeCount: number
  simDone: boolean
  breadcrumb?: string | null
  timelapsePlaying?: boolean
  timelapseDate?: number
  onPauseTimelapse?: () => void
  semanticStatus?: SemanticStatus | null
}

export function HUD({ nodeCount, linkCount, visibleNodeCount, simDone, breadcrumb, timelapsePlaying, timelapseDate, onPauseTimelapse, semanticStatus }: HUDProps) {
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

  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

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
      pointerEvents: 'none',
    }}>
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
      {semanticStatus && !semanticStatus.ready && semanticStatus.total > 0 && (
        <div style={{
          marginTop: 6,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          color: '#c4a7e7',
          fontSize: 11,
          letterSpacing: '0.08em',
        }}>
          INDEXING: {semanticStatus.indexed}/{semanticStatus.total}
        </div>
      )}
      {timelapsePlaying && (
        <div
          onClick={onPauseTimelapse}
          style={{
            marginTop: 6,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            background: '#00d4ff11',
            border: '1px solid #00d4ff44',
            borderRadius: 4,
            padding: '3px 8px',
            color: '#00d4ff',
            fontSize: 11,
            letterSpacing: '0.08em',
            animation: 'timelapse-pulse 1.5s ease-in-out infinite',
            cursor: 'pointer',
            pointerEvents: 'auto',
          }}
          title="Click to pause timelapse"
        >
          <span>▶ TIMELAPSE</span>
          {timelapseDate !== undefined && (
            <span style={{ color: '#00d4ffaa', fontSize: 10 }}>{fmtDate(timelapseDate)}</span>
          )}
        </div>
      )}
    </div>
  )
}
