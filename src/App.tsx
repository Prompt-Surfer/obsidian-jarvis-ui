import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Graph3D, type Graph3DHandle } from './components/Graph3D'
import { HUD } from './components/HUD'
import { Tooltip } from './components/Tooltip'
import { Sidebar } from './components/Sidebar'
import { SearchBar } from './components/SearchBar'
import { TimeFilter } from './components/TimeFilter'
import { Settings } from './components/Settings'
import { useVaultGraph, type GraphNode } from './hooks/useVaultGraph'
import { useForce3D } from './hooks/useForce3D'
import { useElectron } from './hooks/useElectron'

// Defined outside App to avoid unnecessary re-renders
const SHORTCUTS = [
  { key: '/', label: 'SEARCH', desc: 'Open search bar' },
  { key: 'ESC', label: 'CLOSE', desc: 'Close sidebar / dismiss search' },
  { key: ']', label: 'EXPAND', desc: 'Expand all visible nodes outward' },
  { key: '[', label: 'COLLAPSE', desc: 'Collapse outermost layer inward' },
  { key: 'RIGHT-CLICK', label: 'TOGGLE', desc: 'Toggle expand/collapse for node' },
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
  const { positions, simDone, reheat, setSpread } = useForce3D(graphData)
  const { animate: animateElectron, cancel: cancelElectron } = useElectron()

  const graphRef = useRef<Graph3DHandle>(null)

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
  const [spread, setSpreadState] = useState(1.0)
  const [minNodeSize, setMinNodeSize] = useState(1.0)
  const [maxNodeSize, setMaxNodeSize] = useState(2.0)
  const [shortcutsVisible, setShortcutsVisible] = useState(() => {
    try { return localStorage.getItem('jarvis-shortcuts-open') !== 'false' } catch { return true }
  })
  const [allTags, setAllTags] = useState<string[]>([])
  const [flashNodeId, setFlashNodeId] = useState<string | null>(null)

  // Fetch all tags for search autocomplete
  useEffect(() => {
    fetch('/api/tags')
      .then(r => r.json())
      .then(d => setAllTags(d.tags || []))
      .catch(() => {})
  }, [])

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

  // Compute visible nodes (factoring in collapsed state)
  const visibleNodes: Set<string> = (() => {
    if (!graphData) return new Set()
    const hidden = new Set<string>()

    for (const collapsedId of collapsedNodes) {
      for (const link of graphData.links) {
        const srcId = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id
        const tgtId = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id
        if (srcId === collapsedId && !collapsedNodes.has(tgtId)) hidden.add(tgtId)
        if (tgtId === collapsedId && !collapsedNodes.has(srcId)) hidden.add(srcId)
      }
    }

    return new Set(graphData.nodes.map(n => n.id).filter(id => !hidden.has(id)))
  })()

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
  }, [])

  const clearTagIsolation = useCallback(() => {
    setTagIsolationIds(null)
    setTagIsolationTags([])
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === '/') {
        e.preventDefault()
        setSearchVisible(v => !v)
      } else if (e.key === 'Escape') {
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
      } else if (e.key === '[') {
        if (!graphData) return
        const incomingDegree = new Map<string, number>()
        const outgoingDegree = new Map<string, number>()
        graphData.nodes.forEach(n => {
          incomingDegree.set(n.id, 0)
          outgoingDegree.set(n.id, 0)
        })
        graphData.links.forEach(l => {
          const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id
          const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id
          outgoingDegree.set(s, (outgoingDegree.get(s) || 0) + 1)
          incomingDegree.set(t, (incomingDegree.get(t) || 0) + 1)
        })
        const newCollapsed = new Set(collapsedNodes)
        graphData.nodes.forEach(n => {
          const degree = (incomingDegree.get(n.id) || 0) + (outgoingDegree.get(n.id) || 0)
          if (degree <= 1) newCollapsed.add(n.id)
        })
        setCollapsedNodes(newCollapsed)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [graphData, collapsedNodes, reheat, cancelElectron])

  // Single click → full markdown view in sidebar
  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node)
    setSidebarFullView(true)
    graphRef.current?.flyTo(node.id)
  }, [])

  // Double click → toggle collapse/expand for node
  const handleNodeDoubleClick = useCallback((node: GraphNode) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev)
      if (next.has(node.id)) next.delete(node.id)
      else next.add(node.id)
      return next
    })
    reheat()
  }, [reheat])

  const handleNodeHover = useCallback((node: GraphNode | null, x: number, y: number) => {
    setHoveredNode(node)
    setTooltipPos({ x, y })
  }, [])

  const handleNodeRightClick = useCallback((node: GraphNode) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev)
      if (next.has(node.id)) next.delete(node.id)
      else next.add(node.id)
      return next
    })
    reheat()
  }, [reheat])

  const handleResetCamera = useCallback(() => {
    graphRef.current?.resetCamera()
  }, [])

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
              graphRef.current?.flyTo(arrivedId)
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
    graphRef.current?.flyTo(targetNode.id)
  }, [graphData, selectedNode, positions, animateElectron])

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
          <div style={{ color: '#00a8cc', fontSize: 12 }}>~/obsidian/otacon-vault</div>
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
      <Graph3D
        ref={graphRef}
        graphData={graphData}
        positions={positions}
        selectedNodeId={selectedNode?.id ?? null}
        hoveredNodeId={hoveredNode?.id ?? null}
        searchResults={searchResults}
        timeFilterIds={timeFilterIds}
        tagIsolationIds={tagIsolationIds}
        collapsedNodes={collapsedNodes}
        visibleNodes={visibleNodes}
        nodeOpacity={nodeOpacity}
        bloomEnabled={bloomEnabled}
        starsEnabled={starsEnabled}
        labelsEnabled={labelsEnabled}
        nodeDegrees={nodeDegrees}
        minNodeSize={minNodeSize}
        maxNodeSize={maxNodeSize}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeHover={handleNodeHover}
        onNodeRightClick={handleNodeRightClick}
        onFlyTo={nodeId => graphRef.current?.flyTo(nodeId)}
        flashNodeId={flashNodeId}
      />

      <HUD
        nodeCount={graphData.nodes.length}
        linkCount={graphData.links.length}
        visibleNodeCount={visibleCount}
        simDone={simDone}
        onResetCamera={handleResetCamera}
      />

      <Settings
        bloomEnabled={bloomEnabled}
        nodeOpacity={nodeOpacity}
        starsEnabled={starsEnabled}
        labelsEnabled={labelsEnabled}
        spread={spread}
        minNodeSize={minNodeSize}
        maxNodeSize={maxNodeSize}
        onBloomToggle={setBloomEnabled}
        onOpacityChange={setNodeOpacity}
        onStarsToggle={setStarsEnabled}
        onLabelsToggle={setLabelsEnabled}
        onSpreadChange={handleSpreadChange}
        onMinSizeChange={setMinNodeSize}
        onMaxSizeChange={setMaxNodeSize}
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
        onClose={() => { setSelectedNode(null); setSidebarFullView(false) }}
        onNavigate={navigateToNode}
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
