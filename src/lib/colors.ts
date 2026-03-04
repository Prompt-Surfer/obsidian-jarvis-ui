// Node type → hex color
export const NODE_COLORS = {
  drop: 0x00d4ff,    // cyan
  memory: 0xff6b35,  // orange
  note: 0x7c8dfa,    // blue-purple (default)
  tag: 0xa6e3a1,     // green
} as const

export const LINK_COLOR = 0x1a3a4a
export const LINK_HOVER_COLOR = 0x00d4ff
export const SELECTED_COLOR = 0xffffff

// Deterministic color from folder name (hash → hue)
export function folderColor(folderName: string): number {
  if (!folderName) return NODE_COLORS.note
  let hash = 0
  for (let i = 0; i < folderName.length; i++) {
    hash = folderName.charCodeAt(i) + ((hash << 5) - hash)
    hash |= 0
  }
  const hue = Math.abs(hash) % 360
  return hslToHex(hue, 0.65, 0.65)
}

function hslToHex(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
  }
  const r = Math.round(f(0) * 255)
  const g = Math.round(f(8) * 255)
  const b = Math.round(f(4) * 255)
  return (r << 16) | (g << 8) | b
}

export function getNodeColor(type: string, folder: string): number {
  if (type === 'drop') return NODE_COLORS.drop
  if (type === 'memory') return NODE_COLORS.memory
  if (type === 'tag') return NODE_COLORS.tag
  // folder-based color for regular notes
  if (folder) return folderColor(folder)
  return NODE_COLORS.note
}
