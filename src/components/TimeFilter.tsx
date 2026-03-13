import { useMemo, useState, useEffect, useRef } from 'react'
import type { GraphNode } from '../hooks/useVaultGraph'

interface TimeFilterProps {
  nodes: GraphNode[]
  onChange: (filteredIds: Set<string> | null) => void
  onDateChange?: (ts: number) => void
  playing: boolean
  playSpeed: number
  onPlayChange: (playing: boolean) => void
  onSpeedChange: (speed: number) => void
  activePreset?: string
  onPresetChange?: (preset: string) => void
}

type Preset = '1D' | '1W' | '1M' | '1Y' | 'ALL'

// Days advanced per second for each speed tier
const SPEED_DAYS: Record<number, number> = { 1: 1, 2: 2, 5: 5, 10: 10, 20: 20 }

function getPresetRange(preset: Preset): [Date, Date] | null {
  if (preset === 'ALL') return null
  const now = new Date()
  const start = new Date(now)
  switch (preset) {
    case '1D': start.setDate(now.getDate() - 1); break
    case '1W': start.setDate(now.getDate() - 7); break
    case '1M': start.setMonth(now.getMonth() - 1); break
    case '1Y': start.setFullYear(now.getFullYear() - 1); break
  }
  return [start, now]
}

export function TimeFilter({ nodes, onChange, onDateChange, playing, playSpeed, onPlayChange, onSpeedChange, activePreset: controlledPreset, onPresetChange }: TimeFilterProps) {
  const { minTs, maxTs } = useMemo(() => {
    const timestamps = nodes.map(n => new Date(n.createdAt).getTime()).filter(Boolean)
    return {
      minTs: Math.min(...timestamps),
      maxTs: Math.max(...timestamps),
    }
  }, [nodes])

  const [preset, setPreset] = useState<Preset>('ALL')
  const [range, setRange] = useState<[number, number]>([minTs, maxTs])
  const [, setDragging] = useState<'start' | 'end' | null>(null)

  // Keep a stable ref to onChange/onDateChange to avoid stale closures in interval
  const onChangeRef = useRef(onChange)
  const onDateChangeRef = useRef(onDateChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onDateChangeRef.current = onDateChange }, [onDateChange])

  // Sync controlled preset from parent (e.g. loading a saved preset)
  useEffect(() => {
    if (controlledPreset && controlledPreset !== preset) {
      const valid: Preset[] = ['1D', '1W', '1M', '1Y', 'ALL']
      if (valid.includes(controlledPreset as Preset)) {
        applyPreset(controlledPreset as Preset)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledPreset])

  const applyPreset = (p: Preset) => {
    setPreset(p)
    onPresetChange?.(p)
    const r = getPresetRange(p)
    if (!r) {
      setRange([minTs, maxTs])
      onChange(null)
    } else {
      const [s, e] = r
      setRange([s.getTime(), e.getTime()])
      const filtered = new Set(
        nodes
          .filter(n => {
            const t = new Date(n.createdAt).getTime()
            return t >= s.getTime() && t <= e.getTime()
          })
          .map(n => n.id)
      )
      onChange(filtered.size === nodes.length ? null : filtered)
    }
  }

  const handleRangeChange = (handle: 'start' | 'end', value: number) => {
    const newRange: [number, number] = handle === 'start'
      ? [Math.min(value, range[1]), range[1]]
      : [range[0], Math.max(value, range[0])]
    setRange(newRange)
    setPreset('ALL')
    onPresetChange?.('ALL')

    if (newRange[0] <= minTs && newRange[1] >= maxTs) {
      onChange(null)
    } else {
      const filtered = new Set(
        nodes
          .filter(n => {
            const t = new Date(n.createdAt).getTime()
            return t >= newRange[0] && t <= newRange[1]
          })
          .map(n => n.id)
      )
      onChange(filtered)
    }
    onDateChange?.(newRange[1])
  }

  // Track range in a ref so the interval can read current value without
  // using a functional setRange updater (which runs during React's render
  // phase and would trigger "setState during render" warnings).
  const rangeRef = useRef(range)
  useEffect(() => { rangeRef.current = range }, [range])

  // Auto-advance upper bound during playback
  useEffect(() => {
    if (!playing) return
    const daysPerSec = SPEED_DAYS[playSpeed] ?? 1
    const TICK_MS = 50
    const ticksPerSec = 1000 / TICK_MS  // 20 ticks per second
    const msPerTick = (daysPerSec * 86400000) / ticksPerSec

    const id = setInterval(() => {
      const prev = rangeRef.current
      const newEnd = Math.min(prev[1] + msPerTick, maxTs)
      const next: [number, number] = [prev[0], newEnd]

      rangeRef.current = next
      setRange(next)

      const filtered = new Set(
        nodes
          .filter(n => {
            const t = new Date(n.createdAt).getTime()
            return t >= next[0] && t <= next[1]
          })
          .map(n => n.id)
      )
      onChangeRef.current(filtered.size === nodes.length ? null : filtered)
      onDateChangeRef.current?.(newEnd)

      if (newEnd >= maxTs) {
        onPlayChange(false)
      }
    }, TICK_MS)

    return () => clearInterval(id)
  }, [playing, playSpeed, maxTs, nodes, onPlayChange])

  // Reset: rewind to the earliest date and pause
  const handleReset = () => {
    onPlayChange(false)
    const next: [number, number] = [minTs, minTs]
    setRange(next)
    setPreset('ALL')
    onPresetChange?.('ALL')
    const filtered = new Set(
      nodes
        .filter(n => new Date(n.createdAt).getTime() <= minTs)
        .map(n => n.id)
    )
    onChange(filtered.size === 0 ? null : filtered)
    onDateChange?.(minTs)
  }

  const span = maxTs - minTs || 1
  const startPct = ((range[0] - minTs) / span) * 100
  const endPct = ((range[1] - minTs) / span) * 100

  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
  const fmtPlayDate = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

  const presets: Preset[] = ['1D', '1W', '1M', '1Y', 'ALL']
  const speeds = [1, 2, 5, 10, 20] as const

  const btnBase: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid #1a3a4a',
    color: '#00a8cc',
    borderRadius: 4,
    padding: '3px 8px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 11,
    letterSpacing: '0.05em',
  }
  const btnActive: React.CSSProperties = {
    ...btnBase,
    background: '#00d4ff22',
    border: '1px solid #00d4ff',
    color: '#00d4ff',
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.88)',
      border: '1px solid #1a3a4a',
      borderRadius: 8,
      padding: '10px 20px',
      width: 420,
      zIndex: 50,
      fontFamily: '"Courier New", monospace',
      fontSize: 12,
      color: '#00a8cc',
      boxShadow: '0 0 15px #00d4ff22',
    }}>
      {/* Preset buttons */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, justifyContent: 'center' }}>
        {presets.map(p => (
          <button
            key={p}
            onClick={() => applyPreset(p)}
            style={preset === p ? btnActive : btnBase}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Range slider track */}
      <div style={{ position: 'relative', height: 16, margin: '4px 0' }}>
        {/* Track */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: 0,
          right: 0,
          height: 2,
          background: '#1a3a4a',
          transform: 'translateY(-50%)',
          borderRadius: 2,
        }} />
        {/* Active range */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: `${startPct}%`,
          width: `${endPct - startPct}%`,
          height: 2,
          background: '#00d4ff',
          transform: 'translateY(-50%)',
          borderRadius: 2,
        }} />
        {/* Start handle */}
        <input
          type="range"
          min={minTs}
          max={maxTs}
          value={range[0]}
          onChange={e => handleRangeChange('start', Number(e.target.value))}
          onMouseDown={() => setDragging('start')}
          onMouseUp={() => setDragging(null)}
          style={{
            position: 'absolute',
            width: '100%',
            opacity: 0,
            cursor: 'ew-resize',
            height: '100%',
            top: 0,
            left: 0,
            zIndex: 2,
          }}
        />
        {/* End handle */}
        <input
          type="range"
          min={minTs}
          max={maxTs}
          value={range[1]}
          onChange={e => handleRangeChange('end', Number(e.target.value))}
          onMouseDown={() => setDragging('end')}
          onMouseUp={() => setDragging(null)}
          style={{
            position: 'absolute',
            width: '100%',
            opacity: 0,
            cursor: 'ew-resize',
            height: '100%',
            top: 0,
            left: 0,
            zIndex: 3,
          }}
        />
        {/* Visual handles */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: `${startPct}%`,
          transform: 'translate(-50%, -50%)',
          width: 10,
          height: 10,
          background: '#00d4ff',
          borderRadius: '50%',
          border: '2px solid #000',
          zIndex: 1,
        }} />
        <div style={{
          position: 'absolute',
          top: '50%',
          left: `${endPct}%`,
          transform: 'translate(-50%, -50%)',
          width: 10,
          height: 10,
          background: '#00d4ff',
          borderRadius: '50%',
          border: '2px solid #000',
          zIndex: 1,
        }} />
      </div>

      {/* Date labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: '#00a8cc99' }}>
        <span>{fmtDate(range[0])}</span>
        <span>{fmtDate(range[1])}</span>
      </div>

      {/* Playback controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, justifyContent: 'center' }}>
        {/* Reset */}
        <button onClick={handleReset} style={btnBase} title="Reset to start">⏮</button>
        {/* Play / Pause */}
        <button
          onClick={() => {
            if (!playing) {
              // Auto-reset to start if already at the end
              if (range[1] >= maxTs - 86400000) {
                const next: [number, number] = [minTs, minTs]
                setRange(next)
                rangeRef.current = next
                const filtered = new Set(
                  nodes.filter(n => new Date(n.createdAt).getTime() <= minTs).map(n => n.id)
                )
                onChange(filtered.size === 0 ? null : filtered)
                onDateChange?.(minTs)
              }
            }
            onPlayChange(!playing)
          }}
          style={{ ...btnBase, background: playing ? '#00d4ff22' : 'transparent', border: `1px solid ${playing ? '#00d4ff' : '#1a3a4a'}`, color: '#00d4ff', padding: '3px 12px' }}
          title={playing ? 'Pause' : 'Play timelapse'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        {/* Speed selector */}
        {speeds.map(s => (
          <button
            key={s}
            onClick={() => onSpeedChange(s)}
            style={playSpeed === s ? btnActive : btnBase}
            title={`${SPEED_DAYS[s]}d/sec`}
          >
            {s}×
          </button>
        ))}
        {/* Current date during playback */}
        {playing && (
          <span style={{ color: '#00d4ff', fontSize: 11, letterSpacing: '0.04em', marginLeft: 4 }}>
            {fmtPlayDate(range[1])}
          </span>
        )}
      </div>
    </div>
  )
}
