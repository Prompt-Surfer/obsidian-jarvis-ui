import { useState, useEffect, useRef, useCallback } from 'react'
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

function App() {
  const { data: graphData, loading, error } = useVaultGraph()
  const { positions, simDone, reheat } = useForce3D(graphData)
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
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())
  const [bloomEnabled, setBloomEnabled] = useState(true)
  const [nodeOpacity, setNodeOpacity] = useState(1.0)
  const [allTags, setAllTags] = useState<string[]>([])
  const [flashNodeId, setFlashNodeId] = useState<string | null>(null)

  // Fetch all tags for search autocomplete
  useEffect(() => {
    fetch('/api/tags')
      .then(r => r.json())
      .then(d => setAllTags(d.tags || []))
      .catch(() => {})
  }, [])

  // Compute visible nodes (factoring in collapsed state)
  const visibleNodes: Set<string> = (() => {
    if (!graphData) return new Set()
    const hidden = new Set<string>()

    for (const collapsedId of collapsedNodes) {
      // Find depth-1 neighbors of collapsed node
      for (const link of graphData.links) {
        const srcId = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id
        const tgtId = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id
        if (srcId === collapsedId && !collapsedNodes.has(tgtId)) hidden.add(tgtId)
        if (tgtId === collapsedId && !collapsedNodes.has(srcId)) hidden.add(srcId)
      }
    }

    // Collapsed nodes themselves are visible (just hide their neighbors)
    return new Set(graphData.nodes.map(n => n.id).filter(id => !hidden.has(id)))
  })()

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
        cancelElectron()
      } else if (e.key === ']') {
        // Expand all by 1 depth — clear all collapsed
        setCollapsedNodes(new Set())
        reheat()
      } else if (e.key === '[') {
        // Collapse outermost layer (leaf nodes)
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
        // Leaf nodes = total degree 1 or 0
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

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node)
    setSidebarFullView(false)
    graphRef.current?.flyTo(node.id)
  }, [])

  const handleNodeDoubleClick = useCallback((node: GraphNode) => {
    setSelectedNode(node)
    setSidebarFullView(true)
    graphRef.current?.flyTo(node.id)
  }, [])

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

  const navigateToNode = useCallback((nodeId: string) => {
    if (!graphData) return

    // Handle tag: prefix
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

    // If we have a current node, animate electron path
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
        collapsedNodes={collapsedNodes}
        visibleNodes={visibleNodes}
        nodeOpacity={nodeOpacity}
        bloomEnabled={bloomEnabled}
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
      />

      <Settings
        bloomEnabled={bloomEnabled}
        nodeOpacity={nodeOpacity}
        onBloomToggle={setBloomEnabled}
        onOpacityChange={setNodeOpacity}
      />

      <SearchBar
        visible={searchVisible}
        allNodes={graphData.nodes}
        allTags={allTags}
        onResults={setSearchResults}
        onNavigate={handleSearchNavigate}
        onClose={() => { setSearchVisible(false); setSearchResults(null) }}
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

      {/* Keyboard hint */}
      <div style={{
        position: 'fixed',
        bottom: 80,
        right: 16,
        fontFamily: '"Courier New", monospace',
        fontSize: 10,
        color: '#1a3a4a',
        lineHeight: 1.8,
        pointerEvents: 'none',
        textAlign: 'right',
      }}>
        <div>/ SEARCH</div>
        <div>ESC CLOSE</div>
        <div>] EXPAND</div>
        <div>[ COLLAPSE</div>
        <div>RIGHT-CLICK TOGGLE</div>
      </div>
    </div>
  )
}

export default App
