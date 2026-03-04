import { useMemo, useState } from 'react'
import type { GraphNode } from '../hooks/useVaultGraph'

interface TimeFilterProps {
  nodes: GraphNode[]
  onChange: (filteredIds: Set<string> | null) => void
}

type Preset = '1D' | '1W' | '1M' | '1Y' | 'ALL'

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

export function TimeFilter({ nodes, onChange }: TimeFilterProps) {
  const { minTs, maxTs } = useMemo(() => {
    const timestamps = nodes.map(n => new Date(n.modifiedAt).getTime()).filter(Boolean)
    return {
      minTs: Math.min(...timestamps),
      maxTs: Math.max(...timestamps),
    }
  }, [nodes])

  const [preset, setPreset] = useState<Preset>('ALL')
  const [range, setRange] = useState<[number, number]>([minTs, maxTs])
  const [, setDragging] = useState<'start' | 'end' | null>(null)

  const applyPreset = (p: Preset) => {
    setPreset(p)
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
            const t = new Date(n.modifiedAt).getTime()
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

    if (newRange[0] <= minTs && newRange[1] >= maxTs) {
      onChange(null)
    } else {
      const filtered = new Set(
        nodes
          .filter(n => {
            const t = new Date(n.modifiedAt).getTime()
            return t >= newRange[0] && t <= newRange[1]
          })
          .map(n => n.id)
      )
      onChange(filtered)
    }
  }

  const span = maxTs - minTs || 1
  const startPct = ((range[0] - minTs) / span) * 100
  const endPct = ((range[1] - minTs) / span) * 100

  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })

  const presets: Preset[] = ['1D', '1W', '1M', '1Y', 'ALL']

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
      width: 400,
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
            style={{
              background: preset === p ? '#00d4ff22' : 'transparent',
              border: `1px solid ${preset === p ? '#00d4ff' : '#1a3a4a'}`,
              color: preset === p ? '#00d4ff' : '#00a8cc',
              borderRadius: 4,
              padding: '3px 10px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 11,
              letterSpacing: '0.05em',
            }}
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
    </div>
  )
}
