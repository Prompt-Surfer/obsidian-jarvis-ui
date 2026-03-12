import { useState } from 'react'
import type { Preset } from '../hooks/usePresets'

interface PresetManagerProps {
  presets: Preset[]
  onSave: (name: string) => void
  onLoad: (id: string) => void
  onDelete: (id: string) => void
}

function presetSubtitle(p: Preset): string {
  const parts: string[] = []
  if (p.favourites.length > 0) parts.push(`${p.favourites.length} fav`)
  if (p.filters.tagIsolationTags.length > 0) {
    parts.push(p.filters.tagIsolationTags.map(t => `#${t}`).join(' '))
  }
  if (p.filters.timeRange) parts.push(p.filters.timeRange)
  parts.push(p.settings.graphShape)
  return parts.join(', ')
}

export function PresetManager({ presets, onSave, onLoad, onDelete }: PresetManagerProps) {
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')

  const handleSave = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed)
    setName('')
    setSaving(false)
  }

  return (
    <div style={{ borderTop: '1px solid #1a3a4a', paddingTop: 14, marginBottom: 14 }}>
      <div style={{ marginBottom: 8, letterSpacing: '0.08em', fontSize: 10, color: '#585b70' }}>
        PRESETS
      </div>

      {/* Save button / inline input */}
      {saving ? (
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') { setSaving(false); setName('') }
            }}
            placeholder="Preset name..."
            style={{
              flex: 1,
              background: 'rgba(0,0,0,0.6)',
              border: '1px solid #00d4ff66',
              borderRadius: 3,
              color: '#cdd6f4',
              fontFamily: 'inherit',
              fontSize: 11,
              padding: '3px 6px',
              outline: 'none',
            }}
          />
          <button
            onClick={handleSave}
            style={{
              background: '#00d4ff22',
              border: '1px solid #00d4ff',
              color: '#00d4ff',
              borderRadius: 3,
              padding: '3px 8px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 10,
            }}
          >OK</button>
          <button
            onClick={() => { setSaving(false); setName('') }}
            style={{
              background: 'rgba(0,0,0,0.5)',
              border: '1px solid #1a3a4a',
              color: '#585b70',
              borderRadius: 3,
              padding: '3px 6px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 10,
            }}
          >ESC</button>
        </div>
      ) : (
        <button
          onClick={() => setSaving(true)}
          style={{
            width: '100%',
            background: 'rgba(0,0,0,0.5)',
            border: '1px solid #1a3a4a',
            color: '#00a8cc',
            borderRadius: 4,
            padding: '4px 12px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 11,
            letterSpacing: '0.08em',
            marginBottom: 10,
          }}
        >[ + SAVE PRESET ]</button>
      )}

      {/* Preset list */}
      {presets.length === 0 ? (
        <div style={{ color: '#3a4a5a', fontSize: 10, fontStyle: 'italic' }}>No saved presets</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {presets.map(p => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid #1a3a4a',
                borderRadius: 3,
                padding: '5px 8px',
              }}
            >
              <div
                onClick={() => onLoad(p.id)}
                style={{
                  flex: 1,
                  cursor: 'pointer',
                  minWidth: 0,
                }}
              >
                <div style={{
                  color: '#00d4ff',
                  fontSize: 11,
                  letterSpacing: '0.04em',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>{p.name}</div>
                <div style={{
                  color: '#3a5a6a',
                  fontSize: 9,
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>{presetSubtitle(p)}</div>
              </div>
              <span
                onClick={() => onDelete(p.id)}
                style={{
                  color: '#4a3a3a',
                  cursor: 'pointer',
                  fontSize: 14,
                  lineHeight: 1,
                  flexShrink: 0,
                  marginTop: 2,
                }}
                title="Delete preset"
              >x</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
