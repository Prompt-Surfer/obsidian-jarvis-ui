import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { GraphNode } from '../hooks/useVaultGraph'

interface SidebarProps {
  node: GraphNode | null
  fullView: boolean
  allNodes: GraphNode[]
  onClose: () => void
  onNavigate: (nodeId: string) => void
}

const STYLES = {
  sidebar: {
    position: 'fixed' as const,
    top: 0,
    right: 0,
    width: 380,
    height: '100%',
    background: '#1e1e2e',
    borderLeft: '1px solid #313244',
    color: '#cdd6f4',
    fontFamily: '"Inter", sans-serif',
    fontSize: 14,
    overflowY: 'auto' as const,
    zIndex: 200,
    transition: 'transform 0.25s ease',
    padding: 0,
  },
  header: {
    padding: '20px 20px 12px',
    borderBottom: '1px solid #313244',
    position: 'sticky' as const,
    top: 0,
    background: '#1e1e2e',
    zIndex: 1,
  },
  title: {
    color: '#89b4fa',
    fontSize: 17,
    fontWeight: 600,
    margin: 0,
    lineHeight: 1.4,
  },
  closeBtn: {
    position: 'absolute' as const,
    top: 16,
    right: 16,
    background: 'none',
    border: 'none',
    color: '#585b70',
    cursor: 'pointer',
    fontSize: 18,
    padding: '4px 8px',
    borderRadius: 4,
    lineHeight: 1,
  },
  section: {
    padding: '12px 20px',
    borderBottom: '1px solid #181825',
  },
  label: {
    color: '#585b70',
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    marginBottom: 6,
  },
  tag: {
    display: 'inline-block',
    background: '#313244',
    color: '#a6e3a1',
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 12,
    marginRight: 4,
    marginBottom: 4,
    cursor: 'pointer',
  },
  backlink: {
    display: 'block',
    color: '#89dceb',
    cursor: 'pointer',
    padding: '3px 0',
    fontSize: 13,
    textDecoration: 'none',
  },
  markdownContent: {
    padding: '16px 20px',
    lineHeight: 1.7,
    fontSize: 14,
  },
}

// Custom wikilink renderer
function renderMarkdown(content: string, allNodes: GraphNode[], onNavigate: (id: string) => void) {
  // Replace [[wikilinks]] with custom spans before passing to react-markdown
  const processed = content.replace(
    /\[\[([^\]|#]+?)(?:\|([^\]]+))?\]\]/g,
    (_match, target, alias) => {
      const display = alias || target
      const id = target.toLowerCase().replace(/\s+/g, '-')
      return `[${display}](jarvis://node/${id})`
    }
  )

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        a: ({ href, children, ...props }: any) => {
          if (href?.startsWith('jarvis://node/')) {
            const nodeId = href.slice('jarvis://node/'.length)
            return (
              <span
                onClick={() => onNavigate(nodeId)}
                style={{ color: '#89dceb', cursor: 'pointer', textDecoration: 'underline' }}
                {...props}
              >
                {children}
              </span>
            )
          }
          return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#89dceb' }} {...props}>{children}</a>
        },
        code: ({ children, className, ...props }) => {
          const isBlock = className?.startsWith('language-')
          return isBlock ? (
            <code style={{ background: '#313244', padding: '12px', display: 'block', borderRadius: 6, fontSize: 13, overflowX: 'auto' }} className={className} {...props}>{children}</code>
          ) : (
            <code style={{ background: '#313244', padding: '2px 5px', borderRadius: 3, fontSize: 13 }} {...props}>{children}</code>
          )
        },
        h1: ({ children, ...props }) => <h1 style={{ color: '#89b4fa', fontSize: 20, marginBottom: 8 }} {...props}>{children}</h1>,
        h2: ({ children, ...props }) => <h2 style={{ color: '#89b4fa', fontSize: 17, marginBottom: 6 }} {...props}>{children}</h2>,
        h3: ({ children, ...props }) => <h3 style={{ color: '#89b4fa', fontSize: 15, marginBottom: 4 }} {...props}>{children}</h3>,
        p: ({ children, ...props }) => <p style={{ marginBottom: 10 }} {...props}>{children}</p>,
        ul: ({ children, ...props }) => <ul style={{ paddingLeft: 20, marginBottom: 8 }} {...props}>{children}</ul>,
        ol: ({ children, ...props }) => <ol style={{ paddingLeft: 20, marginBottom: 8 }} {...props}>{children}</ol>,
        li: ({ children, ...props }) => <li style={{ marginBottom: 3 }} {...props}>{children}</li>,
        blockquote: ({ children, ...props }) => (
          <blockquote style={{ borderLeft: '3px solid #585b70', paddingLeft: 12, color: '#9399b2', margin: '8px 0' }} {...props}>{children}</blockquote>
        ),
      }}
    >
      {processed}
    </ReactMarkdown>
  )
}

export function Sidebar({ node, fullView, allNodes, onClose, onNavigate }: SidebarProps) {
  const [markdownContent, setMarkdownContent] = useState<string | null>(null)
  const [loadingMd, setLoadingMd] = useState(false)

  useEffect(() => {
    if (!node || !fullView) {
      setMarkdownContent(null)
      return
    }
    setLoadingMd(true)
    fetch(`/api/note?path=${encodeURIComponent(node.path)}`)
      .then(r => r.json())
      .then(d => { setMarkdownContent(d.content); setLoadingMd(false) })
      .catch(() => setLoadingMd(false))
  }, [node, fullView])

  // Find backlinks
  const backlinks = node
    ? allNodes.filter(n => n.links.some(l => {
        const targetId = l.toLowerCase().replace(/\s+/g, '-')
        return targetId === node.id || node.id.endsWith('/' + targetId)
      }))
    : []

  const visible = !!node

  return (
    <div style={{
      ...STYLES.sidebar,
      transform: visible ? 'translateX(0)' : 'translateX(100%)',
    }}>
      {node && (
        <>
          <div style={STYLES.header}>
            <h2 style={STYLES.title}>{node.label}</h2>
            <button
              style={STYLES.closeBtn}
              onClick={onClose}
              title="Close (Escape)"
            >✕</button>
            <div style={{ color: '#585b70', fontSize: 11, marginTop: 6 }}>
              {node.type.toUpperCase()} · {node.path}
            </div>
          </div>

          {node.tags.length > 0 && (
            <div style={STYLES.section}>
              <div style={STYLES.label}>Tags</div>
              {node.tags.map(tag => (
                <span key={tag} style={STYLES.tag} onClick={() => onNavigate(`tag:${tag}`)}>
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {backlinks.length > 0 && (
            <div style={STYLES.section}>
              <div style={STYLES.label}>Backlinks ({backlinks.length})</div>
              {backlinks.slice(0, 20).map(bl => (
                <span
                  key={bl.id}
                  style={STYLES.backlink}
                  onClick={() => onNavigate(bl.id)}
                >
                  ← {bl.label}
                </span>
              ))}
            </div>
          )}

          {fullView && (
            <div style={STYLES.markdownContent}>
              {loadingMd ? (
                <div style={{ color: '#585b70' }}>Loading...</div>
              ) : markdownContent ? (
                renderMarkdown(markdownContent, allNodes, onNavigate)
              ) : (
                <div style={{ color: '#585b70' }}>{node.excerpt}</div>
              )}
            </div>
          )}

          {!fullView && node.excerpt && (
            <div style={{ ...STYLES.section, color: '#9399b2', lineHeight: 1.6 }}>
              {node.excerpt}
              <div style={{ marginTop: 8, color: '#585b70', fontSize: 12 }}>
                Double-click node to open full note
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
