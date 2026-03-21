// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Graph3D, type Graph3DHandle } from './components/Graph3D'
import { ErrorBoundary } from './components/ErrorBoundary'
import { HUD } from './components/HUD'
import { Tooltip } from './components/Tooltip'
import { Sidebar } from './components/Sidebar'
import { FavouritesPane } from './components/FavouritesPane'
import { SearchBar } from './components/SearchBar'
import { TimeFilter } from './components/TimeFilter'
import { Settings } from './components/Settings'
import { Minimap } from './components/Minimap'
import { FirstRunSetup } from './components/FirstRunSetup'
import { GraphBuildProgress } from './components/GraphBuildProgress'
import { useVaultGraph, type GraphNode } from './hooks/useVaultGraph'
import { useForce3D } from './hooks/useForce3D'
import { useElectron } from './hooks/useElectron'
import { useHistory } from './hooks/useHistory'
import { usePresets, type PresetSettings, type PresetCamera, type PresetFilters } from './hooks/usePresets'
import { captureToClipboard } from './utils/screenshot'
import { getNodeColor } from './lib/colors'

// Defined outside App to avoid unnecessary re-renders
const SHORTCUTS = [
  { key: '/', label: 'SEARCH', desc: 'Open search bar' },
  { key: 'R', label: 'RESET VIEW', desc: 'Reset camera to fit all nodes' },
  { key: 'F', label: 'FAVOURITE', desc: 'Toggle favourite on selected note' },
  { key: 'ESC', label: 'CLOSE', desc: 'Close sidebar / dismiss search / exit focus mode' },
  { key: 'H', label: 'FOCUS', desc: 'Focus mode: hide all except selected + connected' },
  { key: ']', label: 'EXPAND', desc: 'Expand all visible nodes outward' },
  { key: '[', label: 'COLLAPSE', desc: 'Collapse outermost layer inward' },
  { key: 'RIGHT-DRAG', label: 'DRAG', desc: 'Drag closest node + its neighbours' },
]

function ShortcutRow({ keyName, label, desc }: { keyName: string; label: string; desc: string }) {
  const [showDesc, setShowDesc] = useState(false)
  return (
    <div
      style={{ lineHeight: 1.9, color: '#3a5a6a', cursor: 'default', position: 'relative' }}
      onMouseEnter={() => setShowDesc(true)}
      onMouseLeave={() => setShowDesc(false)}
    >
      <span style={{ color: '#00a8cc' }}>{keyName}</span>{' '}{label}
      {showDesc && (
        <div style={{
          position: 'absolute',
          right: '100%',
          top: 0,
          marginRight: 10,
          background: 'rgba(0,0,0,0.92)',
          border: '1px solid #00d4ff',
          borderRadius: 4,
          padding: '4px 8px',
          color: '#cdd6f4',
          fontSize: 10,
          whiteSpace: 'nowrap',
          boxShadow: '0 0 8px #00d4ff33',
          pointerEvents: 'none',
          zIndex: 200,
        }}>
          {desc}
        </div>
      )}
    </div>
  )
}

