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
import { useVaultGraph, type GraphNode } from './hooks/useVaultGraph'
import { useForce3D } from './hooks/useForce3D'
import { useElectron } from './hooks/useElectron'
import { useHistory } from './hooks/useHistory'
import { captureToClipboard } from './utils/screenshot'
import { getNodeColor } from './lib/colors'

// Defined outside App to avoid unnecessary re-renders
const SHORTCUTS = [
  { key: '/', label: 'SEARCH', desc: 'Open search bar' },
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
  const { data: graphData, loading, error } = useVaultGraph()
  const _urlParams = new URLSearchParams(window.location.search)
  const [graphShape, setGraphShape] = useState<'centroid' | 'sun' | 'saturn' | 'milkyway' | 'brain' | 'natural' | 'tagboxes'>(() => {
    const url = _urlParams.get('graphShape') as 'centroid' | 'sun' | 'saturn' | 'milkyway' | 'brain' | 'natural' | 'tagboxes' | null
    if (url) return url
    try { return (localStorage.getItem('jarvis-graph-shape') as 'centroid' | 'sun' | 'saturn' | 'milkyway' | 'brain' | 'natural' | 'tagboxes') ?? 'centroid' } catch { return 'centroid' }
  })
  const [tagBoxTopN, setTagBoxTopN] = useState(24)
  const { positions, simDone, tagBoxes, reheat, setSpread, setFilter, pinNodes, moveNodes, unpinNodes, resetPins } = useForce3D(graphData, graphShape, tagBoxTopN)
  const { animate: animateElectron, cancel: cancelElectron } = useElectron()
  const history = useHistory()

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
  const [tagIsolationIds, setTagIsolationIds] = useState<Set<string> | null>(null)
  const [tagIsolationTags, setTagIsolationTags] = useState<string[]>([])
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())
  const [bloomEnabled, setBloomEnabled] = useState(true)
  const [nodeOpacity, setNodeOpacity] = useState(1.0)
  const [starsEnabled, setStarsEnabled] = useState(false)
  const [labelsEnabled, setLabelsEnabled] = useState(true)
  const [linksEnabled, setLinksEnabled] = useState(true)
  const [spread, setSpreadState] = useState(2.0)
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
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const showToast = useCallback((msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 2000)
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
  useEffect(() => {
    if (!graphData) return
    const active = graphData.nodes
      .filter(n =>
        (!timeFilterIds || timeFilterIds.has(n.id)) &&
        (!tagIsolationIds || tagIsolationIds.has(n.id))
      )
      .map(n => n.id)
    setFilter(active)
  }, [graphData, timeFilterIds, tagIsolationIds, setFilter])

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

  // Handle tag isolation from SearchBar Enter
  const handleTagIsolate = useCallback((ids: Set<string>, tags: string[]) => {
    setTagIsolationIds(ids)
    setTagIsolationTags(tags)
    setSearchResults(null) // clear dim-search when isolating
    setFilter([...ids])
  }, [setFilter])

  const clearTagIsolation = useCallback(() => {
    setTagIsolationIds(null)
    setTagIsolationTags([])
    if (graphData) setFilter(graphData.nodes.map(n => n.id))
  }, [graphData, setFilter])

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
    setGraphShape('centroid')
    try { localStorage.setItem('jarvis-graph-shape', 'centroid') } catch { /* storage unavailable */ }
    resetPins() // clear all dragged node pins so layout reflows naturally
    reheat()
  }, [setSpread, reheat, resetPins])

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

  if (loading) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Courier New", monospace',
        color: '#00d4ff',
        fontSize: 16,
      }}>
        <div>
          <div style={{ marginBottom: 8 }}>◌ LOADING VAULT GRAPH...</div>
          <div style={{ color: '#00a8cc', fontSize: 12 }}>{import.meta.env.VITE_VAULT_PATH ?? 'Scanning vault...'}</div>
        </div>
      </div>
    )
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
        />
      </ErrorBoundary>

      <HUD
        nodeCount={graphData.nodes.length}
        linkCount={graphData.links.length}
        visibleNodeCount={visibleCount}
        simDone={simDone}
        breadcrumb={patternLoading ? '◌ RECALCULATING...' : focusMode ? `[H] FOCUS LOCKED (${focusLockedNodeIds?.size ?? 0} nodes)` : navBreadcrumb}
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
              background: '#1a2a1a',
              color: '#a6e3a1',
              border: '1px solid #a6e3a133',
              borderRadius: 3,
              padding: '1px 6px',
            }}>#{t}</span>
          ))}
          <span
            style={{ color: '#585b70', cursor: 'pointer', marginLeft: 4, fontSize: 13 }}
            onClick={clearTagIsolation}
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
