import { Children, isValidElement, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { GraphNode } from '../hooks/useVaultGraph'

interface SidebarProps {
  node: GraphNode | null
  fullView: boolean
  allNodes: GraphNode[]
  onClose: () => void
  onNavigate: (nodeId: string) => void
  onTagFilter?: (tag: string) => void
  isFavourite?: boolean
  onToggleFavourite?: (nodeId: string) => void
}

const DEFAULT_WIDTH = 380
const MIN_WIDTH = 280
const MAX_WIDTH = 800

function getPersistedWidth(): number {
  try {
    const v = localStorage.getItem('jarvis-note-width')
    if (v) {
      const n = parseInt(v, 10)
      if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n
    }
  } catch { /* storage unavailable */ }
  return DEFAULT_WIDTH
}

// ── Utilities ────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join('')
  if (isValidElement(children)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return extractTextFromChildren((children as any).props?.children)
  }
  return ''
}

interface HeadingItem {
  level: 1 | 2 | 3
  text: string
  slug: string
}

function extractHeadings(md: string): HeadingItem[] {
  const items: HeadingItem[] = []
  for (const line of md.split('\n')) {
    const m = line.match(/^(#{1,3})\s+(.+)/)
    if (m) {
      const text = m[2].replace(/[*_`[\]]/g, '').trim()
      items.push({ level: m[1].length as 1 | 2 | 3, text, slug: slugify(text) })
    }
  }
  return items
}

interface FrontmatterData {
  tags: string[]
  aliases: string[]
  created?: string
  modified?: string
}

function parseFrontmatter(content: string): { metadata: FrontmatterData; body: string } {
  const empty: FrontmatterData = { tags: [], aliases: [] }
  if (!content.startsWith('---')) return { metadata: empty, body: content }
  const end = content.indexOf('\n---', 3)
  if (end === -1) return { metadata: empty, body: content }

  const yamlBlock = content.slice(3, end).trim()
  const body = content.slice(end + 4).trim()
  const raw: Record<string, string> = {}
  let tags: string[] = []
  let aliases: string[] = []
  let inTags = false
  let inAliases = false

  for (const line of yamlBlock.split('\n')) {
    if (/^\s+-\s/.test(line)) {
      const val = line.replace(/^\s+-\s+/, '').trim()
      if (inTags) tags.push(val)
      else if (inAliases) aliases.push(val)
      continue
    }
    inTags = false
    inAliases = false
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1).trim()
    raw[key] = val

    if (key === 'tags') {
      if (val.startsWith('[')) tags = val.slice(1, -1).split(',').map(t => t.trim()).filter(Boolean)
      else if (!val) inTags = true
      else tags = [val]
    } else if (key === 'aliases') {
      if (val.startsWith('[')) aliases = val.slice(1, -1).split(',').map(a => a.trim()).filter(Boolean)
      else if (!val) inAliases = true
      else aliases = [val]
    }
  }

  return {
    metadata: {
      tags,
      aliases,
      created: raw['created'] || raw['date'],
      modified: raw['modified'] || raw['updated'],
    },
    body,
  }
}

function formatDate(d?: string): string | null {
  if (!d) return null
  try {
    const parsed = new Date(d)
    if (isNaN(parsed.getTime())) return d
    return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return d }
}

// ── Callouts ─────────────────────────────────────────────────────────────────

const CALLOUT_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  note:      { icon: 'ℹ️',  color: '#3b82f6', bg: 'rgba(59,130,246,0.10)' },
  info:      { icon: 'ℹ️',  color: '#3b82f6', bg: 'rgba(59,130,246,0.10)' },
  warning:   { icon: '⚠️',  color: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
  caution:   { icon: '⚠️',  color: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
  tip:       { icon: '💡',  color: '#22c55e', bg: 'rgba(34,197,94,0.10)' },
  important: { icon: '❗',  color: '#7c5cbf', bg: 'rgba(124,92,191,0.10)' },
  danger:    { icon: '🔥',  color: '#ef4444', bg: 'rgba(239,68,68,0.10)' },
  callout:   { icon: '📌',  color: '#6b7280', bg: 'rgba(107,114,128,0.10)' },
}

/**
 * Convert Obsidian callout blockquotes to fenced code blocks with a special
 * language prefix so our ReactMarkdown `code` renderer can intercept them.
 *
 *   > [!NOTE] Title      →    ```callout-note
 *   > content                 Title
 *                             content
 *                             ```
 */
function preprocessCallouts(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const m = lines[i].match(/^> \[!([A-Za-z]+)\](?: (.*))?$/)
    if (m) {
      const type = m[1].toLowerCase()
      const title = m[2]?.trim() || m[1].toUpperCase()
      const body: string[] = []
      i++
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
        body.push(lines[i].replace(/^> ?/, ''))
        i++
      }
      out.push('```callout-' + type)
      out.push(title)
      out.push(...body)
      out.push('```')
    } else {
      out.push(lines[i])
      i++
    }
  }
  return out.join('\n')
}

function preprocessWikilinks(md: string): string {
  return md.replace(
    /\[\[([^\]|#]+?)(?:\|([^\]]+))?\]\]/g,
    (_m, target, alias) => {
      const display = alias || target
      const id = target.toLowerCase().replace(/\s+/g, '-')
      return `[${display}](jarvis://node/${id})`
    }
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function Sidebar({ node, fullView, allNodes, onClose, onNavigate, onTagFilter, isFavourite, onToggleFavourite }: SidebarProps) {
  const [markdownContent, setMarkdownContent] = useState<string | null>(null)
  const [loadingMd, setLoadingMd] = useState(false)
  const [width, setWidth] = useState(getPersistedWidth)
  const [dragging, setDragging] = useState(false)
  const [handleHovered, setHandleHovered] = useState(false)
  const [activeSlug, setActiveSlug] = useState('')
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)
  const contentRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const [scrollThumb, setScrollThumb] = useState({ topPct: 0, heightPct: 1 })

  const handleScroll = () => {
    const el = sidebarRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollHeight <= clientHeight) { setScrollThumb({ topPct: 0, heightPct: 1 }); return }
    const h = Math.max(clientHeight / scrollHeight, 0.06)
    const t = (scrollTop / (scrollHeight - clientHeight)) * (1 - h)
    setScrollThumb({ topPct: t, heightPct: h })
  }

  // Reset scroll position when navigating to a new node
  useEffect(() => {
    if (sidebarRef.current) sidebarRef.current.scrollTop = 0
    setScrollThumb({ topPct: 0, heightPct: 1 })
  }, [node?.id])

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

  // Drag to resize
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const dx = dragStartXRef.current - e.clientX
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidthRef.current + dx))
      setWidth(newWidth)
    }
    const onUp = () => {
      setDragging(false)
      try { localStorage.setItem('jarvis-note-width', String(width)) } catch { /* storage unavailable */ }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, width])

  // Parse frontmatter
  const { metadata, body } = markdownContent
    ? parseFrontmatter(markdownContent)
    : { metadata: { tags: [], aliases: [] } as FrontmatterData, body: '' }

  // Merge tags: prefer frontmatter tags, fall back to graph node tags
  const allTags = metadata.tags.length > 0 ? metadata.tags : (node?.tags ?? [])

  // Headings for TOC
  const headings = fullView && body ? extractHeadings(body) : []

  // Scroll-spy: observe h1/h2/h3[id] elements inside the content pane
  useEffect(() => {
    if (!contentRef.current || headings.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost intersecting heading
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSlug(entry.target.id)
            break
          }
        }
      },
      { rootMargin: '-5% 0px -70% 0px', threshold: 0 }
    )
    const els = contentRef.current.querySelectorAll('h1[id], h2[id], h3[id]')
    els.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [body, headings.length])

  // Find backlinks
  const backlinks = node
    ? allNodes.filter(n => n.links.some(l => {
        const tid = l.toLowerCase().replace(/\s+/g, '-')
        return tid === node.id || node.id.endsWith('/' + tid)
      }))
    : []

  const visible = !!node

  // Prepare final markdown (callouts then wikilinks, applied to frontmatter-stripped body)
  const processedMd = body ? preprocessWikilinks(preprocessCallouts(body)) : ''

  // ── Custom ReactMarkdown component map ──────────────────────────────────────

  const makeHeading = (Tag: 'h1' | 'h2' | 'h3', baseSize: string, topMargin: number, withBorder = false) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ children, ...props }: any) => {
      const text = extractTextFromChildren(children)
      const id = slugify(text)
      return (
        <Tag
          id={id}
          style={{
            color: '#e0e0e0',
            fontSize: baseSize,
            fontWeight: Tag === 'h3' ? 600 : 700,
            marginTop: topMargin,
            marginBottom: 8,
            ...(withBorder ? { borderBottom: '1px solid #333', paddingBottom: 6 } : {}),
          }}
          {...props}
        >
          {children}
        </Tag>
      )
    }

  const mdComponents = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a: ({ href, children, ...props }: any) => {
      const wikilinkStyle = {
        color: '#7c5cbf',
        cursor: 'pointer',
        textDecoration: 'none' as const,
      }
      if (href?.startsWith('jarvis://node/')) {
        const nodeId = href.slice('jarvis://node/'.length)
        return (
          <span
            onClick={() => onNavigate(nodeId)}
            style={wikilinkStyle}
            onMouseEnter={e => { (e.target as HTMLElement).style.textDecoration = 'underline' }}
            onMouseLeave={e => { (e.target as HTMLElement).style.textDecoration = 'none' }}
            {...props}
          >
            {children}
          </span>
        )
      }
      if (href && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:') && !href.startsWith('#')) {
        const filename = href.split('/').pop() || ''
        const noteName = decodeURIComponent(filename).replace(/\.md$/i, '').replace(/\.[^.]+$/, '')
        if (noteName) {
          return (
            <span
              onClick={() => onNavigate(noteName.toLowerCase().replace(/\s+/g, '-'))}
              style={wikilinkStyle}
              onMouseEnter={e => { (e.target as HTMLElement).style.textDecoration = 'underline' }}
              onMouseLeave={e => { (e.target as HTMLElement).style.textDecoration = 'none' }}
              {...props}
            >
              {children}
            </span>
          )
        }
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#7c5cbf', textDecoration: 'none' }} {...props}>
          {children}
        </a>
      )
    },

    // Pre: unwrap callout code blocks so they render as divs, not inside <pre>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pre: ({ children, ...props }: any) => {
      const arr = Children.toArray(children)
      if (arr.length === 1 && isValidElement(arr[0])) {
        const codeEl = arr[0] as React.ReactElement<{ className?: string }>
        if (codeEl.props.className?.startsWith('language-callout-')) {
          return <>{children}</>
        }
      }
      return (
        <pre
          style={{ background: '#2a2a3a', borderRadius: 6, padding: '12px 16px', overflowX: 'auto', margin: '12px 0', fontSize: 13 }}
          {...props}
        >
          {children}
        </pre>
      )
    },

    // Code: callout blocks + inline + fenced
    code: ({ children, className, ...props }: { children?: React.ReactNode; className?: string; [k: string]: unknown }) => {
      if (className?.startsWith('language-callout-')) {
        const type = className.replace('language-callout-', '')
        const lines = String(children).split('\n')
        const title = lines[0] || type.toUpperCase()
        const content = lines.slice(1).join('\n').trim()
        const config = CALLOUT_CONFIG[type] || CALLOUT_CONFIG.callout
        return (
          <div style={{
            borderLeft: `3px solid ${config.color}`,
            background: config.bg,
            borderRadius: '0 6px 6px 0',
            padding: '12px 16px',
            margin: '12px 0',
          }}>
            <div style={{ fontWeight: 600, color: config.color, marginBottom: content ? 6 : 0 }}>
              {config.icon} {title}
            </div>
            {content && <div style={{ color: '#dcddde', lineHeight: 1.6, fontSize: 14 }}>{content}</div>}
          </div>
        )
      }
      const isBlock = !!className?.startsWith('language-')
      return isBlock ? (
        <code
          style={{ background: '#2a2a3a', color: '#98c379', padding: 0, display: 'block', fontSize: 13 }}
          className={className}
          {...props}
        >
          {children}
        </code>
      ) : (
        <code style={{ background: '#2a2a3a', color: '#e06c75', padding: '2px 6px', borderRadius: 3, fontSize: '0.85em' }} {...props}>
          {children}
        </code>
      )
    },

    h1: makeHeading('h1', '1.8em', 20, true),
    h2: makeHeading('h2', '1.4em', 16),
    h3: makeHeading('h3', '1.15em', 12),
    p: ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) => (
      <p style={{ marginBottom: 12, color: '#dcddde', lineHeight: 1.7 }} {...props}>{children}</p>
    ),
    ul: ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) => (
      <ul style={{ paddingLeft: 24, marginBottom: 10 }} {...props}>{children}</ul>
    ),
    ol: ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) => (
      <ol style={{ paddingLeft: 24, marginBottom: 10 }} {...props}>{children}</ol>
    ),
    li: ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) => (
      <li style={{ marginBottom: 4 }} {...props}>{children}</li>
    ),
    blockquote: ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) => (
      <blockquote
        style={{ borderLeft: '3px solid #585b70', paddingLeft: 14, color: '#9399b2', margin: '12px 0', fontStyle: 'italic' }}
        {...props}
      >
        {children}
      </blockquote>
    ),
    hr: (props: Record<string, unknown>) => (
      <hr style={{ border: 'none', borderTop: '1px solid #333', margin: '18px 0' }} {...props} />
    ),
    table: ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) => (
      <div style={{ overflowX: 'auto', marginBottom: 12 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }} {...props}>{children}</table>
      </div>
    ),
    th: ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) => (
      <th style={{ background: '#2a2a3a', padding: '6px 12px', textAlign: 'left', borderBottom: '1px solid #444', color: '#e0e0e0', fontWeight: 600 }} {...props}>
        {children}
      </th>
    ),
    td: ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) => (
      <td style={{ padding: '6px 12px', borderBottom: '1px solid #2a2a3a', color: '#dcddde' }} {...props}>
        {children}
      </td>
    ),
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      width,
      height: '100%',
      background: '#1e1e2e',
      borderLeft: '1px solid #313244',
      color: '#dcddde',
      fontFamily: '"Inter", "Segoe UI", sans-serif',
      fontSize: 14,
      overflowY: 'scroll',
      scrollBehavior: 'smooth',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scrollbarWidth: 'none' as any,  // Firefox
      zIndex: 200,
      transition: dragging ? 'none' : 'transform 0.25s ease',
      transform: visible ? 'translateX(0)' : 'translateX(100%)',
      userSelect: dragging ? 'none' : undefined,
    }}
      ref={sidebarRef}
      onScroll={handleScroll}
      className="jarvis-sidebar"
    >
      {/* Custom scrollbar */}
      {scrollThumb.heightPct < 0.99 && (
        <div style={{
          position: 'fixed',
          right: 2,
          top: 0,
          width: 5,
          height: '100%',
          zIndex: 210,
          pointerEvents: 'none',
        }}>
          <div style={{
            position: 'absolute',
            right: 0,
            top: `${scrollThumb.topPct * 100}%`,
            height: `${scrollThumb.heightPct * 100}%`,
            width: 4,
            background: 'rgba(0,212,255,0.45)',
            borderRadius: 4,
            transition: 'top 0.08s ease, background 0.2s ease',
            boxShadow: '0 0 6px rgba(0,212,255,0.3)',
          }} />
        </div>
      )}
      {/* Drag handle */}
      <div
        onMouseDown={e => {
          e.preventDefault()
          dragStartXRef.current = e.clientX
          dragStartWidthRef.current = width
          setDragging(true)
        }}
        onMouseEnter={() => setHandleHovered(true)}
        onMouseLeave={() => setHandleHovered(false)}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 6,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 10,
          background: handleHovered || dragging ? '#00d4ff44' : 'transparent',
          transition: 'background 0.15s',
        }}
      />

      {node && (
        <>
          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div style={{
            padding: '20px 20px 12px',
            borderBottom: '1px solid #313244',
            position: 'sticky',
            top: 0,
            background: '#1e1e2e',
            zIndex: 1,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 36 }}>
              <h2 style={{ color: '#e0e0e0', fontSize: 17, fontWeight: 600, margin: 0, lineHeight: 1.4 }}>
                {node.label}
              </h2>
              {onToggleFavourite && (
                <span
                  onClick={() => onToggleFavourite(node.id)}
                  title={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
                  style={{
                    cursor: 'pointer',
                    color: isFavourite ? '#00d4ff' : '#8892a4',
                    fontSize: 20,
                    lineHeight: 1,
                    flexShrink: 0,
                    marginLeft: 4,
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#00d4ff' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = isFavourite ? '#00d4ff' : '#8892a4' }}
                >
                  {isFavourite ? '♥' : '♡'}
                </span>
              )}
            </div>
            <button
              style={{
                position: 'absolute',
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
              }}
              onClick={onClose}
              title="Close (Escape)"
            >✕</button>
            <div style={{ color: '#585b70', fontSize: 11, marginTop: 6 }}>
              {node.type.toUpperCase()} · {node.path}
            </div>
          </div>

          {/* ── Tag pills + frontmatter metadata ───────────────────────────── */}
          {(allTags.length > 0 || metadata.created || metadata.modified) && (
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #181825' }}>
              {allTags.length > 0 && (
                <div style={{ marginBottom: metadata.created || metadata.modified ? 10 : 0 }}>
                  <div style={{
                    color: '#585b70',
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 6,
                  }}>
                    Tags
                  </div>
                  {allTags.map(tag => (
                    <span
                      key={tag}
                      onClick={() => onTagFilter ? onTagFilter(tag) : onNavigate(`tag:${tag}`)}
                      title={`Filter graph by #${tag}`}
                      style={{
                        display: 'inline-block',
                        background: 'rgba(124,92,191,0.15)',
                        border: '1px solid rgba(124,92,191,0.4)',
                        color: '#7c5cbf',
                        borderRadius: 12,
                        padding: '2px 10px',
                        fontSize: 12,
                        marginRight: 4,
                        marginBottom: 4,
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,92,191,0.28)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,92,191,0.15)' }}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
              {(metadata.created || metadata.modified) && (
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {metadata.created && (
                    <div>
                      <span style={{ color: '#585b70', fontSize: 11 }}>Created </span>
                      <span style={{ color: '#9399b2', fontSize: 11 }}>{formatDate(metadata.created)}</span>
                    </div>
                  )}
                  {metadata.modified && (
                    <div>
                      <span style={{ color: '#585b70', fontSize: 11 }}>Modified </span>
                      <span style={{ color: '#9399b2', fontSize: 11 }}>{formatDate(metadata.modified)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Backlinks ──────────────────────────────────────────────────── */}
          {backlinks.length > 0 && (
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #181825' }}>
              <div style={{ color: '#585b70', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Backlinks ({backlinks.length})
              </div>
              {backlinks.slice(0, 20).map(bl => (
                <span
                  key={bl.id}
                  onClick={() => onNavigate(bl.id)}
                  style={{ display: 'block', color: '#89dceb', cursor: 'pointer', padding: '3px 0', fontSize: 13, textDecoration: 'none' }}
                >
                  ← {bl.label}
                </span>
              ))}
            </div>
          )}

          {/* ── TOC: On This Page ──────────────────────────────────────────── */}
          {fullView && headings.length > 0 && (
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #181825' }}>
              <div style={{
                color: '#585b70',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                fontWeight: 600,
                marginBottom: 8,
              }}>
                On This Page
              </div>
              {headings.map((h, idx) => {
                const isActive = activeSlug === h.slug
                const indent = h.level === 1 ? 4 : h.level === 2 ? 12 : 24
                return (
                  <a
                    key={`${h.slug}-${idx}`}
                    href={`#${h.slug}`}
                    onClick={e => {
                      e.preventDefault()
                      document.getElementById(h.slug)?.scrollIntoView({ behavior: 'smooth' })
                    }}
                    style={{
                      display: 'block',
                      paddingLeft: indent,
                      paddingTop: 3,
                      paddingBottom: 3,
                      paddingRight: 0,
                      fontSize: 13,
                      color: isActive ? '#7c5cbf' : '#9399b2',
                      textDecoration: 'none',
                      borderLeft: isActive ? '2px solid #7c5cbf' : '2px solid transparent',
                      marginLeft: -2,
                      transition: 'color 0.15s',
                      lineHeight: 1.4,
                    }}
                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = '#cdd6f4' }}
                    onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = '#9399b2' }}
                  >
                    {h.text}
                  </a>
                )
              })}
            </div>
          )}

          {/* ── Markdown content ───────────────────────────────────────────── */}
          {fullView && (
            <div ref={contentRef} style={{ padding: '16px 20px 32px', lineHeight: 1.7, fontSize: 15, color: '#dcddde' }}>
              {loadingMd ? (
                <div style={{ color: '#585b70' }}>Loading…</div>
              ) : processedMd ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  components={mdComponents as any}
                >
                  {processedMd}
                </ReactMarkdown>
              ) : (
                <div style={{ color: '#585b70' }}>{node.excerpt}</div>
              )}
            </div>
          )}

          {/* ── Excerpt (non-full-view) ────────────────────────────────────── */}
          {!fullView && node.excerpt && (
            <div style={{ padding: '12px 20px', color: '#9399b2', lineHeight: 1.6, borderTop: '1px solid #181825' }}>
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
