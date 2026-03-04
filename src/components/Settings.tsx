import { useState } from 'react'

interface SettingsProps {
  bloomEnabled: boolean
  nodeOpacity: number
  starsEnabled: boolean
  labelsEnabled: boolean
  spread: number
  minNodeSize: number
  maxNodeSize: number
  onBloomToggle: (enabled: boolean) => void
  onOpacityChange: (value: number) => void
  onStarsToggle: (enabled: boolean) => void
  onLabelsToggle: (enabled: boolean) => void
  onSpreadChange: (value: number) => void
  onMinSizeChange: (value: number) => void
  onMaxSizeChange: (value: number) => void
  onResetAll: () => void
  onResetPosition: () => void
  zoomToNode: boolean
  onZoomToNodeToggle: (v: boolean) => void
}

export function Settings({
  bloomEnabled,
  nodeOpacity,
  starsEnabled,
  labelsEnabled,
  spread,
  minNodeSize,
  maxNodeSize,
  onBloomToggle,
  onOpacityChange,
  onStarsToggle,
  onLabelsToggle,
  onSpreadChange,
  onMinSizeChange,
  onMaxSizeChange,
  onResetAll,
  onResetPosition,
  zoomToNode,
  onZoomToNodeToggle,
}: SettingsProps) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('jarvis-settings-open') !== 'false' } catch { return true }
  })
  const toggleOpen = (v: boolean) => {
    setOpen(v)
    try { localStorage.setItem('jarvis-settings-open', String(v)) } catch { // storage unavailable
    }
  }

  const toggleBtn = (active: boolean, label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      style={{
        background: active ? '#00d4ff22' : 'rgba(0,0,0,0.5)',
        border: `1px solid ${active ? '#00d4ff' : '#1a3a4a'}`,
        color: active ? '#00d4ff' : '#585b70',
        borderRadius: 4,
        padding: '4px 12px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: 11,
        letterSpacing: '0.08em',
        width: '100%',
      }}
    >{label}</button>
  )

  const sliderRow = (label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ marginBottom: 6, letterSpacing: '0.08em', fontSize: 10, color: '#585b70' }}>
        {label}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#00d4ff', cursor: 'pointer' }}
      />
    </div>
  )

  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: 16,
      transform: 'translateY(-50%)',
      zIndex: 150,
      fontFamily: '"Courier New", monospace',
      fontSize: 12,
    }}>
      <button
        onClick={() => toggleOpen(!open)}
        title="Settings"
        style={{
          background: open ? '#00d4ff22' : 'rgba(0,0,0,0.7)',
          border: `1px solid ${open ? '#00d4ff' : '#1a3a4a'}`,
          color: open ? '#00d4ff' : '#00a8cc',
          borderRadius: 4,
          padding: '6px 10px',
          cursor: 'pointer',
          fontSize: 14,
        }}
      >⚙</button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: '100%',
          marginLeft: 8,
          background: 'rgba(0,0,0,0.92)',
          border: '1px solid #1a3a4a',
          borderRadius: 6,
          padding: '14px 16px',
          width: 224,
          boxShadow: '0 0 15px #00d4ff22',
          color: '#00a8cc',
          maxHeight: '80vh',
          overflowY: 'auto',
        }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ marginBottom: 6, letterSpacing: '0.08em', fontSize: 10, color: '#585b70' }}>BLOOM</div>
            {toggleBtn(bloomEnabled, `[ BLOOM ${bloomEnabled ? 'ON' : 'OFF'} ]`, () => onBloomToggle(!bloomEnabled))}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ marginBottom: 6, letterSpacing: '0.08em', fontSize: 10, color: '#585b70' }}>STARS</div>
            {toggleBtn(starsEnabled, `[ STARS ${starsEnabled ? 'ON' : 'OFF'} ]`, () => onStarsToggle(!starsEnabled))}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ marginBottom: 6, letterSpacing: '0.08em', fontSize: 10, color: '#585b70' }}>LABELS</div>
            {toggleBtn(labelsEnabled, `[ LABELS ${labelsEnabled ? 'ON' : 'OFF'} ]`, () => onLabelsToggle(!labelsEnabled))}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ marginBottom: 6, letterSpacing: '0.08em', fontSize: 10, color: '#585b70' }}>ZOOM TO NODE</div>
            {toggleBtn(zoomToNode, `[ ZOOM TO NODE ${zoomToNode ? 'ON' : 'OFF'} ]`, () => onZoomToNodeToggle(!zoomToNode))}
          </div>

          {sliderRow(`OPACITY: ${nodeOpacity.toFixed(2)}`, nodeOpacity, 0.1, 1.0, 0.05, onOpacityChange)}
          {sliderRow(`SPREAD: ${spread.toFixed(1)}x`, spread, 1.0, 10.0, 0.1, onSpreadChange)}
          {sliderRow(`MIN SIZE: ${minNodeSize.toFixed(1)}x`, minNodeSize, 1.0, 2.0, 0.1, onMinSizeChange)}

          <div style={{ marginBottom: 14 }}>
            <div style={{ marginBottom: 6, letterSpacing: '0.08em', fontSize: 10, color: '#585b70' }}>
              SUPERNODE SIZE: {maxNodeSize.toFixed(1)}x
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={0.1}
              value={maxNodeSize}
              onChange={e => onMaxSizeChange(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#00d4ff', cursor: 'pointer' }}
            />
          </div>

          <div style={{ borderTop: '1px solid #1a3a4a', paddingTop: 14, marginBottom: 0 }}>
            {toggleBtn(false, '[ RESET ALL ]', onResetAll)}
            <div style={{ marginTop: 8 }}>
              {toggleBtn(false, '[ Reset View ]', onResetPosition)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
