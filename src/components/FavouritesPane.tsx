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
          background: open ? '#1e1e2e' : 'rgba(0,0,0,0.85)',
          border: '1px solid #313244',
          borderRight: 'none',
          borderRadius: '4px 0 0 4px',
          padding: '6px 8px',
          cursor: 'pointer',
          fontFamily: '"Courier New", monospace',
          fontSize: 11,
          color: favouriteNodes.length > 0 ? '#00d4ff' : '#585b70',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 3,
          userSelect: 'none',
          transition: 'color 0.2s, background 0.2s',
          writingMode: 'vertical-rl',
          letterSpacing: '0.05em',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#00d4ff' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = favouriteNodes.length > 0 ? '#00d4ff' : '#585b70' }}
      >
        {favouriteNodes.length > 0 ? '♥' : '☆'} FAV {favouriteNodes.length > 0 ? `(${favouriteNodes.length})` : ''}
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
