import { useState } from 'react'
import { PresetManager } from './PresetManager'
import type { Preset } from '../hooks/usePresets'

interface SettingsProps {
  bloomEnabled: boolean
  nodeOpacity: number
  starsEnabled: boolean
  labelsEnabled: boolean
  linksEnabled: boolean
  spread: number
  minNodeSize: number
  maxNodeSize: number
  ultraNodeSize: number
  onBloomToggle: (enabled: boolean) => void
  onOpacityChange: (value: number) => void
  onStarsToggle: (enabled: boolean) => void
  onLabelsToggle: (enabled: boolean) => void
  onLinksToggle: (enabled: boolean) => void
  onSpreadChange: (value: number) => void
  onMinSizeChange: (value: number) => void
  onMaxSizeChange: (value: number) => void
  onUltraNodeSizeChange: (value: number) => void
  onResetAll: () => void
  onResetPosition: () => void
  onChangeVault: () => void
  zoomToNode: boolean
  onZoomToNodeToggle: (v: boolean) => void
  graphShape: 'sun' | 'saturn' | 'milkyway' | 'brain' | 'natural' | 'tagboxes'
  onGraphShapeChange: (v: 'sun' | 'saturn' | 'milkyway' | 'brain' | 'natural' | 'tagboxes') => void
  tagBoxTopN: number
  onTagBoxTopNChange: (v: number) => void
  tagBoxSizeScale: number
  onTagBoxSizeScaleChange: (v: number) => void
  presets: Preset[]
  onPresetSave: (name: string) => void
  onPresetLoad: (id: string) => void
  onPresetDelete: (id: string) => void
}

export function Settings({
  bloomEnabled,
  nodeOpacity,
  starsEnabled,
  labelsEnabled,
  linksEnabled,
  spread,
  minNodeSize,
  maxNodeSize,
  ultraNodeSize,
  onBloomToggle,
  onOpacityChange,
  onStarsToggle,
  onLabelsToggle,
  onLinksToggle,
  onSpreadChange,
  onMinSizeChange,
  onMaxSizeChange,
  onUltraNodeSizeChange,
  onResetAll,
  onResetPosition,
  onChangeVault,
  zoomToNode,
  onZoomToNodeToggle,
  graphShape,
  onGraphShapeChange,
  tagBoxTopN,
  onTagBoxTopNChange,
  tagBoxSizeScale,
  onTagBoxSizeScaleChange,
  presets,
  onPresetSave,
  onPresetLoad,
  onPresetDelete,
}: SettingsProps) {
  const [hoveredShape, setHoveredShape] = useState<string | null>(null)
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
      top: 134,
      left: 16,
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
            <div style={{ marginBottom: 6, letterSpacing: '0.08em', fontSize: 10, color: '#585b70' }}>LINKS</div>
            {toggleBtn(linksEnabled, `[ LINKS ${linksEnabled ? 'ON' : 'OFF'} ]`, () => onLinksToggle(!linksEnabled))}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ marginBottom: 6, letterSpacing: '0.08em', fontSize: 10, color: '#585b70' }}>ZOOM TO NODE</div>
            {toggleBtn(zoomToNode, `[ ZOOM TO NODE ${zoomToNode ? 'ON' : 'OFF'} ]`, () => onZoomToNodeToggle(!zoomToNode))}
          </div>

          {sliderRow(`OPACITY: ${nodeOpacity.toFixed(2)}`, nodeOpacity, 0.1, 1.0, 0.05, onOpacityChange)}
          {sliderRow(`SPREAD: ${spread.toFixed(1)}x`, spread, 1.0, 10.0, 0.1, onSpreadChange)}
          {graphShape === 'tagboxes' && sliderRow(`TOP TAGS: ${tagBoxTopN}`, tagBoxTopN, 1, 48, 1, (v) => onTagBoxTopNChange(v))}
          {graphShape === 'tagboxes' && sliderRow(`BOX SIZE: ${tagBoxSizeScale.toFixed(1)}x`, tagBoxSizeScale, 0.5, 3.0, 0.1, (v) => onTagBoxSizeScaleChange(v))}
          {sliderRow(`NODE SIZE: ${minNodeSize.toFixed(1)}x`, minNodeSize, 1.0, 2.0, 0.1, onMinSizeChange)}

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

          <div style={{ marginBottom: 14 }}>
            <div style={{ marginBottom: 6, letterSpacing: '0.08em', fontSize: 10, color: '#585b70' }}>
              ULTRANODE SIZE: {ultraNodeSize.toFixed(1)}x
            </div>
            <input
              type="range"
              min={1}
              max={8}
              step={0.5}
              value={ultraNodeSize}
              onChange={e => onUltraNodeSizeChange(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#00d4ff', cursor: 'pointer' }}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ marginBottom: 6, letterSpacing: '0.08em', fontSize: 10, color: '#585b70' }}>SHAPE</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
              {([
                { value: 'natural', icon: '🌿', label: 'Natural' },
                { value: 'sun', icon: '☀️', label: 'The Sun' },

                { value: 'saturn', icon: '🪐', label: 'Saturn' },
                { value: 'milkyway', icon: '🌌', label: 'Milky Way' },
                { value: 'brain', icon: '🧠', label: 'Brain' },
                { value: 'tagboxes', icon: '🗃️', label: 'Tag Boxes' },
              ] as const).map(({ value, icon, label }) => {
                const isSelected = graphShape === value
                const isHovered = hoveredShape === value
                return (
                  <button
                    key={value}
                    onClick={() => onGraphShapeChange(value)}
                    onMouseEnter={() => setHoveredShape(value)}
                    onMouseLeave={() => setHoveredShape(null)}
                    title={label}
                    style={{
                      background: isSelected ? '#00d4ff22' : isHovered ? '#00d4ff0d' : 'rgba(0,0,0,0.5)',
                      border: `1px solid ${isSelected ? '#00d4ff' : isHovered ? '#00d4ff66' : '#1a3a4a'}`,
                      color: isSelected ? '#00d4ff' : isHovered ? '#00a8cc' : '#585b70',
                      borderRadius: 4,
                      padding: '10px 4px 8px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: 10,
                      letterSpacing: '0.05em',
                      textAlign: 'center',
                      boxShadow: isSelected ? '0 0 8px #00d4ff44' : 'none',
                      transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
                    }}
                  >
                    <span style={{ fontSize: 20, display: 'block', marginBottom: 4 }}>{icon}</span>
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <PresetManager
            presets={presets}
            onSave={onPresetSave}
            onLoad={onPresetLoad}
            onDelete={onPresetDelete}
          />

          <div style={{ borderTop: '1px solid #1a3a4a', paddingTop: 14, marginBottom: 0 }}>
            {toggleBtn(false, '[ RESET ALL ]', onResetAll)}
            <div style={{ marginTop: 8 }}>
              {toggleBtn(false, '[ Reset View ]', onResetPosition)}
            </div>
            <div style={{ marginTop: 8 }}>
              {toggleBtn(false, '⚙ Change Vault', onChangeVault)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
