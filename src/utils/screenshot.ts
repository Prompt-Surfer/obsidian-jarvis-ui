// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

import html2canvas from 'html2canvas'

export async function captureToClipboard(): Promise<void> {
  try {
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#000000',
      scale: window.devicePixelRatio || 1,
    })
    canvas.toBlob(async (blob) => {
      if (!blob) throw new Error('Failed to capture canvas')
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ])
    }, 'image/png')
  } catch {
    throw new Error('clipboard_failed')
  }
}