function App() {
  // Config check — must resolve before graph loads
  const [configStatus, setConfigStatus] = useState<'checking' | 'unconfigured' | 'configured'>('checking')
  const [showChangeVault, setShowChangeVault] = useState(false)

  useEffect(() => {
    let active = true
    let attempt = 0
    const MAX_RETRIES = 10
    const BASE_DELAY = 500 // ms

    async function fetchConfig() {
      while (active && attempt < MAX_RETRIES) {
        try {
          const res = await fetch('/api/config')
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const d = await res.json() as { configured: boolean }
          if (active) setConfigStatus(d.configured ? 'configured' : 'unconfigured')
          return
        } catch {
          attempt++
          if (attempt >= MAX_RETRIES) {
            // After all retries, assume configured (fallback behavior)
            if (active) setConfigStatus('configured')
            return
          }
          // Exponential backoff: 500, 1000, 2000, 2000, 2000... (capped at 2s)
          await new Promise(r => setTimeout(r, Math.min(BASE_DELAY * Math.pow(2, attempt - 1), 2000)))
        }
      }
    }

    fetchConfig()
    return () => { active = false }
  }, [])

  const graphEnabled = configStatus === 'configured'

  const { data: graphData, loading, error, buildProgress, embeddingProgress } = useVaultGraph(graphEnabled)
  const _urlParams = new URLSearchParams(window.location.search)
  const [graphShape, setGraphShape] = useState<'sun' | 'saturn' | 'milkyway' | 'brain' | 'natural' | 'tagboxes'>(() => {
    const url = _urlParams.get('graphShape') as 'sun' | 'saturn' | 'milkyway' | 'brain' | 'natural' | 'tagboxes' | null
    if (url) return url
    try {
      const stored = localStorage.getItem('jarvis-graph-shape') as 'sun' | 'saturn' | 'milkyway' | 'brain' | 'natural' | 'tagboxes' | null
      // Migrate old 'centroid' value to 'natural'
      if (stored === 'centroid' as string) return 'natural'
      return stored ?? 'natural'
    } catch { return 'natural' }
  })
  const [tagBoxTopN, setTagBoxTopN] = useState(2)
  const [tagBoxSizeScale, setTagBoxSizeScale] = useState(2.0)
  const { positions, simDone, tagBoxes, reheat, setSpread, setFilter, pinNodes, moveNodes, unpinNodes, resetPins } = useForce3D(graphData, graphShape, tagBoxTopN, tagBoxSizeScale)
  const { animate: animateElectron, cancel: cancelElectron } = useElectron()
  const history = useHistory()
  const { presets, save: savePreset, remove: removePreset, load: loadPreset } = usePresets()

  const graphRef = useRef<Graph3DHandle>(null)
  const hasAutoResetRef = useRef(false)
  const isInitialLoadRef = useRef(true)
  const [patternLoading, setPatternLoading] = useState(false)
  // Ref tracks latest patternLoading so simDone effect doesn't need it as a dep
  const patternLoadingRef = useRef(false)

  // UI State
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [sidebarFullView, setSidebarFullView] = useState(false)
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchResults, setSearchResults] = useState<string[] | null>(null)
  const [timeFilterIds, setTimeFilterIds] = useState<Set<string> | null>(null)
  const [activeTimePreset, setActiveTimePreset] = useState<string>('ALL')
  const [timelapsePlaying, setTimelapsePlaying] = useState(false)
  const [timelapseSpeed, setTimelapseSpeed] = useState<number>(() => {
    try { return parseInt(localStorage.getItem('jarvis-timelapse-speed') ?? '1', 10) || 1 } catch { return 1 }
  })
  const [timelapseDate, setTimelapseDate] = useState<number | undefined>(undefined)
  const [tagIsolationIds, setTagIsolationIds] = useState<Set<string> | null>(null)
  const [tagIsolationTags, setTagIsolationTags] = useState<string[]>([])
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())
  const [bloomEnabled, setBloomEnabled] = useState(true)
  const [nodeOpacity, setNodeOpacity] = useState(1.0)
  const [starsEnabled, setStarsEnabled] = useState(false)
  const [labelsEnabled, setLabelsEnabled] = useState(true)
  const [linksEnabled, setLinksEnabled] = useState(true)
  const [spread, setSpreadState] = useState(2.0)
  const [textSize, setTextSizeState] = useState(() => {
    try { const v = localStorage.getItem('jarvis-text-size'); return v ? parseFloat(v) : 1.0 } catch { return 1.0 }
  })
  const [minNodeSize, setMinNodeSize] = useState(1.0)
  const [maxNodeSize, setMaxNodeSize] = useState(3.0)
  const [ultraNodeSize, setUltraNodeSize] = useState(() => {
    const url = _urlParams.get('ultraNodeSize')
    return url ? parseFloat(url) : 4.0
  })
  const [shortcutsVisible, setShortcutsVisible] = useState(() => {
    try { return localStorage.getItem('jarvis-shortcuts-open') !== 'false' } catch { return true }
  })
  const [allTags, setAllTags] = useState<string[]>([])
  const [flashNodeId, setFlashNodeId] = useState<string | null>(null)
  const [navBreadcrumb, setNavBreadcrumb] = useState<string | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [focusLockedNodeIds, setFocusLockedNodeIds] = useState<Set<string> | null>(null)
  const [zoomToNode, setZoomToNode] = useState(() => {
    try { return localStorage.getItem('jarvis-zoom-to-node') !== 'false' } catch { return true }
  })
  const [favourites, setFavourites] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('jarvis-favourites')
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch { return new Set() }
  })
  const [semanticStatus, setSemanticStatus] = useState<{ ready: boolean; indexed: number; total: number; model: string } | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const showToast = useCallback((msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 2000)
  }, [])

  // Poll semantic indexing status
  useEffect(() => {
    let active = true
    const poll = async () => {
      try {
        const resp = await fetch('/api/semantic-status')
        if (!resp.ok) return
        const data = await resp.json() as { ready: boolean; indexed: number; total: number; model: string }
        if (active) setSemanticStatus(data)
        // Stop polling once ready
        if (data.ready) return
      } catch { /* server not ready yet */ }
      if (active) setTimeout(poll, 2000)
    }
    poll()
    return () => { active = false }
  }, [])

  // Camera position for minimap (update at 10fps)
  const [cameraPos, setCameraPos] = useState<{ x: number; y: number; z: number } | null>(null)
  const [cameraTarget, setCameraTarget] = useState<{ x: number; y: number; z: number } | null>(null)

  useEffect(() => {
    const interval = setInterval(() => {
      const p = graphRef.current?.getCameraPosition()
      const t = graphRef.current?.getCameraTarget()
      if (p) setCameraPos({ x: p.x, y: p.y, z: p.z })
      if (t) setCameraTarget({ x: t.x, y: t.y, z: t.z })
    }, 100)
    return () => clearInterval(interval)
  }, [])

  const sidebarWidth = (() => {
    try {
      const v = localStorage.getItem('jarvis-note-width')
      if (v) { const n = parseInt(v, 10); if (n >= 280 && n <= 800) return n }
    } catch { /* storage unavailable */ }
    return 380
  })()

  // Persist timelapse speed to localStorage
  useEffect(() => {
    try { localStorage.setItem('jarvis-timelapse-speed', String(timelapseSpeed)) } catch { /* storage unavailable */ }
  }, [timelapseSpeed])

  // Fetch all tags for search autocomplete (once on mount)
  useEffect(() => {
    fetch('/api/tags')
      .then(r => r.json())
      .then(d => setAllTags(d.tags || []))
      .catch(() => {})
  }, [])

  // fix(1): Auto-reset camera immediately on first positions tick (no delay — avoids close-up flash)
  useEffect(() => {
    if (positions.size > 0 && !hasAutoResetRef.current) {
      hasAutoResetRef.current = true
      isInitialLoadRef.current = false
      graphRef.current?.resetCamera()
    }
  }, [positions])

  // Show loading indicator + reset view when graph shape changes
  useEffect(() => {
    if (isInitialLoadRef.current) return // skip on first mount
    console.log('[patternLoading] graphShape changed →', graphShape, '— setting patternLoading=true')
    patternLoadingRef.current = true
    setPatternLoading(true)
    hasAutoResetRef.current = false // allow auto-reset after reload
  }, [graphShape])

  // Keep ref in sync so the simDone effect below can read latest value without stale closure
  useEffect(() => {
    patternLoadingRef.current = patternLoading
    console.log('[patternLoading] state synced to ref:', patternLoading)
  }, [patternLoading])

  // When sim finishes: clear patternLoading if active.
  // Dep array is [simDone] only — firing on patternLoading changes risks clearing with a
  // stale simDone=true before setSimDone(false) has applied in the same batch.
  useEffect(() => {
    if (!simDone) return
    console.log('[patternLoading] simDone=true — patternLoadingRef:', patternLoadingRef.current)
    if (patternLoadingRef.current) {
      console.log('[patternLoading] clearing (sim finished)')
      setPatternLoading(false)
      // Re-reset camera after sim converges — the first auto-reset fires on early unconverged
      // positions, so the camera distance/angle can be wrong. This second reset uses final positions.
      graphRef.current?.resetCamera()
    }
  }, [simDone]) // patternLoading intentionally read via ref to avoid premature-clear race

  // Safety net: if patternLoading is still true after 5s, force-clear it
  useEffect(() => {
    if (!patternLoading) return
    console.log('[patternLoading] arming 5s safety timeout')
    const id = setTimeout(() => {
      console.warn('[patternLoading] 5s timeout fired — force-clearing stuck loading state')
      setPatternLoading(false)
    }, 5000)
    return () => {
      console.log('[patternLoading] clearing 5s safety timeout')
      clearTimeout(id)
    }
  }, [patternLoading])

  // Propagate time/tag/search filter changes to force simulation center
  // Skip during timelapse playback — nodes should appear at settled positions, not reheat
  useEffect(() => {
    if (!graphData) return
    if (timelapsePlaying) return  // Don't reheat sim during timelapse
    const active = graphData.nodes
      .filter(n =>
        (!timeFilterIds || timeFilterIds.has(n.id)) &&
        (!tagIsolationIds || tagIsolationIds.has(n.id))
      )
      .map(n => n.id)
    setFilter(active)
  }, [graphData, timeFilterIds, tagIsolationIds, setFilter, timelapsePlaying])

  // Compute node degrees from links
  const nodeDegrees = useMemo(() => {
    if (!graphData) return new Map<string, number>()
    const degrees = new Map<string, number>()
    graphData.nodes.forEach(n => degrees.set(n.id, 0))
    graphData.links.forEach(l => {
      const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id
      const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id
      degrees.set(s, (degrees.get(s) ?? 0) + 1)
      degrees.set(t, (degrees.get(t) ?? 0) + 1)
    })
    return degrees
  }, [graphData])

  // Cluster centre per folder = highest-degree node (used for collapse + label threshold)
  const folderCentresMap = useMemo(() => {
    if (!graphData || nodeDegrees.size === 0) return new Map<string, string>()
    const centres = new Map<string, string>()
    const bestDeg = new Map<string, number>()
    for (const node of graphData.nodes) {
      const deg = nodeDegrees.get(node.id) ?? 0
      if (deg > (bestDeg.get(node.folder) ?? -1)) {
        centres.set(node.folder, node.id)
        bestDeg.set(node.folder, deg)
      }
    }
    return centres
  }, [graphData, nodeDegrees])

  // Visible nodes: when a folder is collapsed only show its centre node
  const visibleNodes = useMemo(() => {
    if (!graphData) return new Set<string>()
    if (collapsedNodes.size === 0 || folderCentresMap.size === 0) {
      return new Set(graphData.nodes.map(n => n.id))
    }
    // Which folders have any collapsed member?
    const collapsedFolders = new Set<string>()
    for (const nodeId of collapsedNodes) {
      const node = graphData.nodes.find(n => n.id === nodeId)
      if (node) collapsedFolders.add(node.folder)
    }
    const visible = new Set<string>()
    for (const node of graphData.nodes) {
      if (collapsedFolders.has(node.folder)) {
        if (folderCentresMap.get(node.folder) === node.id) visible.add(node.id)
      } else {
        visible.add(node.id)
      }
    }
    return visible
  }, [graphData, collapsedNodes, folderCentresMap])

  // Minimap node data
  const minimapNodes = useMemo(() => {
    if (!graphData) return []
    return graphData.nodes
      .filter(n => positions.has(n.id))
      .map(n => {
        const pos = positions.get(n.id)!
        const color = getNodeColor(n.type, n.folder)
        return { id: n.id, x: pos.x, y: pos.y, z: pos.z, color }
      })
  }, [graphData, positions])

  // Handle spread slider change
  const handleSpreadChange = useCallback((value: number) => {
    setSpreadState(value)
    setSpread(value)
  }, [setSpread])

  // Recompute tagIsolationIds whenever the tag list changes (additive filter logic)
  useEffect(() => {
    if (!graphData || tagIsolationTags.length === 0) {
      setTagIsolationIds(null)
      return
    }
    const matched = new Set(
      graphData.nodes
        .filter(n => {
          const nodeTags = n.tags.map(t => t.toLowerCase())
          return tagIsolationTags.every(tt => nodeTags.some(nt => nt.includes(tt)))
        })
        .map(n => n.id)
    )
    setTagIsolationIds(matched)
  }, [tagIsolationTags, graphData])

  // Handle tag isolation from SearchBar Enter — additive: appends new tags to existing filter
  const handleTagIsolate = useCallback((_ids: Set<string>, tags: string[]) => {
    setTagIsolationTags(prev => {
      const combined = [...new Set([...prev, ...tags])]
      return combined
    })
    setSearchResults(null)
  }, [])

  const clearTagIsolation = useCallback(() => {
    setTagIsolationIds(null)
    setTagIsolationTags([])
  }, [])

  const removeTagFromIsolation = useCallback((tag: string) => {
    setTagIsolationTags(prev => prev.filter(t => t !== tag))
  }, [])

  const toggleFavourite = useCallback((nodeId: string) => {
    setFavourites(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      try { localStorage.setItem('jarvis-favourites', JSON.stringify([...next])) } catch { /* storage unavailable */ }
      return next
    })
  }, [])

  // Arrow key navigation helper
  const navigateArrow = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    if (!graphData || !selectedNode) return

    const folder = selectedNode.folder
    const siblings = graphData.nodes
      .filter(n => n.folder === folder)
      .sort((a, b) => a.label.localeCompare(b.label))
    const idx = siblings.findIndex(n => n.id === selectedNode.id)

    let target: (typeof graphData.nodes)[0] | undefined

    if (direction === 'left') {
      target = siblings[(idx - 1 + siblings.length) % siblings.length]
    } else if (direction === 'right') {
      target = siblings[(idx + 1) % siblings.length]
    } else if (direction === 'up') {
      // Highest-degree node in same folder = cluster centre
      target = siblings.reduce((best, n) => {
        return (nodeDegrees.get(n.id) ?? 0) > (nodeDegrees.get(best.id) ?? 0) ? n : best
      }, siblings[0])
    } else {
      // First child = linked neighbour with highest degree
      const linkedIds = new Set<string>()
      graphData.links.forEach(l => {
        const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id
        const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id
        if (s === selectedNode.id) linkedIds.add(t)
        if (t === selectedNode.id) linkedIds.add(s)
      })
      const neighbours = graphData.nodes.filter(n => linkedIds.has(n.id) && n.id !== selectedNode.id)
      if (neighbours.length > 0) {
        target = neighbours.reduce((best, n) => {
          return (nodeDegrees.get(n.id) ?? 0) > (nodeDegrees.get(best.id) ?? 0) ? n : best
        }, neighbours[0])
      }
    }

    if (!target) return

    setSelectedNode(target)
    setSidebarFullView(true)
    if (zoomToNode) graphRef.current?.flyTo(target.id)

    // Update HUD breadcrumb for left/right navigation
    if (direction === 'left' || direction === 'right') {
      const newIdx = siblings.findIndex(n => n.id === target!.id)
      const folderName = folder.split('/').pop()?.toUpperCase() || folder.toUpperCase()
      setNavBreadcrumb(`[←] ${newIdx + 1}/${siblings.length} ${folderName} [→]`)
    } else {
      setNavBreadcrumb(null)
    }
  }, [graphData, selectedNode, nodeDegrees])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === '/') {
        e.preventDefault()
        setSearchVisible(v => !v)
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        graphRef.current?.resetCamera()
      } else if (e.key === 'f' || e.key === 'F') {
        if (selectedNode) toggleFavourite(selectedNode.id)
      } else if (e.key === 'h' || e.key === 'H') {
        if (focusMode) {
          setFocusMode(false)
          setFocusLockedNodeIds(null)
        } else if (selectedNode && graphData) {
          const ids = new Set<string>([selectedNode.id])
          graphData.links.forEach(l => {
            const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id
            const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id
            if (s === selectedNode.id) ids.add(t)
            if (t === selectedNode.id) ids.add(s)
          })
          setFocusLockedNodeIds(ids)
          setFocusMode(true)
        }
      } else if (e.key === 'Escape') {
        setFocusMode(false)
        setFocusLockedNodeIds(null)
        setSearchVisible(false)
        setSelectedNode(null)
        setSidebarFullView(false)
        setSearchResults(null)
        setTagIsolationIds(null)
        setTagIsolationTags([])
        cancelElectron()
      } else if (e.key === ']') {
        setCollapsedNodes(new Set())
        reheat()
      } else if (e.key === 'ArrowLeft' && e.shiftKey) {
        e.preventDefault()
        const prevId = history.back()
        if (prevId && graphData) {
          const target = graphData.nodes.find(n => n.id === prevId)
          if (target) {
            setSelectedNode(target)
            setSidebarFullView(true)
            if (zoomToNode) graphRef.current?.flyTo(target.id)
          }
        }
      } else if (e.key === 'ArrowRight' && e.shiftKey) {
        e.preventDefault()
        const nextId = history.forward()
        if (nextId && graphData) {
          const target = graphData.nodes.find(n => n.id === nextId)
          if (target) {
            setSelectedNode(target)
            setSidebarFullView(true)
            if (zoomToNode) graphRef.current?.flyTo(target.id)
          }
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        navigateArrow('left')
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        navigateArrow('right')
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        navigateArrow('up')
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        navigateArrow('down')
      } else if (e.key === '[') {
        // Collapse all folders to their centre nodes (Shift+[ and [ behave the same)
        setCollapsedNodes(new Set(folderCentresMap.values()))
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [graphData, focusMode, selectedNode, reheat, cancelElectron, navigateArrow, folderCentresMap, toggleFavourite, history, zoomToNode])

  // When node selection is cleared, exit focus mode
  const clearSelection = useCallback(() => {
    setSelectedNode(null)
    setSidebarFullView(false)
    setFocusMode(false)
    setFocusLockedNodeIds(null)
  }, [])

  // Single click → full markdown view in sidebar
  const handleNodeClick = useCallback((node: GraphNode) => {
    history.push(node.id)
    setSelectedNode(node)
    setSidebarFullView(true)
    if (zoomToNode) graphRef.current?.flyTo(node.id)
  }, [zoomToNode, history])

  // Toggle folder collapse: double-click or right-click collapses/expands the whole folder
  const toggleFolderCollapse = useCallback((node: GraphNode) => {
    const folder = node.folder
    const centre = folderCentresMap.get(folder)
    setCollapsedNodes(prev => {
      const isFolderCollapsed = graphData?.nodes.some(n => n.folder === folder && prev.has(n.id)) ?? false
      const next = new Set(prev)
      if (isFolderCollapsed) {
        // Expand: remove all folder members from collapsed set
        graphData?.nodes.forEach(n => { if (n.folder === folder) next.delete(n.id) })
      } else {
        // Collapse: add the centre node (triggers folder-only-centre visibility)
        if (centre) next.add(centre)
      }
      return next
    })
  }, [graphData, folderCentresMap])

  // Double click → toggle collapse/expand for folder
  const handleNodeDoubleClick = useCallback((node: GraphNode) => {
    toggleFolderCollapse(node)
    reheat()
  }, [toggleFolderCollapse, reheat])

  const handleNodeHover = useCallback((node: GraphNode | null, x: number, y: number) => {
    setHoveredNode(node)
    setTooltipPos({ x, y })
  }, [])

  const handleNodeRightClick = useCallback((node: GraphNode) => {
    toggleFolderCollapse(node)
    setFlashNodeId(node.id)
    setTimeout(() => setFlashNodeId(null), 300)
    reheat()
  }, [toggleFolderCollapse, reheat])

  const handleResetAll = useCallback(() => {
    graphRef.current?.resetCamera()
    setSpreadState(2.0)
    setSpread(2.0)
    setNodeOpacity(1.0)
    setMinNodeSize(1.0)
    setMaxNodeSize(3.0)
    setUltraNodeSize(4.0)
    setTagIsolationIds(null)
    setTagIsolationTags([])
    setCollapsedNodes(new Set())
    setGraphShape('natural')
    try { localStorage.setItem('jarvis-graph-shape', 'natural') } catch { /* storage unavailable */ }
    resetPins() // clear all dragged node pins so layout reflows naturally
    reheat()
  }, [setSpread, reheat, resetPins])

  const handlePresetSave = useCallback((name: string) => {
    const settings: PresetSettings = {
      bloomEnabled, nodeOpacity, starsEnabled, labelsEnabled, linksEnabled,
      spread, minNodeSize, maxNodeSize, ultraNodeSize, zoomToNode,
      graphShape, tagBoxTopN, tagBoxSizeScale,
    }
    let camera: PresetCamera | null = null
    const pos = graphRef.current?.getCameraPosition()
    const tgt = graphRef.current?.getCameraTarget()
    if (pos && tgt) {
      camera = {
        position: [pos.x, pos.y, pos.z],
        target: [tgt.x, tgt.y, tgt.z],
      }
    }
    const filters: PresetFilters = {
      tagIsolationTags,
      timeRange: activeTimePreset || 'ALL',
      searchQuery: null,
    }
    const result = savePreset(name, settings, camera, [...favourites], filters)
    if (!result.ok) {
      showToast(result.warning ?? 'Could not save preset')
    } else {
      showToast(result.warning ? `Preset saved (${result.warning})` : 'Preset saved')
    }
  }, [bloomEnabled, nodeOpacity, starsEnabled, labelsEnabled, linksEnabled,
    spread, minNodeSize, maxNodeSize, ultraNodeSize, zoomToNode,
    graphShape, tagBoxTopN, tagBoxSizeScale, tagIsolationTags, favourites, savePreset, showToast])

  const handlePresetLoad = useCallback((id: string) => {
    const preset = loadPreset(id)
    if (!preset) return

    const s = preset.settings
    setBloomEnabled(s.bloomEnabled)
    setNodeOpacity(s.nodeOpacity)
    setStarsEnabled(s.starsEnabled)
    setLabelsEnabled(s.labelsEnabled)
    setLinksEnabled(s.linksEnabled)
    setSpreadState(s.spread)
    setSpread(s.spread)
    setMinNodeSize(s.minNodeSize)
    setMaxNodeSize(s.maxNodeSize)
    setUltraNodeSize(s.ultraNodeSize)
    setZoomToNode(s.zoomToNode)
    try { localStorage.setItem('jarvis-zoom-to-node', String(s.zoomToNode)) } catch { /* */ }
    setTagBoxTopN(s.tagBoxTopN)
    setTagBoxSizeScale(s.tagBoxSizeScale)

    if (s.graphShape !== graphShape) {
      setGraphShape(s.graphShape)
      try { localStorage.setItem('jarvis-graph-shape', s.graphShape) } catch { /* */ }
    }

    // Restore camera
    if (preset.camera) {
      const cam = graphRef.current?.getCamera()
      if (cam) {
        cam.position.set(...preset.camera.position)
      }
    }

    // Restore favourites
    const newFavs = new Set(preset.favourites)
    setFavourites(newFavs)
    try { localStorage.setItem('jarvis-favourites', JSON.stringify([...newFavs])) } catch { /* */ }

    // Restore time range preset
    if (preset.filters.timeRange) {
      setActiveTimePreset(preset.filters.timeRange)
    }

    // Restore tag filters
    if (preset.filters.tagIsolationTags.length > 0) {
      setTagIsolationTags(preset.filters.tagIsolationTags)
    } else {
      setTagIsolationTags([])
      setTagIsolationIds(null)
    }

    showToast(`Loaded: ${preset.name}`)
  }, [loadPreset, graphShape, setSpread, showToast])

  const navigateToNode = useCallback((nodeId: string) => {
    if (!graphData) return

    if (nodeId.startsWith('tag:')) {
      const tag = nodeId.slice(4)
      const taggedNodes = graphData.nodes.filter(n => n.tags.includes(tag)).map(n => n.id)
      setSearchResults(taggedNodes)
      return
    }

    const targetNode = graphData.nodes.find(n => {
      if (n.id === nodeId) return true
      const base = nodeId.toLowerCase().replace(/\s+/g, '-')
      return n.id.endsWith('/' + base) || n.id === base
    })

    if (!targetNode) return

    history.push(targetNode.id)

    if (selectedNode && selectedNode.id !== targetNode.id) {
      const scene = graphRef.current?.getScene()
      if (scene) {
        animateElectron(selectedNode.id, targetNode.id, {
          positions,
          links: graphData.links as { source: string; target: string }[],
          scene,
          onArrival: (arrivedId) => {
            const arrived = graphData.nodes.find(n => n.id === arrivedId)
            if (arrived) {
              setSelectedNode(arrived)
              setSidebarFullView(true)
              if (zoomToNode) graphRef.current?.flyTo(arrivedId)
            }
          },
          onNodeFlash: (flashId) => {
            setFlashNodeId(flashId)
            setTimeout(() => setFlashNodeId(null), 300)
          },
        })
        return
      }
    }

    setSelectedNode(targetNode)
    setSidebarFullView(true)
    if (zoomToNode) graphRef.current?.flyTo(targetNode.id)
  }, [graphData, selectedNode, positions, animateElectron, zoomToNode, history])

  const handleSearchNavigate = useCallback((nodeId: string) => {
    setSearchVisible(false)
    setSearchResults(null)
    navigateToNode(nodeId)
  }, [navigateToNode])

  // Show first-run setup when vault is unconfigured or user requests change
  if (configStatus === 'checking') {
    return <GraphBuildProgress progress={null} />
  }

  if (configStatus === 'unconfigured' || showChangeVault) {
    return (
      <FirstRunSetup
        onConfigured={() => {
          if (showChangeVault) {
            window.location.reload()
          } else {
            window.location.reload()
          }
        }}
      />
    )
  }

  if (loading || embeddingProgress !== null) {
    return <GraphBuildProgress progress={buildProgress} embeddingProgress={embeddingProgress} />
  }

  if (error) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Courier New", monospace',
        color: '#ff6b35',
      }}>
        <div>
          <div style={{ marginBottom: 8 }}>✗ CONNECTION ERROR</div>
          <div style={{ fontSize: 12 }}>{error}</div>
          <div style={{ marginTop: 8, fontSize: 11, color: '#585b70' }}>
            Start server: npm run server
          </div>
        </div>
      </div>
    )
  }

  if (!graphData) return null

  const visibleCount = graphData.nodes.filter(n =>
    visibleNodes.has(n.id) && (!timeFilterIds || timeFilterIds.has(n.id))
  ).length

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000', position: 'relative', overflow: 'hidden' }}>
      <ErrorBoundary>
        <Graph3D
          ref={graphRef}
          graphData={graphData}
          positions={positions}
          selectedNodeId={selectedNode?.id ?? null}
          hoveredNodeId={hoveredNode?.id ?? null}
          searchResults={searchResults}
          timeFilterIds={timeFilterIds}
          tagIsolationIds={tagIsolationIds}
          focusModeNodeIds={focusLockedNodeIds}
          collapsedNodes={collapsedNodes}
          visibleNodes={visibleNodes}
          nodeOpacity={nodeOpacity}
          bloomEnabled={bloomEnabled}
          starsEnabled={starsEnabled}
          labelsEnabled={labelsEnabled}
          linksEnabled={linksEnabled}
          textSize={textSize}
          nodeDegrees={nodeDegrees}
          minNodeSize={minNodeSize}
          maxNodeSize={maxNodeSize}
          ultraNodeSize={ultraNodeSize}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onNodeHover={handleNodeHover}
          onNodeRightClick={handleNodeRightClick}
          onFlyTo={nodeId => graphRef.current?.flyTo(nodeId)}
          flashNodeId={flashNodeId}
          onPinNodes={pinNodes}
          onMoveNodes={moveNodes}
          onUnpinNodes={unpinNodes}
          graphShape={graphShape}
          tagBoxes={tagBoxes}
          timeFilterActive={timeFilterIds !== null}
        />
      </ErrorBoundary>

      <HUD
        nodeCount={graphData.nodes.length}
        linkCount={graphData.links.length}
        visibleNodeCount={visibleCount}
        simDone={simDone}
        breadcrumb={patternLoading ? '◌ RECALCULATING...' : focusMode ? `[H] FOCUS LOCKED (${focusLockedNodeIds?.size ?? 0} nodes)` : navBreadcrumb}
        timelapsePlaying={timelapsePlaying}
        timelapseDate={timelapseDate}
        onPauseTimelapse={() => setTimelapsePlaying(false)}
        semanticStatus={semanticStatus}
      />

      <Settings
        bloomEnabled={bloomEnabled}
        nodeOpacity={nodeOpacity}
        starsEnabled={starsEnabled}
        labelsEnabled={labelsEnabled}
        linksEnabled={linksEnabled}
        spread={spread}
        minNodeSize={minNodeSize}
        maxNodeSize={maxNodeSize}
        ultraNodeSize={ultraNodeSize}
        onBloomToggle={setBloomEnabled}
        onOpacityChange={setNodeOpacity}
        onStarsToggle={setStarsEnabled}
        onLabelsToggle={setLabelsEnabled}
        onLinksToggle={setLinksEnabled}
        textSize={textSize}
        onTextSizeChange={(v) => {
          setTextSizeState(v)
          try { localStorage.setItem('jarvis-text-size', String(v)) } catch { /* storage unavailable */ }
        }}
        onSpreadChange={handleSpreadChange}
        onMinSizeChange={setMinNodeSize}
        onMaxSizeChange={setMaxNodeSize}
        onUltraNodeSizeChange={setUltraNodeSize}
        onResetAll={handleResetAll}
        onResetPosition={() => graphRef.current?.resetCamera()}
        zoomToNode={zoomToNode}
        onZoomToNodeToggle={(v) => {
          setZoomToNode(v)
          try { localStorage.setItem('jarvis-zoom-to-node', String(v)) } catch { /* storage unavailable */ }
        }}
        graphShape={graphShape}
        onGraphShapeChange={(v) => {
          setGraphShape(v)
          try { localStorage.setItem('jarvis-graph-shape', v) } catch { /* storage unavailable */ }
          if (v === 'tagboxes') {
            setBloomEnabled(false) // bloom washes out box structure
            setTimeout(() => graphRef.current?.resetCamera(), 3000)
          } else {
            setBloomEnabled(true) // restore bloom for other shapes
          }
        }}
        tagBoxTopN={tagBoxTopN}
        onTagBoxTopNChange={setTagBoxTopN}
        tagBoxSizeScale={tagBoxSizeScale}
        onTagBoxSizeScaleChange={setTagBoxSizeScale}
        onChangeVault={() => setShowChangeVault(true)}
        presets={presets}
        onPresetSave={handlePresetSave}
        onPresetLoad={handlePresetLoad}
        onPresetDelete={removePreset}
      />

      <SearchBar
        visible={searchVisible}
        allNodes={graphData.nodes}
        allTags={allTags}
        onResults={setSearchResults}
        onNavigate={handleSearchNavigate}
        onClose={() => { setSearchVisible(false); setSearchResults(null) }}
        onTagIsolate={handleTagIsolate}
      />

      <TimeFilter
        nodes={graphData.nodes}
        onChange={setTimeFilterIds}
        onDateChange={setTimelapseDate}
        playing={timelapsePlaying}
        playSpeed={timelapseSpeed}
        onPlayChange={setTimelapsePlaying}
        onSpeedChange={setTimelapseSpeed}
        activePreset={activeTimePreset}
        onPresetChange={setActiveTimePreset}
      />

      <Tooltip node={hoveredNode} x={tooltipPos.x} y={tooltipPos.y} />

      <Sidebar
        node={selectedNode}
        fullView={sidebarFullView}
        allNodes={graphData.nodes}
        onClose={clearSelection}
        onNavigate={navigateToNode}
        onTagFilter={(tag) => {
          const ids = new Set(graphData.nodes.filter(n => n.tags.includes(tag)).map(n => n.id))
          handleTagIsolate(ids, [tag])
        }}
        isFavourite={selectedNode ? favourites.has(selectedNode.id) : false}
        onToggleFavourite={toggleFavourite}
      />

      <Minimap
        nodes={minimapNodes}
        cameraPosition={cameraPos}
        cameraTarget={cameraTarget}
        onClickPosition={(x, z) => graphRef.current?.panCameraTo(x, z)}
      />

      <FavouritesPane
        favourites={favourites}
        allNodes={graphData.nodes}
        sidebarWidth={selectedNode ? sidebarWidth : 0}
        onNavigate={navigateToNode}
        onRemove={toggleFavourite}
      />

      {/* Active tag isolation pill */}
      {tagIsolationTags.length > 0 && (
        <div style={{
          position: 'fixed',
          top: 66,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 200,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(0,0,0,0.88)',
          border: '1px solid #00d4ff',
          borderRadius: 4,
          padding: '5px 12px',
          fontFamily: '"Courier New", monospace',
          fontSize: 11,
          boxShadow: '0 0 10px #00d4ff22',
        }}>
          <span style={{ color: '#585b70' }}>FILTER:</span>
          {tagIsolationTags.map(t => (
            <span key={t} style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: '#1a2a1a',
              color: '#a6e3a1',
              border: '1px solid #a6e3a133',
              borderRadius: 3,
              padding: '1px 6px',
            }}>
              <span>#{t}</span>
              <span
                style={{ color: '#4a6a4a', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}
                onClick={() => removeTagFromIsolation(t)}
                title={`Remove #${t} filter`}
              >×</span>
            </span>
          ))}
          <span
            style={{ color: '#585b70', cursor: 'pointer', marginLeft: 4, fontSize: 13 }}
            onClick={clearTagIsolation}
            title="Clear all tag filters"
          >×</span>
        </div>
      )}

      {/* Screenshot button */}
      <button
        onClick={async () => {
          try {
            await captureToClipboard()
            showToast('📋 Copied to clipboard')
          } catch {
            showToast('⚠️ Permission denied')
          }
        }}
        title="Screenshot to clipboard"
        style={{
          position: 'fixed',
          top: 178,
          left: 16,
          zIndex: 200,
          background: 'rgba(0,0,0,0.7)',
          border: '1px solid #1a3a4a',
          color: '#00a8cc',
          borderRadius: 4,
          padding: '6px 10px',
          cursor: 'pointer',
          fontSize: 16,
        }}
      >📷</button>

      {/* Toast notification */}
      {toastMsg && (
        <div style={{
          position: 'fixed',
          bottom: 30,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 300,
          background: 'rgba(0,0,0,0.9)',
          border: '1px solid #00d4ff',
          borderRadius: 6,
          padding: '8px 20px',
          color: '#00d4ff',
          fontFamily: '"Courier New", monospace',
          fontSize: 13,
          boxShadow: '0 0 12px #00d4ff33',
          pointerEvents: 'none',
        }}>
          {toastMsg}
        </div>
      )}

      {/* Keyboard shortcuts HUD */}
      <div style={{
        position: 'fixed',
        bottom: 80,
        right: 16,
        zIndex: 100,
        fontFamily: '"Courier New", monospace',
        fontSize: 10,
      }}>
        <div style={{ textAlign: 'right', marginBottom: 4 }}>
          <button
            onClick={() => {
              const next = !shortcutsVisible
              setShortcutsVisible(next)
              try { localStorage.setItem('jarvis-shortcuts-open', String(next)) } catch { // storage unavailable
    }
            }}
            style={{
              background: 'rgba(0,0,0,0.7)',
              border: '1px solid #1a3a4a',
              color: '#00a8cc',
              borderRadius: 4,
              padding: '2px 7px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 10,
            }}
          >?</button>
        </div>
        {shortcutsVisible && (
          <div style={{
            background: 'rgba(0,0,0,0.85)',
            border: '1px solid #00d4ff',
            borderRadius: 4,
            padding: '8px 12px',
            boxShadow: '0 0 10px #00d4ff22',
            textAlign: 'right',
          }}>
            {SHORTCUTS.map(({ key, label, desc }) => (
              <ShortcutRow key={key} keyName={key} label={label} desc={desc} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default App
