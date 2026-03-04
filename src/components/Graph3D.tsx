import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import type { GraphNode, GraphData } from '../hooks/useVaultGraph'
import type { NodePosition } from '../hooks/useForce3D'
import { getNodeColor } from '../lib/colors'

interface Graph3DProps {
  graphData: GraphData
  positions: Map<string, NodePosition>
  selectedNodeId: string | null
  hoveredNodeId: string | null
  searchResults: string[] | null
  timeFilterIds: Set<string> | null
  tagIsolationIds: Set<string> | null
  collapsedNodes: Set<string>
  visibleNodes: Set<string>
  nodeOpacity: number
  bloomEnabled: boolean
  starsEnabled: boolean
  labelsEnabled: boolean
  nodeDegrees: Map<string, number>
  minNodeSize: number
  maxNodeSize: number
  onNodeClick: (node: GraphNode) => void
  onNodeDoubleClick: (node: GraphNode) => void
  onNodeHover: (node: GraphNode | null, x: number, y: number) => void
  onNodeRightClick: (node: GraphNode) => void
  onFlyTo: (nodeId: string) => void
  flashNodeId?: string | null
  electronScene?: THREE.Scene
}

export interface Graph3DHandle {
  flyTo: (nodeId: string) => void
  resetCamera: () => void
  reheat: () => void
  getScene: () => THREE.Scene | null
  getCamera: () => THREE.PerspectiveCamera | null
}

const NODE_RADIUS = 4
const NODE_SEGMENTS = 8

