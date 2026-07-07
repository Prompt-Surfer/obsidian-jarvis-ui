// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { PresetManager } from './PresetManager'
import type { Preset } from '../hooks/usePresets'
import type { GraphShape } from '../shapes/types'
import { importedShapes, casberryShapeId, casberryShapeName, parseCasberryInput } from '../shapes/registry'
import { fetchFormationCatalog, fetchFormation, casberryShareUrl, type CatalogEntry } from '../shapes/casberry'

// Clipboard with a fallback for insecure origins (LAN http), where
// navigator.clipboard is unavailable.
function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy') } finally { document.body.removeChild(ta) }
  return Promise.resolve()
}

interface SettingsProps {
  bloomStrength: number
  nodeOpacity: number
  starsEnabled: boolean
  labelsEnabled: boolean
  linksEnabled: boolean
  spread: number
  minNodeSize: number
  maxNodeSize: number
  ultraNodeSize: number
  minDistRegular: number
  minDistSuper: number
  minDistUltra: number
  onBloomStrengthChange: (value: number) => void
  onOpacityChange: (value: number) => void
  onStarsToggle: (enabled: boolean) => void
  onLabelsToggle: (enabled: boolean) => void
  onLinksToggle: (enabled: boolean) => void
  onSpreadChange: (value: number) => void
  onMinSizeChange: (value: number) => void
  onMaxSizeChange: (value: number) => void
  onUltraNodeSizeChange: (value: number) => void
  onMinDistRegularChange: (value: number) => void
  onMinDistSuperChange: (value: number) => void
  onMinDistUltraChange: (value: number) => void
  onResetAll: () => void
  onResetPosition: () => void
  onChangeVault: () => void
  zoomToNode: boolean
  onZoomToNodeToggle: (v: boolean) => void
  graphShape: GraphShape
  onGraphShapeChange: (v: GraphShape) => void
  autoRotate: boolean
  onAutoRotateToggle: (v: boolean) => void
  shapeMotion: boolean
  onShapeMotionToggle: (v: boolean) => void
  textSize: number
  onTextSizeChange: (v: number) => void
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
  bloomStrength,
  nodeOpacity,
  starsEnabled,
  labelsEnabled,
  linksEnabled,
  spread,
  minNodeSize,
  maxNodeSize,
  ultraNodeSize,
  minDistRegular,
  minDistSuper,
  minDistUltra,
  onBloomStrengthChange,
  onOpacityChange,
  onStarsToggle,
  onLabelsToggle,
  onLinksToggle,
  onSpreadChange,
  onMinSizeChange,
  onMaxSizeChange,
  onUltraNodeSizeChange,
  onMinDistRegularChange,
  onMinDistSuperChange,
  onMinDistUltraChange,
  onResetAll,
  onResetPosition,
  onChangeVault,
  zoomToNode,
  onZoomToNodeToggle,
  graphShape,
  onGraphShapeChange,
  autoRotate,
  onAutoRotateToggle,
  shapeMotion,
  onShapeMotionToggle,
  textSize,
  onTextSizeChange,
  tagBoxTopN,
  onTagBoxTopNChange,
  tagBoxSizeScale,
  onTagBoxSizeScaleChange,
  presets,
  onPresetSave,
  onPresetLoad,
  onPresetDelete,
}: SettingsProps) {
  const prevBloom = useRef(bloomStrength > 0 ? bloomStrength : 1.5)
  const [hoveredShape, setHoveredShape] = useState<string | null>(null)
  // Community-cloud formations the user has loaded (names only; code is fetched on demand)
  const [communityShapes, setCommunityShapes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('jarvis-community-shapes') ?? '[]') } catch { return [] }
  })
  const [communityInput, setCommunityInput] = useState('')
  const [communityOpen, setCommunityOpen] = useState(false)
  const [communityAnchor, setCommunityAnchor] = useState<{ top: number; left: number } | null>(null)
  const communityBtnRef = useRef<HTMLButtonElement | null>(null)
  const communityMenuRef = useRef<HTMLDivElement | null>(null)
  const selectCommunityShape = (name: string) => {
    if (!communityShapes.includes(name)) {
      const next = [...communityShapes, name]
      setCommunityShapes(next)
      try { localStorage.setItem('jarvis-community-shapes', JSON.stringify(next)) } catch { /* */ }
    }
    onGraphShapeChange(casberryShapeId(name))
    // menu stays open — it closes via the trigger button or a graph click
  }
  const loadCommunityShape = () => {
    const name = parseCasberryInput(communityInput)
    if (!name) return
    selectCommunityShape(name)
    setCommunityInput('')
  }
  const toggleCommunityMenu = () => {
    if (!communityOpen && communityBtnRef.current) {
      const r = communityBtnRef.current.getBoundingClientRect()
      // Fly out to the right of the settings panel, clamped to the viewport
      setCommunityAnchor({ top: Math.max(12, Math.min(r.top, window.innerHeight - 540)), left: r.right + 16 })
      ensureCatalog()
    }
    setCommunityOpen((v) => !v)
  }
  useEffect(() => {
    if (!communityOpen) return
    // Close only on a graph (canvas) click or the trigger button (its own
    // toggle handles that) — clicks elsewhere in the settings panel keep it open
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (communityMenuRef.current?.contains(t) || communityBtnRef.current?.contains(t)) return
      if ((t as HTMLElement).tagName === 'CANVAS') setCommunityOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [communityOpen])
  const activeCommunityName = casberryShapeName(graphShape)
  // Static ports (blackhole, …) live in the same flyout now — one loader menu
  const activeImportedStatic = importedShapes.find((s) => graphShape === `imported:${s.id}`)
  const activeImportedLabel = activeCommunityName ?? activeImportedStatic?.label ?? null
  const activeImportedIcon = activeImportedStatic?.icon ?? '☁️'
  const minDistApplies = graphShape === 'natural'
  // JARVIS MATRIX is pinned on top; saved shapes follow
  const PINNED_COMMUNITY = ['JARVIS MATRIX']
  const communityMenu = [
    ...PINNED_COMMUNITY,
    ...communityShapes.filter((n) => !PINNED_COMMUNITY.includes(n)),
  ]
  // Full upstream catalog (newest first, like the site's gallery), cached 1h
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('jarvis-community-catalog-v2') ?? 'null')
      if (raw && Date.now() - raw.ts < 3600_000 && Array.isArray(raw.entries)) return raw.entries
    } catch { /* */ }
    return null
  })
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const catalogFetchingRef = useRef(false)
  const ensureCatalog = () => {
    if (catalog || catalogFetchingRef.current) return
    catalogFetchingRef.current = true
    fetchFormationCatalog()
      .then((entries) => {
        setCatalog(entries)
        setCatalogError(null)
        try { localStorage.setItem('jarvis-community-catalog-v2', JSON.stringify({ ts: Date.now(), entries })) } catch { /* */ }
      })
      .catch((e) => setCatalogError(String(e)))
      .finally(() => { catalogFetchingRef.current = false })
  }
  // Copy code / share link feedback: key = `${kind}:${name}` while showing ✓
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const flashCopied = (key: string) => {
    setCopiedKey(key)
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200)
  }
  const copyShapeCode = (name: string) => {
    fetchFormation(name)
      .then((f) => copyText(f.code))
      .then(() => flashCopied(`code:${name}`))
      .catch(() => flashCopied(`err:${name}`))
  }
  const copyShareLink = (name: string) => {
    copyText(casberryShareUrl(name)).then(() => flashCopied(`link:${name}`))
  }
  // The input doubles as list filter and name/URL loader
  const filterText = communityInput.trim()
  const filterIsUrl = /^https?:\/\//i.test(filterText)
  const matchesFilter = (n: string) => !filterText || filterIsUrl || n.toLowerCase().includes(filterText.toLowerCase())
  const menuTop = communityMenu.filter(matchesFilter)
  const catalogMap = useMemo(() => new Map((catalog ?? []).map((e) => [e.name, e.publisher])), [catalog])
  const catalogRest = (catalog ?? []).map((e) => e.name).filter((n) => !communityMenu.includes(n) && matchesFilter(n))
  const miniBtnStyle = {
    background: 'transparent',
    color: '#4a6a7a',
    border: '1px solid transparent',
    borderRadius: 4,
    padding: '4px 4px',
    fontFamily: 'inherit',
    fontSize: 11,
    cursor: 'pointer',
    flexShrink: 0,
  } as const
  const communityItem = (name: string) => {
    const active = graphShape === casberryShapeId(name)
    const author = catalogMap.get(name)
    return (
      <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <button
          onClick={() => selectCommunityShape(name)}
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: 'left',
            background: active ? 'rgba(0,212,255,0.12)' : 'transparent',
            color: active ? '#00d4ff' : '#8fa3ad',
            border: `1px solid ${active ? '#00d4ff88' : 'transparent'}`,
            borderRadius: 4,
            padding: '6px 8px',
            fontFamily: 'inherit',
            fontSize: 11,
            letterSpacing: '0.05em',
            cursor: 'pointer',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          ☁️ {name}
          {author ? <span style={{ color: '#585b70', fontSize: 9 }}> by {author}</span> : null}
        </button>
        <button
          title="Copy formation code"
          onClick={() => copyShapeCode(name)}
          style={{ ...miniBtnStyle, color: copiedKey === `code:${name}` ? '#00ff9d' : copiedKey === `err:${name}` ? '#ff6b6b' : miniBtnStyle.color }}
        >
          {copiedKey === `code:${name}` ? '✓' : copiedKey === `err:${name}` ? '✕' : '⧉'}
        </button>
        <button
          title="Copy share link"
          onClick={() => copyShareLink(name)}
          style={{ ...miniBtnStyle, color: copiedKey === `link:${name}` ? '#00ff9d' : miniBtnStyle.color }}
        >
          {copiedKey === `link:${name}` ? '✓' : '🔗'}
        </button>
      </div>
    )
  }
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
            <div
              onClick={() => onBloomStrengthChange(bloomStrength > 0 ? 0 : (prevBloom.current || 1.5))}
              style={{ marginBottom: 6, letterSpacing: '0.08em', fontSize: 10, color: '#585b70', cursor: 'pointer', userSelect: 'none' }}
            >
              BLOOM: {bloomStrength > 0 ? bloomStrength.toFixed(1) : 'OFF'}
            </div>
            <input
              type="range"
              min={0}
              max={3}
              step={0.1}
              value={bloomStrength}
              onChange={e => {
                const v = Number(e.target.value)
                if (v > 0) prevBloom.current = v
                onBloomStrengthChange(v)
              }}
              style={{ width: '100%', accentColor: '#00d4ff', cursor: 'pointer' }}
            />
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
          {sliderRow(`TEXT SIZE: ${textSize.toFixed(1)}x`, textSize, 1.0, 10.0, 0.5, onTextSizeChange)}
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

          {/* Min-distance drives the collide force, which only exists in the
              natural layout — shape formulas dominate everywhere else. */}
          <div style={{ marginBottom: 6, letterSpacing: '0.08em', fontSize: 10, color: '#585b70', borderTop: '1px solid #1a3a4a', paddingTop: 14 }}>
            MIN DISTANCE{minDistApplies ? '' : ' · NATURAL ONLY'}
          </div>
          <div style={minDistApplies ? undefined : { opacity: 0.3, pointerEvents: 'none', filter: 'grayscale(1)' }} aria-disabled={!minDistApplies}>
            {sliderRow(`MIN DIST · NODE: ${minDistRegular.toFixed(0)}`, minDistRegular, 4, 40, 1, onMinDistRegularChange)}
            {sliderRow(`MIN DIST · SUPER: ${minDistSuper.toFixed(0)}`, minDistSuper, 10, 120, 1, onMinDistSuperChange)}
            {sliderRow(`MIN DIST · ULTRA: ${minDistUltra.toFixed(0)}`, minDistUltra, 20, 240, 1, onMinDistUltraChange)}
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
            <div style={{ marginTop: 8 }}>
              <div style={{ marginBottom: 6, letterSpacing: '0.08em', fontSize: 10, color: '#585b70' }}>IMPORTED SHAPES</div>
              <button
                ref={communityBtnRef}
                onClick={toggleCommunityMenu}
                title="Community cloud shapes (particles.casberry.in)"
                style={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'rgba(0,0,0,0.5)',
                  color: activeImportedLabel ? '#00d4ff' : '#585b70',
                  border: `1px solid ${activeImportedLabel || communityOpen ? '#00d4ff' : '#1a3a4a'}`,
                  borderRadius: 4,
                  padding: '8px 6px',
                  fontFamily: 'inherit',
                  fontSize: 11,
                  letterSpacing: '0.05em',
                  cursor: 'pointer',
                  boxShadow: activeImportedLabel ? '0 0 8px #00d4ff44' : 'none',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeImportedIcon} {activeImportedLabel ?? 'COMMUNITY CLOUD'}
                </span>
                <span>{communityOpen ? '◂' : '▸'}</span>
              </button>
              {communityOpen && communityAnchor && createPortal(
                <div
                  ref={communityMenuRef}
                  style={{
                    position: 'fixed',
                    top: communityAnchor.top,
                    left: communityAnchor.left,
                    zIndex: 400,
                    width: 270,
                    maxHeight: 'min(520px, 72vh)',
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'rgba(4,12,20,0.96)',
                    border: '1px solid #00d4ff55',
                    borderRadius: 6,
                    boxShadow: '0 0 18px #00d4ff33',
                    padding: 8,
                    fontFamily: 'monospace',
                  }}
                >
                  <div style={{ fontSize: 10, letterSpacing: '0.08em', color: '#585b70', margin: '2px 4px 8px' }}>
                    COMMUNITY CLOUD{catalog ? ` · ${catalog.length} FORMATIONS` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                    <input
                      value={communityInput}
                      onChange={(e) => setCommunityInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') loadCommunityShape() }}
                      placeholder="filter, name, or ?sim= URL"
                      spellCheck={false}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        background: 'rgba(0,0,0,0.5)',
                        color: '#00d4ff',
                        border: '1px solid #1a3a4a',
                        borderRadius: 4,
                        padding: '7px 6px',
                        fontFamily: 'inherit',
                        fontSize: 10,
                        letterSpacing: '0.05em',
                      }}
                    />
                    <button
                      onClick={loadCommunityShape}
                      title="Load from community cloud"
                      style={{
                        background: 'rgba(0,212,255,0.1)',
                        color: '#00d4ff',
                        border: '1px solid #1a3a4a',
                        borderRadius: 4,
                        padding: '7px 10px',
                        fontFamily: 'inherit',
                        fontSize: 10,
                        letterSpacing: '0.08em',
                        cursor: 'pointer',
                      }}
                    >
                      LOAD
                    </button>
                  </div>
                  <div style={{ overflowY: 'auto', minHeight: 0 }}>
                    {importedShapes.filter((s) => matchesFilter(s.label)).map((s) => {
                      const shapeId = `imported:${s.id}` as GraphShape
                      const active = graphShape === shapeId
                      return (
                        <button
                          key={shapeId}
                          onClick={() => onGraphShapeChange(shapeId)}
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            background: active ? 'rgba(0,212,255,0.12)' : 'transparent',
                            color: active ? '#00d4ff' : '#8fa3ad',
                            border: `1px solid ${active ? '#00d4ff88' : 'transparent'}`,
                            borderRadius: 4,
                            padding: '6px 8px',
                            fontFamily: 'inherit',
                            fontSize: 11,
                            letterSpacing: '0.05em',
                            cursor: 'pointer',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {s.icon} {s.label}
                        </button>
                      )
                    })}
                    {menuTop.map(communityItem)}
                    {catalogRest.length > 0 && (
                      <div style={{ fontSize: 9, letterSpacing: '0.08em', color: '#585b70', margin: '8px 4px 4px', borderTop: '1px solid #1a3a4a', paddingTop: 8 }}>
                        ALL FORMATIONS · NEWEST FIRST
                      </div>
                    )}
                    {catalogRest.map(communityItem)}
                    {!catalog && !catalogError && (
                      <div style={{ color: '#585b70', fontSize: 10, padding: '8px 4px' }}>LOADING CATALOG…</div>
                    )}
                    {catalogError && (
                      <div style={{ color: '#ff6b6b', fontSize: 10, padding: '8px 4px' }}>catalog unavailable — type a name or URL above</div>
                    )}
                  </div>
                </div>,
                document.body
              )}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ marginBottom: 6, letterSpacing: '0.08em', fontSize: 10, color: '#585b70' }}>MOTION</div>
            {toggleBtn(autoRotate, `[ AUTO ROTATE ${autoRotate ? 'ON' : 'OFF'} ]`, () => onAutoRotateToggle(!autoRotate))}
            <div style={{ height: 6 }} />
            {toggleBtn(shapeMotion, `[ SHAPE MOTION ${shapeMotion ? 'ON' : 'OFF'} ]`, () => onShapeMotionToggle(!shapeMotion))}
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
