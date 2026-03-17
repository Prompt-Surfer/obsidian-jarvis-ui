// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

import type { BuildProgress } from '../hooks/useVaultGraph'

interface Props {
  progress: BuildProgress | null
}

export function GraphBuildProgress({ progress }: Props) {
  const hasTotal = progress !== null && progress.totalFiles > 0
  const pct = hasTotal ? Math.min(100, Math.round((progress.processedFiles / progress.totalFiles) * 100)) : 0

  // Phase label
  let phaseLabel: string
  if (progress === null) {
    phaseLabel = 'Connecting to server...'
  } else if (progress.totalFiles === 0) {
    phaseLabel = 'Scanning vault...'
  } else {
    phaseLabel = `${progress.processedFiles.toLocaleString()} / ${progress.totalFiles.toLocaleString()} notes`
  }

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: '#000',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"Courier New", monospace',
      color: '#00d4ff',
      userSelect: 'none',
    }}>
      {/* Logo / title */}
      <div style={{
        fontSize: 11,
        letterSpacing: '0.3em',
        color: '#1a4a5a',
        marginBottom: 32,
        textTransform: 'uppercase',
      }}>
        JARVIS // VAULT GRAPH
      </div>

      {/* Main status label */}
      <div style={{
        fontSize: 13,
        letterSpacing: '0.12em',
        color: '#00a8cc',
        marginBottom: 20,
      }}>
        ◌ BUILDING GRAPH...
      </div>

      {/* Progress bar container */}
      <div style={{
        width: 320,
        height: 3,
        background: '#0a1a22',
        borderRadius: 2,
        overflow: 'hidden',
        position: 'relative',
        marginBottom: 14,
        boxShadow: '0 0 6px #00d4ff11',
      }}>
        {hasTotal ? (
          // Determinate bar
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${pct}%`,
            background: 'linear-gradient(90deg, #006688, #00d4ff)',
            borderRadius: 2,
            transition: 'width 0.3s ease-out',
            boxShadow: '0 0 8px #00d4ff88',
          }} />
        ) : (
          // Indeterminate scanning animation
          <div style={{
            position: 'absolute',
            top: 0,
            height: '100%',
            width: 80,
            background: 'linear-gradient(90deg, transparent, #00d4ff, transparent)',
            animation: 'jarvisScan 1.4s ease-in-out infinite',
          }} />
        )}
      </div>

      {/* Phase label */}
      <div style={{
        fontSize: 11,
        color: '#3a6a7a',
        letterSpacing: '0.08em',
        minWidth: 240,
        textAlign: 'center',
      }}>
        {phaseLabel}
      </div>

      {/* Percentage (only when we have file counts) */}
      {hasTotal && (
        <div style={{
          marginTop: 8,
          fontSize: 10,
          color: '#1a4a5a',
          letterSpacing: '0.05em',
        }}>
          {pct}%
        </div>
      )}

      {/* CSS keyframes via style tag */}
      <style>{`
        @keyframes jarvisScan {
          0%   { left: -80px; }
          100% { left: 320px; }
        }
      `}</style>
    </div>
  )
}
