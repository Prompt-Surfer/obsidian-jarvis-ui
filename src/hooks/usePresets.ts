// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

import { useState, useCallback } from 'react'

export interface PresetSettings {
  bloomEnabled: boolean
  nodeOpacity: number
  starsEnabled: boolean
  labelsEnabled: boolean
  linksEnabled: boolean
  spread: number
  minNodeSize: number
  maxNodeSize: number
  ultraNodeSize: number
  zoomToNode: boolean
  graphShape: 'sun' | 'saturn' | 'milkyway' | 'brain' | 'natural' | 'tagboxes'
  tagBoxTopN: number
  tagBoxSizeScale: number
}

export interface PresetCamera {
  position: [number, number, number]
  target: [number, number, number]
}

export interface PresetFilters {
  tagIsolationTags: string[]
  timeRange: string | null // e.g. '1D','1W','1M','1Y','ALL' or null
  searchQuery: string | null
}

export interface Preset {
  id: string
  name: string
  createdAt: number
  settings: PresetSettings
  camera: PresetCamera | null
  favourites: string[]
  filters: PresetFilters
}

interface PresetsStore {
  presets: Preset[]
}

const STORAGE_KEY = 'jarvis-presets'
const MAX_PRESETS = 20

function loadStore(): PresetsStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.presets)) return parsed
    }
  } catch { /* corrupted data */ }
  return { presets: [] }
}

function saveStore(store: PresetsStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch { /* storage full */ }
}

export function usePresets() {
  const [presets, setPresets] = useState<Preset[]>(() => loadStore().presets)

  const save = useCallback((
    name: string,
    settings: PresetSettings,
    camera: PresetCamera | null,
    favourites: string[],
    filters: PresetFilters,
  ): { ok: boolean; warning?: string } => {
    const store = loadStore()
    if (store.presets.length >= MAX_PRESETS) {
      return { ok: false, warning: `Maximum ${MAX_PRESETS} presets reached. Delete one first.` }
    }

    const preset: Preset = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name.trim(),
      createdAt: Date.now(),
      settings,
      camera,
      favourites,
      filters,
    }

    store.presets.push(preset)
    saveStore(store)
    setPresets([...store.presets])

    const warning = store.presets.length >= MAX_PRESETS - 2
      ? `${store.presets.length}/${MAX_PRESETS} presets used`
      : undefined

    return { ok: true, warning }
  }, [])

  const remove = useCallback((id: string) => {
    const store = loadStore()
    store.presets = store.presets.filter(p => p.id !== id)
    saveStore(store)
    setPresets([...store.presets])
  }, [])

  const load = useCallback((id: string): Preset | null => {
    const store = loadStore()
    return store.presets.find(p => p.id === id) ?? null
  }, [])

  return { presets, save, remove, load }
}