function createLabelSprite(text: string): THREE.Sprite {
  const W = 256, H = 48
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const label = text.length > 22 ? text.slice(0, 20) + '…' : text
  ctx.font = '14px "Courier New", monospace'
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

export const Graph3D = forwardRef<Graph3DHandle, Graph3DProps>(({
  graphData,
  positions,
  selectedNodeId,
  hoveredNodeId,
  searchResults,
  timeFilterIds,
  tagIsolationIds,
  visibleNodes,
  nodeOpacity,
  bloomEnabled,
  starsEnabled,
  labelsEnabled,
  nodeDegrees,
  minNodeSize,
  maxNodeSize,
  onNodeClick,
  onNodeDoubleClick,
  onNodeHover,
  onNodeRightClick,
  flashNodeId,
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
  const nodeIndexMapRef = useRef<Map<string, number>>(new Map())
  const starsRef = useRef<THREE.Points | null>(null)
  const labelsMapRef = useRef<Map<string, THREE.Sprite>>(new Map())
  const annotLineRef = useRef<THREE.Line | null>(null)
  const frameRef = useRef<number>(0)
  const lastClickTimeRef = useRef<number>(0)
  const lastClickNodeRef = useRef<string | null>(null)
  const positionsRef = useRef<Map<string, NodePosition>>(new Map())
  const projRef = useRef(new THREE.Vector3())
  const proximityNodeRef = useRef<GraphNode | null>(null)
  const mouseDownPosRef = useRef({ x: 0, y: 0 })
  const [, forceUpdate] = useState(0)

  // Keep positionsRef in sync for proximity detection
  useEffect(() => {
    positionsRef.current = positions
  }, [positions])

  // Build scene once
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    renderer.setClearColor(0x000000, 1)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 10000)
    camera.position.set(0, 0, 600)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.zoomSpeed = 1.2
    controls.zoomToCursor = true
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

    // Stars — 200 fixed points in world space, default OFF
    const starGeo = new THREE.BufferGeometry()
    const starPositions = new Float32Array(200 * 3)
    for (let i = 0; i < 200; i++) {
      starPositions[i * 3]     = (Math.random() - 0.5) * 4000
      starPositions[i * 3 + 1] = (Math.random() - 0.5) * 4000
      starPositions[i * 3 + 2] = (Math.random() - 0.5) * 4000
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: true, transparent: true, opacity: 0.45 })
    const stars = new THREE.Points(starGeo, starMat)
    stars.visible = false
    scene.add(stars)
    starsRef.current = stars

    // Annotation line: cursor → closest proximity node (solid cyan, drawn on top)
    const annotGeo = new THREE.BufferGeometry()
    annotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    const annotMat = new THREE.LineBasicMaterial({ color: 0x00d4ff, depthTest: false })
    const annotLine = new THREE.Line(annotGeo, annotMat)
    annotLine.visible = false
    annotLine.renderOrder = 999
    scene.add(annotLine)
    annotLineRef.current = annotLine

    // Resize handler
    const onResize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      composer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(frameRef.current)
      renderer.dispose()
    }
  }, [])

  // Toggle stars visibility
  useEffect(() => {
    if (starsRef.current) starsRef.current.visible = starsEnabled
  }, [starsEnabled])

  // Update bloom
  useEffect(() => {
    if (bloomPassRef.current) {
      bloomPassRef.current.strength = bloomEnabled ? 1.5 : 0
    }
  }, [bloomEnabled])

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

    // LineSegments for links
    const linkPositions = new Float32Array(graphData.links.length * 6)
    const linkGeo = new THREE.BufferGeometry()
    linkGeo.setAttribute('position', new THREE.BufferAttribute(linkPositions, 3))
    const linkMat = new THREE.LineBasicMaterial({ color: 0x1a3a4a, transparent: true, opacity: 0.5 })
    const lines = new THREE.LineSegments(linkGeo, linkMat)
    lines.frustumCulled = false
    scene.add(lines)
    lineSegmentsRef.current = lines

    forceUpdate(x => x + 1)
  }, [graphData, nodeOpacity])

  // Build label sprites for hub nodes (separate effect, depends on degrees)
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !graphData || nodeDegrees.size === 0) return

    // Clean up old sprites
    for (const sprite of labelsMapRef.current.values()) {
      scene.remove(sprite)
      ;(sprite.material as THREE.SpriteMaterial).map?.dispose()
      sprite.material.dispose()
    }
    labelsMapRef.current.clear()

    // Threshold: degree >= 3 OR top 20%, whichever is higher
    let maxDeg = 1
    for (const [, d] of nodeDegrees) if (d > maxDeg) maxDeg = d
    const threshold = Math.max(3, Math.ceil(maxDeg * 0.2))

    graphData.nodes.forEach(node => {
      const degree = nodeDegrees.get(node.id) ?? 0
      if (degree < threshold) return
      const sprite = createLabelSprite(node.label)
      sprite.visible = false
      scene.add(sprite)
      labelsMapRef.current.set(node.id, sprite)
    })
  }, [graphData, nodeDegrees])

  // Update positions each frame from simulation
  useEffect(() => {
    const mesh = instancedMeshRef.current
    const lines = lineSegmentsRef.current
    if (!mesh || !lines || positions.size === 0 || !graphData) return

    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    const nodes = graphData.nodes

    // Compute max degree for size scaling
    let maxDegree = 1
    for (const [, deg] of nodeDegrees) {
      if (deg > maxDegree) maxDegree = deg
    }

    nodes.forEach((node, i) => {
      const pos = positions.get(node.id)
      if (!pos) return

      // Visibility: respect time filter, collapse state, and tag isolation
      const inTimeFilter = !timeFilterIds || timeFilterIds.has(node.id)
      const inSearch = !searchResults || searchResults.includes(node.id)
      const isVisible = visibleNodes.has(node.id)
      const inTagIsolation = !tagIsolationIds || tagIsolationIds.has(node.id)
      const visible = inTimeFilter && isVisible && inTagIsolation

      // Size by degree (linear interpolation)
      const degree = nodeDegrees.get(node.id) ?? 0
      const t = maxDegree > 1 ? degree / maxDegree : 0
      const sizeMultiplier = minNodeSize + (maxNodeSize - minNodeSize) * t
      const scale = visible ? sizeMultiplier : 0

      dummy.position.set(pos.x, pos.y, pos.z)
      dummy.scale.set(scale, scale, scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)

      // Color
      let baseColor: number
      if (node.id === selectedNodeId) {
        baseColor = 0xffffff
      } else if (node.id === flashNodeId) {
        baseColor = 0xffffff
      } else {
        baseColor = getNodeColor(node.type, node.folder)
      }

      const opacity = !inSearch && searchResults !== null
        ? 0.1
        : (visible ? nodeOpacity : 0)

      color.set(baseColor).multiplyScalar(opacity > 0 ? 1 : 0)
      if (node.id === hoveredNodeId) color.set(baseColor).multiplyScalar(1.5)
      mesh.setColorAt(i, color)
    })

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

    // Update link positions
    const posArray = (lines.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
    graphData.links.forEach((link, i) => {
      const srcId = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id
      const dstId = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id
      const src = positions.get(srcId)
      const dst = positions.get(dstId)

      const srcVisible = visibleNodes.has(srcId) && (!timeFilterIds || timeFilterIds.has(srcId)) && (!tagIsolationIds || tagIsolationIds.has(srcId))
      const dstVisible = visibleNodes.has(dstId) && (!timeFilterIds || timeFilterIds.has(dstId)) && (!tagIsolationIds || tagIsolationIds.has(dstId))
      const linkVisible = srcVisible && dstVisible

      if (src && dst && linkVisible) {
        posArray[i * 6] = src.x; posArray[i * 6 + 1] = src.y; posArray[i * 6 + 2] = src.z
        posArray[i * 6 + 3] = dst.x; posArray[i * 6 + 4] = dst.y; posArray[i * 6 + 5] = dst.z
      } else {
        for (let k = 0; k < 6; k++) posArray[i * 6 + k] = 0
      }
    });
    (lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true

    ;(lines.material as THREE.LineBasicMaterial).opacity = nodeOpacity * 0.6

    // Update label sprite positions and visibility
    for (const [nodeId, sprite] of labelsMapRef.current) {
      const pos = positions.get(nodeId)
      if (!pos) continue
      sprite.position.set(pos.x, pos.y + NODE_RADIUS * 3, pos.z)
      const inTagIso = !tagIsolationIds || tagIsolationIds.has(nodeId)
      const inTimeF = !timeFilterIds || timeFilterIds.has(nodeId)
      sprite.visible = labelsEnabled && inTimeF && visibleNodes.has(nodeId) && inTagIso
    }

  }, [positions, graphData, selectedNodeId, hoveredNodeId, searchResults, timeFilterIds, tagIsolationIds, visibleNodes, nodeOpacity, flashNodeId, nodeDegrees, minNodeSize, maxNodeSize, labelsEnabled])

  // Animate loop
  useEffect(() => {
    const composer = composerRef.current
    const controls = controlsRef.current
    if (!composer || !controls) return

    let animId: number
    const localControls = controls
    const localComposer = composer
    function loop() {
      animId = requestAnimationFrame(loop)
      localControls.update()
      localComposer.render()
    }
    animId = requestAnimationFrame(loop)
    frameRef.current = animId
    return () => cancelAnimationFrame(animId)
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
    return { node, index: instanceId }
  }, [graphData, visibleNodes])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
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
  }, [getHitNode, onNodeHover, graphData, visibleNodes])

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
    e.preventDefault()
    const hit = getHitNode(e)
    if (hit) onNodeRightClick(hit.node)
  }, [getHitNode, onNodeRightClick])

  // flyTo handler
  const flyTo = useCallback((nodeId: string) => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    const pos = positions.get(nodeId)
    if (!camera || !controls || !pos) return

    const target = new THREE.Vector3(pos.x, pos.y, pos.z)
    const startPos = camera.position.clone()
    const startTarget = controls.target.clone()
    const endPos = new THREE.Vector3(pos.x, pos.y, pos.z + 160)

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

    const endTarget = new THREE.Vector3()
    let dist = 600
    if (pts.length > 0) {
      const box = new THREE.Box3().setFromPoints(pts)
      const sphere = new THREE.Sphere()
      box.getBoundingSphere(sphere)
      endTarget.copy(sphere.center)
      const fov = camera.fov * Math.PI / 180
      dist = (sphere.radius * 1.1) / Math.tan(fov / 2)
    }
    const endPos = new THREE.Vector3(endTarget.x, endTarget.y, endTarget.z + dist)

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
  }, [])

  useImperativeHandle(ref, () => ({
    flyTo,
    resetCamera,
    reheat: () => {},
    getScene: () => sceneRef.current,
    getCamera: () => cameraRef.current,
  }), [flyTo, resetCamera])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
      onMouseDown={e => { mouseDownPosRef.current = { x: e.clientX, y: e.clientY } }}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseLeave={() => {
        proximityNodeRef.current = null
        if (annotLineRef.current) annotLineRef.current.visible = false
        onNodeHover(null, 0, 0)
      }}
    />
  )
})

Graph3D.displayName = 'Graph3D'
