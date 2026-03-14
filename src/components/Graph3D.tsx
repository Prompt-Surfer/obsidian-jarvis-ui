// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import type { GraphNode, GraphData } from '../hooks/useVaultGraph'
import type { NodePosition, TagBox } from '../hooks/useForce3D'
import { getNodeColor } from '../lib/colors'

interface Graph3DProps {
  graphData: GraphData
  positions: Map<string, NodePosition>
  selectedNodeId: string | null
  hoveredNodeId: string | null
  searchResults: string[] | null
  timeFilterIds: Set<string> | null
  tagIsolationIds: Set<string> | null
  focusModeNodeIds: Set<string> | null
  collapsedNodes: Set<string>
  visibleNodes: Set<string>
  nodeOpacity: number
  bloomEnabled: boolean
  starsEnabled: boolean
  labelsEnabled: boolean
  nodeDegrees: Map<string, number>
  minNodeSize: number
  maxNodeSize: number
  ultraNodeSize: number
  onNodeClick: (node: GraphNode) => void
  onNodeDoubleClick: (node: GraphNode) => void
  onNodeHover: (node: GraphNode | null, x: number, y: number) => void
  onNodeRightClick: (node: GraphNode) => void
  onFlyTo: (nodeId: string) => void
  flashNodeId?: string | null
  onPinNodes?: (pinned: Array<{ id: string; x: number; y: number; z: number }>) => void
  onMoveNodes?: (pinned: Array<{ id: string; x: number; y: number; z: number }>) => void
  onUnpinNodes?: (ids: string[]) => void
  electronScene?: THREE.Scene
  graphShape?: 'sun' | 'saturn' | 'milkyway' | 'brain' | 'natural' | 'tagboxes'
  tagBoxes?: TagBox[]
  linksEnabled?: boolean
  timeFilterActive?: boolean
}

export interface Graph3DHandle {
  flyTo: (nodeId: string) => void
  resetCamera: () => void
  reheat: () => void
  getScene: () => THREE.Scene | null
  getCamera: () => THREE.PerspectiveCamera | null
  getCameraPosition: () => THREE.Vector3
  getCameraTarget: () => THREE.Vector3
  panCameraTo: (x: number, z: number) => void
}

const NODE_RADIUS = 4
const NODE_SEGMENTS = 8

// Enable render-loop profiling via ?perf query param in dev
const DEBUG = import.meta.env.DEV && typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('perf')

function createSelectedTitleSprite(text: string): THREE.Sprite {
  const W = 512, H = 64
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const label = text.length > 32 ? text.slice(0, 30) + '…' : text
  ctx.font = 'bold 16px "Inter", "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#00ccff'
  ctx.globalAlpha = 0.95
  ctx.fillText(label, W / 2, H / 2)
  const texture = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(80, 12, 1)
  return sprite
}

function createLabelSprite(text: string): THREE.Sprite {
  const W = 256, H = 48
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const label = text.length > 22 ? text.slice(0, 20) + '…' : text
  ctx.font = '14px "Inter", "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#00a8cc'
  ctx.globalAlpha = 0.8
  ctx.fillText(label, W / 2, H / 2)
  const texture = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(40, 7.5, 1)
  return sprite
}

function createTagBoxLabelSprite(tag: string, count: number): THREE.Sprite {
  // Canvas resolution is 4× the world-unit scale for crisp text at zoom-out
  const W = 720, H = 144
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 36px "Inter", "Segoe UI", sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(tag, W / 2, H / 2 - 20)
  ctx.font = '26px "Inter", "Segoe UI", sans-serif'
  ctx.fillStyle = '#aaaaaa'
  ctx.fillText(`${count} notes`, W / 2, H / 2 + 30)
  const texture = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })
  const sprite = new THREE.Sprite(mat)
  // Scale to match box width (TAG_BOX_HALF=180 → box width=360); height proportional
  sprite.scale.set(720, 144, 1)
  return sprite
}

