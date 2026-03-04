import { useRef, useCallback } from 'react'
import * as THREE from 'three'
import { bfsPath } from '../lib/bfs'
import type { GraphLink } from './useVaultGraph'
import type { NodePosition } from './useForce3D'

interface ElectronOptions {
  positions: Map<string, NodePosition>
  links: GraphLink[]
  scene: THREE.Scene
  onArrival: (nodeId: string) => void
  onNodeFlash?: (nodeId: string) => void
}

export function useElectron() {
  const animationRef = useRef<number | null>(null)
  const particleRef = useRef<THREE.Mesh | null>(null)

  const animate = useCallback((
    fromId: string,
    toId: string,
    options: ElectronOptions
  ) => {
    const { positions, links, scene, onArrival, onNodeFlash } = options

    // Cancel any in-progress animation
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current)
    }
    if (particleRef.current) {
      scene.remove(particleRef.current)
      particleRef.current = null
    }

    const path = bfsPath(fromId, toId, links as { source: string; target: string }[])

    if (!path || path.length < 2) {
      // No path — fly directly
      onArrival(toId)
      return
    }

    // Create electron particle
    const geo = new THREE.SphereGeometry(2.5, 8, 8)
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const particle = new THREE.Mesh(geo, mat)
    scene.add(particle)
    particleRef.current = particle

    const EDGE_DURATION = 400 // ms per hop

    let edgeIdx = 0
    let edgeStart = performance.now()

    function step(now: number) {
      if (!particleRef.current) return

      const elapsed = now - edgeStart
      const t = Math.min(elapsed / EDGE_DURATION, 1)

      const srcId = path![edgeIdx]
      const dstId = path![edgeIdx + 1]

      const srcPos = positions.get(srcId)
      const dstPos = positions.get(dstId)

      if (srcPos && dstPos) {
        particle.position.lerpVectors(
          new THREE.Vector3(srcPos.x, srcPos.y, srcPos.z),
          new THREE.Vector3(dstPos.x, dstPos.y, dstPos.z),
          t
        )
      }

      if (t >= 1) {
        edgeIdx++
        edgeStart = now

        // Flash intermediate node
        if (edgeIdx < path!.length - 1) {
          onNodeFlash?.(path![edgeIdx])
        }

        if (edgeIdx >= path!.length - 1) {
          // Done
          scene.remove(particle)
          particleRef.current = null
          onArrival(toId)
          return
        }
      }

      animationRef.current = requestAnimationFrame(step)
    }

    animationRef.current = requestAnimationFrame(step)
  }, [])

  const cancel = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
  }, [])

  return { animate, cancel }
}
