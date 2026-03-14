// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

import { useState } from 'react'
import type { GraphNode } from '../hooks/useVaultGraph'

interface FavouritesPaneProps {
  favourites: Set<string>
  allNodes: GraphNode[]
  sidebarWidth: number
  onNavigate: (nodeId: string) => void
  onRemove: (nodeId: string) => void
}

export function FavouritesPane({ favourites, allNodes, sidebarWidth, onNavigate, onRemove }: FavouritesPaneProps) {
  const [open, setOpen] = useState(false)

  const favouriteNodes = allNodes.filter(n => favourites.has(n.id))

  const PANE_WIDTH = 200

  return (
    <>
      {/* Toggle tab attached to the left edge of the sidebar */}
      <div
        onClick={() => setOpen(v => !v)}
        title={open ? 'Close favourites' : 'Open favourites'}
        style={{
          position: 'fixed',
          top: 80,
          right: sidebarWidth,
          zIndex: 199,
          background: open ? '#1a2a3a' : 'rgba(0,30,50,0.90)',
          border: '1px solid #00d4ff44',
          borderRight: 'none',
          borderRadius: '4px 0 0 4px',
          padding: '8px 7px',
          cursor: 'pointer',
          fontFamily: '"Courier New", monospace',
          fontSize: 11,
          color: '#00d4ff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          userSelect: 'none',
          transition: 'background 0.2s, box-shadow 0.2s',
          writingMode: 'vertical-rl',
          letterSpacing: '0.07em',
          boxShadow: open ? 'inset 0 0 8px #00d4ff22' : '0 0 6px #00d4ff22',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1a2a3a'; (e.currentTarget as HTMLElement).style.boxShadow = '0 0 10px #00d4ff33' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = open ? '#1a2a3a' : 'rgba(0,30,50,0.90)'; (e.currentTarget as HTMLElement).style.boxShadow = open ? 'inset 0 0 8px #00d4ff22' : '0 0 6px #00d4ff22' }}
      >
        ★ FAV{favouriteNodes.length > 0 ? ` (${favouriteNodes.length})` : ''}
      </div>

      {/* Favourites pane */}
      <div style={{
        position: 'fixed',
        top: 0,
        right: sidebarWidth,
        width: PANE_WIDTH,
        height: '100%',
        background: '#1a1a2e',
        borderLeft: '1px solid #313244',
        zIndex: 198,
        transform: open ? 'translateX(0)' : `translateX(${PANE_WIDTH}px)`,
        transition: 'transform 0.25s ease',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '"Courier New", monospace',
        overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 12px 10px',
          borderBottom: '1px solid #313244',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          background: '#1a1a2e',
          zIndex: 1,
        }}>
          <span style={{ color: '#00d4ff', fontSize: 11, letterSpacing: '0.1em', fontWeight: 600 }}>
            ♥ FAVOURITES
          </span>
          <span
            onClick={() => setOpen(false)}
            style={{ color: '#585b70', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
            title="Close"
          >✕</span>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {favouriteNodes.length === 0 ? (
            <div style={{ padding: '20px 12px', color: '#585b70', fontSize: 11, lineHeight: 1.6 }}>
              No favourites yet.<br />
              Select a note and press <span style={{ color: '#00a8cc' }}>F</span> to add.
            </div>
          ) : (
            favouriteNodes.map(node => {
              const folderName = node.folder.split('/').pop() || node.folder
              return (
                <div
                  key={node.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    cursor: 'pointer',
                    borderBottom: '1px solid #181825',
                    gap: 4,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,212,255,0.06)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <div
                    style={{ flex: 1, minWidth: 0 }}
                    onClick={() => onNavigate(node.id)}
                  >
                    <div style={{
                      color: '#e0e0e0',
                      fontSize: 12,
                      fontFamily: '"Inter", "Segoe UI", sans-serif',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.4,
                    }}>
                      {node.label}
                    </div>
                    {folderName && (
                      <div style={{
                        color: '#585b70',
                        fontSize: 10,
                        fontFamily: '"Inter", "Segoe UI", sans-serif',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginTop: 2,
                      }}>
                        {folderName}
                      </div>
                    )}
                  </div>
                  <span
                    onClick={e => { e.stopPropagation(); onRemove(node.id) }}
                    title="Remove from favourites"
                    style={{
                      color: '#585b70',
                      cursor: 'pointer',
                      fontSize: 13,
                      lineHeight: 1,
                      flexShrink: 0,
                      padding: '2px 2px',
                      marginTop: 1,
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ff6b6b' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#585b70' }}
                  >♥</span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