export const Graph3D = forwardRef<Graph3DHandle, Graph3DProps>(({
  graphData,
  positions,
  selectedNodeId,
  hoveredNodeId,
  searchResults,
  timeFilterIds,
  tagIsolationIds,
  focusModeNodeIds,
  visibleNodes,
  nodeOpacity,
  bloomEnabled,
  starsEnabled,
  labelsEnabled,
  nodeDegrees,
  minNodeSize,
  maxNodeSize,
  ultraNodeSize,
  onNodeClick,
  onNodeDoubleClick,
  onNodeHover,
  onNodeRightClick: _onNodeRightClick,
  flashNodeId,
  onPinNodes,
  onMoveNodes,
  onUnpinNodes,
  graphShape,
  tagBoxes,
  linksEnabled = true,
  timeFilterActive = false,
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const composerRef = useRef<EffectComposer | null>(null)
  const bloomPassRef = useRef<UnrealBloomPass | null>(null)
  const instancedMeshRef = useRef<THREE.InstancedMesh | null>(null)
  const lineSegmentsRef = useRef<THREE.LineSegments | null>(null)
  const selectedEdgeLinesRef = useRef<THREE.LineSegments | null>(null)
  const tagBoxMeshesRef = useRef<THREE.LineSegments[]>([])
  const tagBoxSpritesRef = useRef<THREE.Sprite[]>([])
  const nodeIndexMapRef = useRef<Map<string, number>>(new Map())
  const starsRef = useRef<THREE.Points | null>(null)
  const galaxySpritesRef = useRef<THREE.Sprite[]>([])
  const labelsMapRef = useRef<Map<string, THREE.Sprite>>(new Map())
  const annotLineRef = useRef<THREE.Line | null>(null)
  const frameRef = useRef<number>(0)
  const lastClickTimeRef = useRef<number>(0)
  const lastClickNodeRef = useRef<string | null>(null)
  const positionsRef = useRef<Map<string, NodePosition>>(new Map())
  const projRef = useRef(new THREE.Vector3())
  const proximityNodeRef = useRef<GraphNode | null>(null)
  const mouseDownPosRef = useRef({ x: 0, y: 0 })
  const rightDragRef = useRef<{
    active: boolean
    nodeIds: string[]
    nodeStartPositions: Map<string, { x: number; y: number; z: number }>
    overridePositions: Map<string, { x: number; y: number; z: number }>
    lastScreenX: number
    lastScreenY: number
  } | null>(null)
  const lastMaxDistUpdateRef = useRef(0)
  const selectedBracketRef = useRef<THREE.LineSegments | null>(null)
  const selectedTitleSpriteRef = useRef<THREE.Sprite | null>(null)
  const [, forceUpdate] = useState(0)
  // PERF: dirty-flag render gate — only call renderer.render() when scene has changed
  const isDirtyRef = useRef(true)

  // Change-detection refs: skip expensive Three.js matrix+link updates when positions unchanged
  const lastPositionsRef = useRef<Map<string, NodePosition> | null>(null)
  const lastVisibleNodesRef = useRef<Set<string> | null>(null)
  const lastSizeParamsRef = useRef({ minNodeSize: -1, maxNodeSize: -1, ultraNodeSize: -1 })
  const lastFiltersRef = useRef({
    timeFilterIds: null as Set<string> | null,
    tagIsolationIds: null as Set<string> | null,
    focusModeNodeIds: null as Set<string> | null,
  })

  // Entrance animation tracking: nodeId → animation startTime (ms)
  const entranceAnimsRef = useRef<Map<string, number>>(new Map())
  // Set of currently-visible nodeIds for new-node detection
  const visibleForAnimRef = useRef<Set<string>>(new Set())
  // Latest props needed by the RAF animation loop (avoids stale closures)
  const liveNodeSizeRef = useRef({ minNodeSize, maxNodeSize, ultraNodeSize })
  const graphDataRef = useRef<GraphData | null>(null)
  const timeFilterActiveRef = useRef(timeFilterActive)

  // Keep animation-support refs in sync with props
  useEffect(() => { liveNodeSizeRef.current = { minNodeSize, maxNodeSize, ultraNodeSize } }, [minNodeSize, maxNodeSize, ultraNodeSize])
  useEffect(() => { graphDataRef.current = graphData }, [graphData])
  useEffect(() => { timeFilterActiveRef.current = timeFilterActive }, [timeFilterActive])

  // Keep positionsRef in sync for proximity detection
  useEffect(() => {
    positionsRef.current = positions
  }, [positions])

  // Build scene once
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    // Cap at 2× — 3× pixel ratio on high-DPI triples GPU load and caps effective FPS.
    // RAF loop is uncapped (targets display refresh, up to 120fps on 120Hz displays).
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    renderer.setClearColor(0x000000, 1)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 200000)
    camera.position.set(0, 0, 600)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.zoomSpeed = 1.2
    controls.zoomToCursor = true
    controls.minDistance = NODE_RADIUS
    // Disable right-click pan — right-click is used for node dragging
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: null as unknown as THREE.MOUSE, // null disables right-click in OrbitControls
    }
    controlsRef.current = controls

    // Bloom post-processing
    const composer = new EffectComposer(renderer)
    const renderPass = new RenderPass(scene, camera)
    composer.addPass(renderPass)

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
      1.5, 0.4, 0.2
    )
    composer.addPass(bloomPass)
    composerRef.current = composer
    bloomPassRef.current = bloomPass

    // Stars — background only (z far negative so they never overlap the graph area).
    // Camera is at z=600 looking toward origin; graph occupies roughly ±2000 in x/y/z.
    // Stars at z=-1500 to -6000 are always behind the action regardless of camera angle.
    const starGeo = new THREE.BufferGeometry()
    const starPositions = new Float32Array(2000 * 3)
    for (let i = 0; i < 2000; i++) {
      starPositions[i * 3]     = (Math.random() - 0.5) * 12000  // wide x spread
      starPositions[i * 3 + 1] = (Math.random() - 0.5) * 12000  // wide y spread
      starPositions[i * 3 + 2] = -1500 - Math.random() * 4500   // z: -1500 to -6000 (background)
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: true, transparent: true, opacity: 0.45 })
    const stars = new THREE.Points(starGeo, starMat)
    stars.visible = false
    scene.add(stars)
    starsRef.current = stars

    // Galaxy stars — 8 large bright white points (5× star size) far in background.
    // Replaces old radial-gradient blob sprites.
    const galStarPositions = [
      [-3000,  2000, -4200], [ 2500, -1800, -5000], [-1500, -3200, -3800],
      [ 4200,  1200, -4600], [-2800,  3600, -5500], [ 1800,  3100, -3900],
      [-4500, -2100, -4300], [ 3300, -3600, -6000],
    ]
    const galGeo = new THREE.BufferGeometry()
    const galPos = new Float32Array(galStarPositions.length * 3)
    galStarPositions.forEach(([x, y, z], i) => { galPos[i*3]=x; galPos[i*3+1]=y; galPos[i*3+2]=z })
    galGeo.setAttribute('position', new THREE.BufferAttribute(galPos, 3))
    const galMat = new THREE.PointsMaterial({ color: 0xffffff, size: 6, sizeAttenuation: true, transparent: true, opacity: 0.95 })
    const galaxyPoints = new THREE.Points(galGeo, galMat)
    galaxyPoints.visible = false
    scene.add(galaxyPoints)
    galaxySpritesRef.current = [galaxyPoints as unknown as THREE.Sprite]

    // Annotation line: cursor → closest proximity node (solid cyan, drawn on top)
    const annotGeo = new THREE.BufferGeometry()
    annotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    const annotMat = new THREE.LineBasicMaterial({ color: 0x00d4ff, depthTest: false })
    const annotLine = new THREE.Line(annotGeo, annotMat)
    annotLine.visible = false
    annotLine.renderOrder = 999
    scene.add(annotLine)
    annotLineRef.current = annotLine

    // Selected node bracket (wireframe cube, thin cyan, low opacity)
    const bracketGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))
    const bracketMat = new THREE.LineBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.4, depthTest: false })
    const selectedBracket = new THREE.LineSegments(bracketGeo, bracketMat)
    selectedBracket.visible = false
    selectedBracket.renderOrder = 997
    scene.add(selectedBracket)
    selectedBracketRef.current = selectedBracket

    // Resize handler
    const onResize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      composer.setSize(w, h)
      isDirtyRef.current = true
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(frameRef.current)
      renderer.dispose()
    }
  }, [])

  // Toggle stars and galaxy points visibility
  useEffect(() => {
    if (starsRef.current) starsRef.current.visible = starsEnabled
    for (const gs of galaxySpritesRef.current) gs.visible = starsEnabled
    isDirtyRef.current = true
  }, [starsEnabled])

  // Update bloom
  useEffect(() => {
    if (bloomPassRef.current) {
      bloomPassRef.current.strength = bloomEnabled ? 1.5 : 0
    }
    isDirtyRef.current = true
  }, [bloomEnabled])

  // Toggle link line visibility
  useEffect(() => {
    if (lineSegmentsRef.current) {
      lineSegmentsRef.current.visible = linksEnabled
      isDirtyRef.current = true
    }
  }, [linksEnabled])

  // Build instanced mesh when graph data is ready
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !graphData) return

    // Remove old meshes
    if (instancedMeshRef.current) {
      scene.remove(instancedMeshRef.current)
      instancedMeshRef.current.dispose()
    }
    if (lineSegmentsRef.current) {
      scene.remove(lineSegmentsRef.current)
      lineSegmentsRef.current.geometry.dispose()
    }

    const nodes = graphData.nodes
    const count = nodes.length

    // Build index map
    const indexMap = new Map<string, number>()
    nodes.forEach((n, i) => indexMap.set(n.id, i))
    nodeIndexMapRef.current = indexMap

    // InstancedMesh for nodes
    const geo = new THREE.SphereGeometry(NODE_RADIUS, NODE_SEGMENTS, NODE_SEGMENTS)
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: nodeOpacity })
    const mesh = new THREE.InstancedMesh(geo, mat, count)
    mesh.frustumCulled = false

    const dummy = new THREE.Object3D()
    const color = new THREE.Color()

    nodes.forEach((node, i) => {
      dummy.position.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      color.set(getNodeColor(node.type, node.folder))
      mesh.setColorAt(i, color)
    })

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    scene.add(mesh)
    instancedMeshRef.current = mesh

    // LineSegments for links — original style unchanged
    const linkPositions = new Float32Array(graphData.links.length * 6)
    const linkGeo = new THREE.BufferGeometry()
    linkGeo.setAttribute('position', new THREE.BufferAttribute(linkPositions, 3))
    const linkMat = new THREE.LineBasicMaterial({ color: 0x1a3a4a, transparent: true, opacity: 0.5 })
    const lines = new THREE.LineSegments(linkGeo, linkMat)
    lines.frustumCulled = false
    scene.add(lines)
    lineSegmentsRef.current = lines

    // Highlight overlay: bright cyan lines drawn on top of connected edges only
    if (selectedEdgeLinesRef.current) {
      scene.remove(selectedEdgeLinesRef.current)
      selectedEdgeLinesRef.current.geometry.dispose()
    }
    const hlPositions = new Float32Array(graphData.links.length * 6)
    const hlGeo = new THREE.BufferGeometry()
    hlGeo.setAttribute('position', new THREE.BufferAttribute(hlPositions, 3))
    hlGeo.setDrawRange(0, 0) // hidden until a node is selected
    const hlMat = new THREE.LineBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    const hlLines = new THREE.LineSegments(hlGeo, hlMat)
    hlLines.frustumCulled = false
    hlLines.renderOrder = 1
    scene.add(hlLines)
    selectedEdgeLinesRef.current = hlLines

    forceUpdate(x => x + 1)
  }, [graphData])

  // PERF: lazy label sprites — dispose on graphData change; new sprites created on-demand in the
  // positions effect only when labelsEnabled is true. Avoids 927 CanvasTextures on startup.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !graphData) return

    for (const sprite of labelsMapRef.current.values()) {
      scene.remove(sprite)
      ;(sprite.material as THREE.SpriteMaterial).map?.dispose()
      sprite.material.dispose()
    }
    labelsMapRef.current.clear()
  }, [graphData])

  // Selected node: 3D wireframe bracket + floating title sprite
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    const bracket = selectedBracketRef.current

    if (!selectedNodeId || !graphData) {
      if (bracket) bracket.visible = false
      return () => { /* no sprite to clean up */ }
    }

    const node = graphData.nodes.find(n => n.id === selectedNodeId)
    if (!node) {
      if (bracket) bracket.visible = false
      return () => { /* no sprite to clean up */ }
    }

    // Create floating title sprite
    const sprite = createSelectedTitleSprite(node.label)
    sprite.visible = false
    scene.add(sprite)
    selectedTitleSpriteRef.current = sprite

    // Size bracket proportional to node size (tier from worker)
    if (bracket) {
      const selPos = positionsRef.current.get(selectedNodeId)
      const selTier = selPos?.tier ?? 'regular'
      const sizeMult = selTier === 'ultranode' ? ultraNodeSize : selTier === 'supernode' ? maxNodeSize : minNodeSize
      const bracketSize = NODE_RADIUS * sizeMult * 3
      bracket.scale.set(bracketSize, bracketSize, bracketSize)
      bracket.visible = true
    }

    // Position immediately if position data is available
    const selPos = positionsRef.current.get(selectedNodeId)
    if (selPos) {
      if (bracket) bracket.position.set(selPos.x, selPos.y, selPos.z)
      sprite.position.set(selPos.x, selPos.y + NODE_RADIUS * 5.5, selPos.z)
      sprite.visible = true
    }

    isDirtyRef.current = true
    return () => {
      scene.remove(sprite)
      ;(sprite.material as THREE.SpriteMaterial).map?.dispose()
      sprite.material.dispose()
      selectedTitleSpriteRef.current = null
      if (bracket) bracket.visible = false
      isDirtyRef.current = true
    }
  }, [selectedNodeId, graphData, nodeDegrees, minNodeSize, maxNodeSize, ultraNodeSize])

  // Tag box wireframes — render/remove white EdgesGeometry boxes + label sprites for tagboxes shape
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    // Remove old boxes
    for (const box of tagBoxMeshesRef.current) {
      scene.remove(box)
      box.geometry.dispose()
    }
    tagBoxMeshesRef.current = []

    // Remove old label sprites
    for (const sprite of tagBoxSpritesRef.current) {
      scene.remove(sprite)
      ;(sprite.material as THREE.SpriteMaterial).map?.dispose()
      sprite.material.dispose()
    }
    tagBoxSpritesRef.current = []

    if (graphShape !== 'tagboxes' || !tagBoxes || tagBoxes.length === 0) return

    for (const box of tagBoxes) {
      const isVirtual = box.isVirtual ?? false
      const hx = box.halfSizeX ?? box.halfSize ?? 180
      const hy = box.halfSizeY ?? box.halfSize ?? 180
      const hz = box.halfSizeZ ?? box.halfSize ?? 180
      const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2))
      const mat = new THREE.LineBasicMaterial({
        color: isVirtual ? 0x00ffcc : 0xffffff,
        transparent: true,
        opacity: isVirtual ? 0.4 : 1.0,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      })
      const lines = new THREE.LineSegments(geo, mat)
      lines.position.set(box.cx, box.cy, box.cz)
      scene.add(lines)
      tagBoxMeshesRef.current.push(lines)

      // Label sprite positioned below bottom front edge
      const sprite = createTagBoxLabelSprite(box.tag, box.count)
      if (isVirtual) {
        // Virtual boxes get smaller labels
        sprite.scale.multiplyScalar(0.8)
      }
      sprite.position.set(
        box.cx,
        box.cy - hy - 20,
        box.cz + hz,
      )
      scene.add(sprite)
      tagBoxSpritesRef.current.push(sprite)
    }
    isDirtyRef.current = true
  }, [tagBoxes, graphShape])

  // Update positions each frame from simulation
  useEffect(() => {
    const mesh = instancedMeshRef.current
    const lines = lineSegmentsRef.current
    if (!mesh || !lines || positions.size === 0 || !graphData) return

    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    const nodes = graphData.nodes

    // Detect which changes occurred — skip expensive matrix+link updates when only
    // colors/interaction state changed (hover, selection, search highlight, opacity)
    const positionsChanged = positions !== lastPositionsRef.current
    const visibleNodesChanged = visibleNodes !== lastVisibleNodesRef.current
    const sizeChanged =
      minNodeSize !== lastSizeParamsRef.current.minNodeSize ||
      maxNodeSize !== lastSizeParamsRef.current.maxNodeSize ||
      ultraNodeSize !== lastSizeParamsRef.current.ultraNodeSize
    const filtersChanged =
      timeFilterIds !== lastFiltersRef.current.timeFilterIds ||
      tagIsolationIds !== lastFiltersRef.current.tagIsolationIds ||
      focusModeNodeIds !== lastFiltersRef.current.focusModeNodeIds
    // Matrix update needed when positions, visibility, size, or filter layout changes
    const needsMatrixUpdate = positionsChanged || visibleNodesChanged || sizeChanged || filtersChanged

    if (needsMatrixUpdate) {
      lastPositionsRef.current = positions
      lastVisibleNodesRef.current = visibleNodes
      lastSizeParamsRef.current = { minNodeSize, maxNodeSize, ultraNodeSize }
      lastFiltersRef.current = { timeFilterIds, tagIsolationIds, focusModeNodeIds }
    }

    const newVisibleSet = new Set<string>()

    nodes.forEach((node, i) => {
      const pos = positions.get(node.id)
      if (!pos) return

      // Visibility: respect time filter, collapse state, tag isolation, and focus mode
      const inTimeFilter = !timeFilterIds || timeFilterIds.has(node.id)
      const inSearch = !searchResults || searchResults.includes(node.id)
      const isVisible = visibleNodes.has(node.id)
      const inTagIsolation = !tagIsolationIds || tagIsolationIds.has(node.id)
      const inFocusMode = !focusModeNodeIds || focusModeNodeIds.has(node.id)
      const visible = inTimeFilter && isVisible && inTagIsolation && inFocusMode

      if (visible) newVisibleSet.add(node.id)

      // PERF: InstancedMesh matrix skip — only re-upload when positions/visibility/size/filters change;
      // hover/selection-only changes skip the O(N) matrix loop entirely (color-only update path)
      if (needsMatrixUpdate) {
        const tier = pos.tier ?? 'regular'
        const sizeMultiplier = tier === 'ultranode' ? ultraNodeSize : tier === 'supernode' ? maxNodeSize : minNodeSize

        // Entrance animation: detect nodes newly revealed by time filter
        const wasVisible = visibleForAnimRef.current.has(node.id)
        if (timeFilterActive && visible && !wasVisible) {
          // Register animation — start scale at 0, RAF loop will animate it up
          entranceAnimsRef.current.set(node.id, performance.now())
        }

        const isAnimating = entranceAnimsRef.current.has(node.id)
        if (!isAnimating) {
          // Normal matrix update
          const scale = visible ? sizeMultiplier : 0
          dummy.position.set(pos.x, pos.y, pos.z)
          dummy.scale.set(scale, scale, scale)
          dummy.updateMatrix()
          mesh.setMatrixAt(i, dummy.matrix)
        } else {
          // Animating: set position but scale=0 so RAF loop can animate from 0→target
          dummy.position.set(pos.x, pos.y, pos.z)
          dummy.scale.set(0, 0, 0)
          dummy.updateMatrix()
          mesh.setMatrixAt(i, dummy.matrix)
        }
      }

      // Color: always update (cheap — responds to hover/selection/search/opacity changes)
      // Skip color for animating nodes — RAF loop handles their brightness
      const isAnimating = entranceAnimsRef.current.has(node.id)
      if (!isAnimating) {
        const baseColor = node.id === flashNodeId
          ? 0xffffff
          : getNodeColor(node.type, node.folder)

        const opacity = !inSearch && searchResults !== null
          ? 0.1
          : (visible ? nodeOpacity : 0)

        color.set(baseColor).multiplyScalar(opacity > 0 ? 1 : 0)
        if (node.id === hoveredNodeId) color.set(baseColor).multiplyScalar(1.5)
        mesh.setColorAt(i, color)
      }
    })

    // Update visibility tracking for entrance animation detection
    visibleForAnimRef.current = newVisibleSet

    if (needsMatrixUpdate) mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

    // PERF: link geometry — in-place BufferAttribute update; no new Float32Array/BufferGeometry
    // allocated per tick → zero GC pressure; needsUpdate flag uploads only the changed slice
    if (needsMatrixUpdate) {
      const posArray = (lines.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
      graphData.links.forEach((link, i) => {
        const srcId = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id
        const dstId = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id
        const src = positions.get(srcId)
        const dst = positions.get(dstId)

        const srcVisible = visibleNodes.has(srcId) && (!timeFilterIds || timeFilterIds.has(srcId)) && (!tagIsolationIds || tagIsolationIds.has(srcId)) && (!focusModeNodeIds || focusModeNodeIds.has(srcId))
        const dstVisible = visibleNodes.has(dstId) && (!timeFilterIds || timeFilterIds.has(dstId)) && (!tagIsolationIds || tagIsolationIds.has(dstId)) && (!focusModeNodeIds || focusModeNodeIds.has(dstId))
        const linkVisible = srcVisible && dstVisible

        if (src && dst && linkVisible) {
          posArray[i * 6] = src.x; posArray[i * 6 + 1] = src.y; posArray[i * 6 + 2] = src.z
          posArray[i * 6 + 3] = dst.x; posArray[i * 6 + 4] = dst.y; posArray[i * 6 + 5] = dst.z
        } else {
          for (let k = 0; k < 6; k++) posArray[i * 6 + k] = 0
        }
      })
      ;(lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    }

    // Fade links in milkyway/saturn to let shape structure show through
    const linkFade = graphShape === 'milkyway' ? 0.15 : graphShape === 'saturn' ? 0.3 : 0.6
    ;(lines.material as THREE.LineBasicMaterial).opacity = nodeOpacity * linkFade

    // Update node material opacity in-place (avoids full mesh rebuild on slider change)
    const nodeMesh = instancedMeshRef.current
    if (nodeMesh) {
      ;(nodeMesh.material as THREE.MeshBasicMaterial).opacity = nodeOpacity
    }

    // Update highlight overlay: only connected edges when a node is selected
    const hlLines = selectedEdgeLinesRef.current
    if (hlLines) {
      if (selectedNodeId) {
        const hlPos = (hlLines.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
        let hlCount = 0
        graphData.links.forEach((link) => {
          const srcId = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id
          const dstId = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id
          if (srcId !== selectedNodeId && dstId !== selectedNodeId) return
          const src = positions.get(srcId); const dst = positions.get(dstId)
          if (!src || !dst) return
          const base = hlCount * 6
          hlPos[base]=src.x; hlPos[base+1]=src.y; hlPos[base+2]=src.z
          hlPos[base+3]=dst.x; hlPos[base+4]=dst.y; hlPos[base+5]=dst.z
          hlCount++
        })
        ;(hlLines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
        hlLines.geometry.setDrawRange(0, hlCount * 2)
      } else {
        hlLines.geometry.setDrawRange(0, 0)
      }
    }

    // PERF: lazy label sprites — allocate CanvasTexture only when node first becomes visible
    // with labelsEnabled on; avoids 927 upfront allocations when labels are off at startup
    const labelScene = sceneRef.current
    for (const node of nodes) {
      const nodeId = node.id
      const pos = positions.get(nodeId)
      if (!pos) continue
      const inTagIso = !tagIsolationIds || tagIsolationIds.has(nodeId)
      const inTimeF = !timeFilterIds || timeFilterIds.has(nodeId)
      const inFocusM = !focusModeNodeIds || focusModeNodeIds.has(nodeId)
      const shouldShow = labelsEnabled && inTimeF && visibleNodes.has(nodeId) && inTagIso && inFocusM
      let sprite = labelsMapRef.current.get(nodeId)
      if (!sprite && shouldShow && labelScene) {
        sprite = createLabelSprite(node.label)
        sprite.visible = false
        labelScene.add(sprite)
        labelsMapRef.current.set(nodeId, sprite)
      }
      if (!sprite) continue
      if (positionsChanged) {
        sprite.position.set(pos.x, pos.y + NODE_RADIUS * 3, pos.z)
      }
      sprite.visible = shouldShow
    }

    // Throttled: clamp controls.maxDistance to bounding sphere fit (at most every 2s)
    const nowMs = Date.now()
    if (nowMs - lastMaxDistUpdateRef.current > 2000 || lastMaxDistUpdateRef.current === 0) {
      lastMaxDistUpdateRef.current = nowMs
      const bsPts: THREE.Vector3[] = []
      for (const [, p] of positions) bsPts.push(new THREE.Vector3(p.x, p.y, p.z))
      if (bsPts.length > 0 && controlsRef.current && cameraRef.current) {
        const bsBox = new THREE.Box3().setFromPoints(bsPts)
        const bsSphere = new THREE.Sphere()
        bsBox.getBoundingSphere(bsSphere)
        const fovRad = cameraRef.current.fov * Math.PI / 180
        controlsRef.current.maxDistance = (bsSphere.radius * 1.1) / Math.tan(fovRad / 2)
      }
    }

    // Update selected node bracket and title sprite positions
    if (selectedNodeId) {
      const selPos = positions.get(selectedNodeId)
      if (selPos) {
        if (selectedBracketRef.current?.visible) {
          selectedBracketRef.current.position.set(selPos.x, selPos.y, selPos.z)
        }
        if (selectedTitleSpriteRef.current?.visible) {
          selectedTitleSpriteRef.current.position.set(selPos.x, selPos.y + NODE_RADIUS * 5.5, selPos.z)
        }
      }
    }

    // PERF: dirty-flag render gate — Three.js scene objects updated; signal one render needed
    isDirtyRef.current = true

  }, [positions, graphData, selectedNodeId, hoveredNodeId, searchResults, timeFilterIds, tagIsolationIds, focusModeNodeIds, visibleNodes, nodeOpacity, flashNodeId, nodeDegrees, minNodeSize, maxNodeSize, ultraNodeSize, labelsEnabled, timeFilterActive])

  // Animate loop
  useEffect(() => {
    const composer = composerRef.current
    const controls = controlsRef.current
    if (!composer || !controls) return

    // PERF: dirty-flag render gate — saves ~60 renderer.render() calls/sec when sim stable and
    // camera is at rest. OrbitControls fires 'change' on every camera move (user input + damping
    // decay), so damping continues rendering until it fully settles with no extra logic needed.
    const onControlsChange = () => { isDirtyRef.current = true }
    controls.addEventListener('change', onControlsChange)

    let animId: number
    let renderCount = 0
    const localControls = controls
    const localComposer = composer

    // Reusable objects for entrance animation (avoid per-frame allocation)
    const animDummy = new THREE.Object3D()
    const animColor = new THREE.Color()
    const SCALE_DUR = 600  // ms — scale 0 → 1
    const GLOW_DUR = 800   // ms — emissive brightness spike → base

    function loop() {
      animId = requestAnimationFrame(loop)
      // PERF: controls.update() runs every frame to advance damping; the 'change' event fires
      // automatically during damping decay, keeping isDirtyRef true until camera fully settles
      localControls.update()

      // Process node entrance animations (time-lapse reveal)
      const anims = entranceAnimsRef.current
      const mesh = instancedMeshRef.current
      const gData = graphDataRef.current
      if (anims.size > 0 && mesh && gData) {
        const now = performance.now()
        const toDelete: string[] = []
        const { minNodeSize: mnSize, maxNodeSize: mxSize, ultraNodeSize: ulSize } = liveNodeSizeRef.current

        for (const [nodeId, startTime] of anims) {
          const elapsed = now - startTime
          const idx = nodeIndexMapRef.current.get(nodeId)
          if (idx === undefined) { toDelete.push(nodeId); continue }

          const pos = positionsRef.current.get(nodeId)
          if (!pos) continue

          const tier = pos.tier ?? 'regular'
          const baseSizeMult = tier === 'ultranode' ? ulSize : tier === 'supernode' ? mxSize : mnSize
          const node = gData.nodes[idx]

          if (elapsed >= Math.max(SCALE_DUR, GLOW_DUR)) {
            // Animation complete — restore final state and remove
            animDummy.position.set(pos.x, pos.y, pos.z)
            animDummy.scale.set(baseSizeMult, baseSizeMult, baseSizeMult)
            animDummy.updateMatrix()
            mesh.setMatrixAt(idx, animDummy.matrix)
            animColor.set(getNodeColor(node.type, node.folder))
            mesh.setColorAt(idx, animColor)
            toDelete.push(nodeId)
            continue
          }

          // Scale: ease-out cubic 0 → baseSizeMult over SCALE_DUR
          const st = Math.min(elapsed / SCALE_DUR, 1)
          const scaleT = 1 - Math.pow(1 - st, 3)
          animDummy.position.set(pos.x, pos.y, pos.z)
          animDummy.scale.set(scaleT * baseSizeMult, scaleT * baseSizeMult, scaleT * baseSizeMult)
          animDummy.updateMatrix()
          mesh.setMatrixAt(idx, animDummy.matrix)

          // Glow burst: brightness spike decays from 2.7× to 1× over GLOW_DUR
          const gt = Math.min(elapsed / GLOW_DUR, 1)
          const brightnessMult = 1 + 1.7 * (1 - gt)
          animColor.set(getNodeColor(node.type, node.folder)).multiplyScalar(brightnessMult)
          mesh.setColorAt(idx, animColor)
        }

        for (const id of toDelete) anims.delete(id)
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        isDirtyRef.current = true
      }

      if (isDirtyRef.current) {
        isDirtyRef.current = false
        renderCount++
        localComposer.render()
        // Periodic draw-call profiling (only in dev with ?perf flag)
        if (DEBUG && renderCount % 60 === 0) {
          const r = rendererRef.current
          if (r) console.debug(`[perf] renders=${renderCount} drawCalls=${r.info.render.calls} triangles=${r.info.render.triangles} programs=${r.info.programs?.length ?? 0}`)
        }
      }
    }
    animId = requestAnimationFrame(loop)
    frameRef.current = animId
    return () => {
      cancelAnimationFrame(animId)
      controls.removeEventListener('change', onControlsChange)
    }
  }, [composerRef.current, controlsRef.current])

  // Mouse interaction
  const raycasterRef = useRef(new THREE.Raycaster())
  const mouseRef = useRef(new THREE.Vector2())

  const getHitNode = useCallback((e: React.MouseEvent): { node: GraphNode; index: number } | null => {
    const canvas = canvasRef.current
    const camera = cameraRef.current
    const mesh = instancedMeshRef.current
    if (!canvas || !camera || !mesh || !graphData) return null

    const rect = canvas.getBoundingClientRect()
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

    raycasterRef.current.setFromCamera(mouseRef.current, camera)
    raycasterRef.current.params.Points = { threshold: 10 }

    const hits = raycasterRef.current.intersectObject(mesh)
    if (!hits.length) return null

    const instanceId = hits[0].instanceId
    if (instanceId === undefined) return null

    const node = graphData.nodes[instanceId]
    if (!node || !visibleNodes.has(node.id)) return null
    if (tagIsolationIds && !tagIsolationIds.has(node.id)) return null
    if (timeFilterIds && !timeFilterIds.has(node.id)) return null
    return { node, index: instanceId }
  }, [graphData, visibleNodes, tagIsolationIds, timeFilterIds])

  // Apply right-drag overrides directly to Three.js objects
  const applyRightDragToScene = useCallback(() => {
    const drag = rightDragRef.current
    if (!drag?.active || !graphData) return
    const mesh = instancedMeshRef.current
    const lines = lineSegmentsRef.current
    if (!mesh) return

    const dummy = new THREE.Object3D()
    for (const nodeId of drag.nodeIds) {
      const idx = nodeIndexMapRef.current.get(nodeId)
      const pos = drag.overridePositions.get(nodeId)
      if (idx === undefined || !pos) continue
      mesh.getMatrixAt(idx, dummy.matrix)
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale)
      dummy.position.set(pos.x, pos.y, pos.z)
      dummy.updateMatrix()
      mesh.setMatrixAt(idx, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true

    // Update link positions for affected links
    if (lines) {
      const posArray = (lines.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
      graphData.links.forEach((link, i) => {
        const srcId = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id
        const dstId = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id
        const isDragSrc = drag.nodeIds.includes(srcId)
        const isDragDst = drag.nodeIds.includes(dstId)
        if (!isDragSrc && !isDragDst) return
        const srcPos = isDragSrc ? drag.overridePositions.get(srcId) : positionsRef.current.get(srcId)
        const dstPos = isDragDst ? drag.overridePositions.get(dstId) : positionsRef.current.get(dstId)
        if (!srcPos || !dstPos) return
        posArray[i * 6] = srcPos.x; posArray[i * 6 + 1] = srcPos.y; posArray[i * 6 + 2] = srcPos.z
        posArray[i * 6 + 3] = dstPos.x; posArray[i * 6 + 4] = dstPos.y; posArray[i * 6 + 5] = dstPos.z
      })
      ;(lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    }
  }, [graphData])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Handle right-drag — pure 2D screen-space movement (no depth bleed)
    const drag = rightDragRef.current
    if (drag?.active && (e.buttons & 2)) {
      const camera = cameraRef.current
      const canvas = canvasRef.current
      if (!camera || !canvas) return

      // Screen delta (pixels)
      const sdx = e.clientX - drag.lastScreenX
      const sdy = e.clientY - drag.lastScreenY
      drag.lastScreenX = e.clientX
      drag.lastScreenY = e.clientY

      // World units per pixel: perspective scale at node's depth
      const primaryId = drag.nodeIds[0]
      const primaryPos = drag.overridePositions.get(primaryId) ?? drag.nodeStartPositions.get(primaryId)
      if (!primaryPos) return

      const nodeVec = new THREE.Vector3(primaryPos.x, primaryPos.y, primaryPos.z)
      const dist = camera.position.distanceTo(nodeVec)
      const fovRad = (camera as THREE.PerspectiveCamera).fov * Math.PI / 180
      const scale = (2 * dist * Math.tan(fovRad / 2)) / canvas.clientHeight

      // Camera right/up vectors (columns 0 and 1 of camera world matrix)
      // Moving along these is always perpendicular to camera view = zero depth change
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0)
      const up    = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1)

      const wx = right.x * sdx * scale + up.x * (-sdy) * scale
      const wy = right.y * sdx * scale + up.y * (-sdy) * scale
      const wz = right.z * sdx * scale + up.z * (-sdy) * scale

      const op = drag.overridePositions.get(primaryId)
      if (op) { op.x += wx; op.y += wy; op.z += wz }

      applyRightDragToScene()
      // Sync worker sim so connected nodes follow in real time
      onMoveNodes?.(drag.nodeIds.map(id => {
        const p = drag.overridePositions.get(id)!
        return { id, x: p.x, y: p.y, z: p.z }
      }))
      return
    }

    const hit = getHitNode(e)
    if (hit) {
      onNodeHover(hit.node, e.clientX, e.clientY)
      return
    }

    // Proximity detection: find nearest node in screen space within 80px threshold
    const camera = cameraRef.current
    const canvas = canvasRef.current
    if (!camera || !canvas || !graphData) {
      onNodeHover(null, 0, 0)
      return
    }

    const rect = canvas.getBoundingClientRect()
    const THRESHOLD = 80
    let nearestNode: GraphNode | null = null
    let minDist = THRESHOLD

    for (const node of graphData.nodes) {
      if (!visibleNodes.has(node.id)) continue
      if (tagIsolationIds && !tagIsolationIds.has(node.id)) continue
      if (timeFilterIds && !timeFilterIds.has(node.id)) continue
      const pos = positionsRef.current.get(node.id)
      if (!pos) continue

      projRef.current.set(pos.x, pos.y, pos.z).project(camera)
      if (projRef.current.z > 1) continue // behind camera

      const screenX = (projRef.current.x + 1) / 2 * rect.width + rect.left
      const screenY = (-projRef.current.y + 1) / 2 * rect.height + rect.top
      const dx = e.clientX - screenX
      const dy = e.clientY - screenY
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < minDist) {
        minDist = dist
        nearestNode = node
      }
    }

    proximityNodeRef.current = nearestNode

    // Update annotation line: cursor world pos → nearest node
    const annotLine = annotLineRef.current
    if (annotLine) {
      if (nearestNode) {
        const nodePos = positionsRef.current.get(nearestNode.id)
        if (nodePos && camera && canvas) {
          const nr = canvas.getBoundingClientRect()
          const mx = ((e.clientX - nr.left) / nr.width) * 2 - 1
          const my = -((e.clientY - nr.top) / nr.height) * 2 + 1
          raycasterRef.current.setFromCamera(new THREE.Vector2(mx, my), camera)
          const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -nodePos.z)
          const cursor3D = new THREE.Vector3()
          raycasterRef.current.ray.intersectPlane(plane, cursor3D)
          const pts = (annotLine.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
          pts[0] = cursor3D.x; pts[1] = cursor3D.y; pts[2] = cursor3D.z
          pts[3] = nodePos.x; pts[4] = nodePos.y; pts[5] = nodePos.z
          ;(annotLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
          annotLine.visible = true
        }
      } else {
        annotLine.visible = false
      }
    }

    onNodeHover(nearestNode, e.clientX, e.clientY)
  }, [getHitNode, onNodeHover, graphData, visibleNodes, tagIsolationIds, timeFilterIds, applyRightDragToScene, onMoveNodes])

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Ignore if this was a drag (mouse moved > 5px from mousedown position)
    const dx = e.clientX - mouseDownPosRef.current.x
    const dy = e.clientY - mouseDownPosRef.current.y
    if (dx * dx + dy * dy > 25) return

    const hit = getHitNode(e)
    const now = Date.now()

    if (!hit) {
      // Fallback: open proximity-previewed note if one is active
      const prox = proximityNodeRef.current
      if (prox) {
        lastClickTimeRef.current = now
        lastClickNodeRef.current = prox.id
        onNodeClick(prox)
      }
      return
    }

    const isDouble = now - lastClickTimeRef.current < 350 && lastClickNodeRef.current === hit.node.id
    lastClickTimeRef.current = now
    lastClickNodeRef.current = hit.node.id

    if (isDouble) {
      onNodeDoubleClick(hit.node)
    } else {
      onNodeClick(hit.node)
    }
  }, [getHitNode, onNodeClick, onNodeDoubleClick])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault() // suppress browser context menu; right-drag is handled in onMouseDown
  }, [])

  // flyTo handler
  const flyTo = useCallback((nodeId: string) => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    const pos = positions.get(nodeId)
    if (!camera || !controls || !pos) return

    const target = new THREE.Vector3(pos.x, pos.y, pos.z)
    const startPos = camera.position.clone()
    const startTarget = controls.target.clone()
    const endPos = new THREE.Vector3(pos.x, pos.y, pos.z + 159)

    let t = 0
    const duration = 600
    const start = performance.now()

    const localCamera = camera
    const localControls = controls
    function animFly(now: number) {
      t = Math.min((now - start) / duration, 1)
      const ease = 1 - Math.pow(1 - t, 3)
      localCamera.position.lerpVectors(startPos, endPos, ease)
      localControls.target.lerpVectors(startTarget, target, ease)
      localControls.update()
      if (t < 1) requestAnimationFrame(animFly)
    }
    requestAnimationFrame(animFly)
  }, [positions])

  // resetCamera handler — fit all nodes in view using bounding box centroid
  const resetCamera = useCallback(() => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return

    // Compute bounding sphere of all node positions
    const pts: THREE.Vector3[] = []
    for (const [, pos] of positionsRef.current) {
      pts.push(new THREE.Vector3(pos.x, pos.y, pos.z))
    }

    // Compute actual centroid of all node positions
    const endTarget = new THREE.Vector3()
    let dist = 600
    if (pts.length > 0) {
      let cx = 0, cy = 0, cz = 0
      for (const p of pts) { cx += p.x; cy += p.y; cz += p.z }
      cx /= pts.length; cy /= pts.length; cz /= pts.length
      endTarget.set(cx, cy, cz)

      if (graphShape === 'milkyway') {
        // Use 80th percentile distance from centroid — excludes orphan outliers
        const dists = pts.map(p => p.distanceTo(endTarget)).sort((a, b) => a - b)
        const p80 = dists[Math.floor(dists.length * 0.80)] || 600
        const fov = camera.fov * Math.PI / 180
        dist = (p80 * 2.0) / Math.tan(fov / 2)
      } else {
        const box = new THREE.Box3().setFromPoints(pts)
        const sphere = new THREE.Sphere()
        box.getBoundingSphere(sphere)
        const fov = camera.fov * Math.PI / 180
        dist = (sphere.radius * 1.4) / Math.tan(fov / 2)
      }
    }
    controls.maxDistance = 500000
    // Shape-specific camera angles
    let endPos: THREE.Vector3
    if (graphShape === 'milkyway') {
      // 50° above XZ plane — see spiral structure from above
      const angle = 50 * Math.PI / 180
      endPos = new THREE.Vector3(
        endTarget.x,
        endTarget.y + dist * Math.sin(angle),
        endTarget.z + dist * Math.cos(angle)
      )
    } else if (graphShape === 'saturn') {
      // 40° above ring plane — dramatic tilt view showing ring as tilted ellipse
      const angle = 40 * Math.PI / 180
      endPos = new THREE.Vector3(
        endTarget.x,
        endTarget.y + dist * Math.sin(angle),
        endTarget.z + dist * Math.cos(angle)
      )
    } else if (graphShape === 'brain') {
      // 15° from the side — medical diagram view
      const angle = 15 * Math.PI / 180
      endPos = new THREE.Vector3(
        endTarget.x + dist * Math.cos(angle),
        endTarget.y + dist * Math.sin(angle) * 0.3,
        endTarget.z + dist * 0.1
      )
    } else if (graphShape === 'tagboxes') {
      // Straight-on front view — flat grid layout, slight elevation
      endPos = new THREE.Vector3(endTarget.x, endTarget.y + dist * 0.15, endTarget.z + dist)
    } else {
      endPos = new THREE.Vector3(endTarget.x, endTarget.y, endTarget.z + dist)
    }

    const startPos = camera.position.clone()
    const startTarget = controls.target.clone()
    const duration = 500
    const start = performance.now()

    const localCamera = camera
    const localControls = controls
    function animReset(now: number) {
      const t = Math.min((now - start) / duration, 1)
      const ease = 1 - Math.pow(1 - t, 3)
      localCamera.position.lerpVectors(startPos, endPos, ease)
      localControls.target.lerpVectors(startTarget, endTarget, ease)
      localControls.update()
      if (t < 1) requestAnimationFrame(animReset)
    }
    requestAnimationFrame(animReset)
  }, [graphShape])

  useImperativeHandle(ref, () => ({
    flyTo,
    resetCamera,
    reheat: () => {},
    getScene: () => sceneRef.current,
    getCamera: () => cameraRef.current,
    getCameraPosition: () => {
      const controls = controlsRef.current
      if (!controls) return new THREE.Vector3()
      return controls.object.position.clone()
    },
    getCameraTarget: () => {
      const controls = controlsRef.current
      if (!controls) return new THREE.Vector3()
      return controls.target.clone()
    },
    panCameraTo: (x: number, z: number) => {
      const controls = controlsRef.current
      if (!controls) return
      const camera = controls.object
      const target = controls.target
      const dx = x - target.x
      const dz = z - target.z
      camera.position.x += dx
      camera.position.z += dz
      target.x = x
      target.z = z
      controls.update()
    },
  }), [flyTo, resetCamera])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY }

    if (e.button === 2 && graphData) {
      // Right-click: find closest node via proximity detection and start drag
      const camera = cameraRef.current
      const canvas = canvasRef.current
      if (!camera || !canvas) return

      const rect = canvas.getBoundingClientRect()
      const THRESHOLD = 80
      let nearestNode: GraphNode | null = null
      let minDist = THRESHOLD

      for (const node of graphData.nodes) {
        if (!visibleNodes.has(node.id)) continue
        if (tagIsolationIds && !tagIsolationIds.has(node.id)) continue
        if (timeFilterIds && !timeFilterIds.has(node.id)) continue
        const pos = positionsRef.current.get(node.id)
        if (!pos) continue
        projRef.current.set(pos.x, pos.y, pos.z).project(camera)
        if (projRef.current.z > 1) continue
        const screenX = (projRef.current.x + 1) / 2 * rect.width + rect.left
        const screenY = (-projRef.current.y + 1) / 2 * rect.height + rect.top
        const dist = Math.sqrt((e.clientX - screenX) ** 2 + (e.clientY - screenY) ** 2)
        if (dist < minDist) { minDist = dist; nearestNode = node }
      }

      if (!nearestNode) return

      // Only drag the grabbed node — connected nodes follow naturally via sim link forces
      const primaryPos = positionsRef.current.get(nearestNode.id)
      if (!primaryPos) return

      const overridePositions = new Map<string, { x: number; y: number; z: number }>()
      overridePositions.set(nearestNode.id, { x: primaryPos.x, y: primaryPos.y, z: primaryPos.z })

      rightDragRef.current = {
        active: true,
        nodeIds: [nearestNode.id],
        nodeStartPositions: new Map([[nearestNode.id, { x: primaryPos.x, y: primaryPos.y, z: primaryPos.z }]]),
        overridePositions,
        lastScreenX: e.clientX,
        lastScreenY: e.clientY,
      }

      // Pin only the grabbed node; sim link forces pull connected nodes naturally
      onPinNodes?.([{ id: nearestNode.id, x: primaryPos.x, y: primaryPos.y, z: primaryPos.z }])

      // Brightness boost for dragged cluster
      const mesh = instancedMeshRef.current
      if (mesh) {
        const color = new THREE.Color()
        for (const nodeId of [nearestNode.id]) {
          const idx = nodeIndexMapRef.current.get(nodeId)
          if (idx === undefined) continue
          const node = graphData.nodes[idx]
          if (!node) continue
          color.set(getNodeColor(node.type, node.folder)).multiplyScalar(2.0)
          mesh.setColorAt(idx, color)
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
    }
  }, [graphData, visibleNodes, tagIsolationIds, timeFilterIds, onPinNodes])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const drag = rightDragRef.current
    if (drag?.active && e.button === 2) {
      // Restore normal colours and clear drag state
      const mesh = instancedMeshRef.current
      if (mesh && graphData) {
        const color = new THREE.Color()
        for (const nodeId of drag.nodeIds) {
          const idx = nodeIndexMapRef.current.get(nodeId)
          if (idx === undefined) continue
          const node = graphData.nodes[idx]
          if (!node) continue
          color.set(getNodeColor(node.type, node.folder))
          mesh.setColorAt(idx, color)
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
      // Release pinned nodes in sim — let forces settle from final drag position
      onUnpinNodes?.(drag.nodeIds)
      rightDragRef.current = null
    }
  }, [graphData, onUnpinNodes])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseLeave={() => {
        proximityNodeRef.current = null
        if (annotLineRef.current) annotLineRef.current.visible = false
        onNodeHover(null, 0, 0)
        // Clear any active right-drag on mouse leave
        if (rightDragRef.current?.active) {
          rightDragRef.current = null
        }
      }}
    />
  )
})

Graph3D.displayName = 'Graph3D'
