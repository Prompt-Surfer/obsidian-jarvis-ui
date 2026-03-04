import { useEffect, useRef, useState, useCallback } from 'react'
import type { GraphNode } from '../hooks/useVaultGraph'

interface SearchBarProps {
  visible: boolean
  allNodes: GraphNode[]
  allTags: string[]
  onResults: (results: string[] | null) => void
  onNavigate: (nodeId: string) => void
  onClose: () => void
  onTagIsolate?: (ids: Set<string>, tags: string[]) => void
}

export function SearchBar({ visible, allNodes, allTags, onResults, onNavigate, onClose, onTagIsolate }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GraphNode[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQuery('')
      setResults([])
      onResults(null)
    }
  }, [visible, onResults])

  const search = useCallback((q: string) => {
    if (!q.trim()) {
      onResults(null)
      setResults([])
      setTagSuggestions([])
      return
    }

    const terms = q.toLowerCase().split(/\s+/)
    const tagTerms = terms.filter(t => t.startsWith('#')).map(t => t.slice(1))
    const textTerms = terms.filter(t => !t.startsWith('#'))

    // Tag autocomplete
    if (q.endsWith('#') || (q.includes('#') && !q.endsWith(' '))) {
      const lastTag = q.split('#').pop() || ''
      const suggestions = allTags
        .filter(t => t.toLowerCase().startsWith(lastTag.toLowerCase()))
        .slice(0, 8)
      setTagSuggestions(suggestions)
    } else {
      setTagSuggestions([])
    }

    const matched = allNodes.filter(node => {
      // Tag filter (AND logic)
      if (tagTerms.length > 0) {
        const nodeTags = node.tags.map(t => t.toLowerCase())
        if (!tagTerms.every(tt => nodeTags.some(nt => nt.includes(tt)))) return false
      }

      // Text filter
      if (textTerms.length > 0) {
        const searchText = `${node.label} ${node.excerpt} ${node.id}`.toLowerCase()
        if (!textTerms.every(t => searchText.includes(t))) return false
      }

      return true
    }).slice(0, 20)

    setResults(matched)
    setSelectedIdx(0)
    onResults(matched.map(n => n.id))
  }, [allNodes, allTags, onResults])

  useEffect(() => {
    search(query)
  }, [query, search])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setQuery('')
      onResults(null)
      inputRef.current?.blur()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      // Tag-only query → isolate matching nodes (no navigation)
      const terms = query.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0)
      const isTagOnly = terms.length > 0 && terms.every(t => t.startsWith('#'))
      if (isTagOnly && onTagIsolate) {
        const tagTerms = terms.map(t => t.slice(1))
        const matchedIds = new Set(
          allNodes
            .filter(n => {
              const nodeTags = n.tags.map(t => t.toLowerCase())
              return tagTerms.every(tt => nodeTags.some(nt => nt.includes(tt)))
            })
            .map(n => n.id)
        )
        onTagIsolate(matchedIds, tagTerms)
        onClose()
      } else if (results.length > 0) {
        onNavigate(results[selectedIdx].id)
      }
    }
  }

  return (
    <div style={{
      position: 'fixed',
      top: 20,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 300,
      width: 480,
    }}>
      <div style={{
        background: 'rgba(0,0,0,0.92)',
        border: '1px solid #00d4ff',
        borderRadius: 6,
        boxShadow: '0 0 20px #00d4ff33',
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px' }}>
          <span style={{ color: '#00d4ff', fontSize: 16, marginRight: 8 }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search notes... or #tag"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#cdd6f4',
              fontFamily: '"Courier New", monospace',
              fontSize: 14,
              padding: '12px 0',
            }}
          />
          {query && (
            <span
              style={{ color: '#585b70', cursor: 'pointer', fontSize: 12 }}
              onClick={onClose}
            >ESC</span>
          )}
        </div>

        {tagSuggestions.length > 0 && (
          <div style={{ borderTop: '1px solid #313244', padding: '4px 8px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tagSuggestions.map(tag => (
              <span
                key={tag}
                style={{
                  background: '#1a2a1a',
                  color: '#a6e3a1',
                  border: '1px solid #a6e3a133',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
                onClick={() => {
                  const parts = query.split('#')
                  parts[parts.length - 1] = tag + ' '
                  setQuery(parts.join('#'))
                  inputRef.current?.focus()
                }}
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Tag filter row: shown when query is a pure #tag search */}
        {query.trim().startsWith('#') && onTagIsolate && (() => {
          const terms = query.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0)
          const tagTerms = terms.filter(t => t.startsWith('#')).map(t => t.slice(1))
          const textTerms = terms.filter(t => !t.startsWith('#'))
          if (tagTerms.length === 0 || textTerms.length > 0) return null
          return (
            <div
              onClick={() => {
                const matchedIds = new Set(
                  allNodes.filter(n => {
                    const nodeTags = n.tags.map(t => t.toLowerCase())
                    return tagTerms.every(tt => nodeTags.some(nt => nt.includes(tt)))
                  }).map(n => n.id)
                )
                onTagIsolate(matchedIds, tagTerms)
                onClose()
              }}
              style={{
                padding: '8px 16px',
                cursor: 'pointer',
                background: '#0f1a0f',
                borderTop: '1px solid #313244',
                borderLeft: '2px solid #a6e3a1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ color: '#a6e3a1', fontSize: 13 }}>
                # Filter: {tagTerms.map(t => `#${t}`).join(' ')}
              </span>
              <span style={{ color: '#585b70', fontSize: 11 }}>Enter ↵</span>
            </div>
          )
        })()}

        {results.length > 0 && (
          <div style={{ borderTop: '1px solid #313244', maxHeight: 280, overflowY: 'auto' }}>
            {results.map((node, i) => (
              <div
                key={node.id}
                onClick={() => onNavigate(node.id)}
                style={{
                  padding: '8px 16px',
                  cursor: 'pointer',
                  background: i === selectedIdx ? '#00d4ff15' : 'transparent',
                  borderLeft: i === selectedIdx ? '2px solid #00d4ff' : '2px solid transparent',
                  transition: 'background 0.1s',
                }}
              >
                <div style={{ color: i === selectedIdx ? '#00d4ff' : '#cdd6f4', fontSize: 13 }}>
                  {node.label}
                </div>
                {node.tags.length > 0 && (
                  <div style={{ color: '#a6e3a1', fontSize: 11, marginTop: 2 }}>
                    {node.tags.slice(0, 3).map(t => `#${t}`).join(' ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {query && results.length === 0 && (
          <div style={{ padding: '12px 16px', color: '#585b70', fontSize: 13, borderTop: '1px solid #313244' }}>
            No results
          </div>
        )}
      </div>
    </div>
  )
}
