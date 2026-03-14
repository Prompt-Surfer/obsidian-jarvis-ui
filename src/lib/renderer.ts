// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

import * as THREE from 'three'

export async function createRenderer(canvas: HTMLCanvasElement): Promise<THREE.WebGLRenderer> {
  // Use WebGLRenderer — WebGPU support in Three.js requires a separate build/addon
  // that isn't available in the standard npm package yet for stable use.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(canvas.clientWidth, canvas.clientHeight)
  renderer.setClearColor(0x000000, 1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.2
  console.log('[Jarvis] Using WebGL renderer')
  return renderer
}
