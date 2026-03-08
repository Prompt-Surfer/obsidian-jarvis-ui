import { useEffect, useRef, useCallback } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import type { Extension } from '@codemirror/state'

interface NoteEditorProps {
  content: string
  notePath: string
  onSaveStatus: (status: 'saving' | 'saved' | null) => void
}

const jarvisDark: Extension = EditorView.theme({
  '&': { background: '#1e1e2e', color: '#dcddde', height: '100%' },
  '.cm-editor': { height: '100%' },
  '.cm-scroller': { fontFamily: '"Inter", "Segoe UI", sans-serif', fontSize: '14px', lineHeight: '1.7' },
  '.cm-focused': { outline: 'none' },
  '.cm-gutters': { background: '#181825', color: '#585b70', border: 'none' },
  '.cm-activeLineGutter': { background: '#1e1e2e' },
  '.cm-activeLine': { background: '#1e1e2e22' },
  '.cm-cursor': { borderLeftColor: '#00d4ff' },
  '.cm-selectionBackground': { background: '#00d4ff22 !important' },
  '.cm-line': { paddingLeft: '8px' },
}, { dark: true })

export function NoteEditor({ content, notePath, onSaveStatus }: NoteEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveContent = useCallback(async (text: string) => {
    onSaveStatus('saving')
    try {
      await fetch('/api/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: notePath, content: text }),
      })
      onSaveStatus('saved')
      setTimeout(() => onSaveStatus(null), 2000)
    } catch {
      onSaveStatus(null)
    }
  }, [notePath, onSaveStatus])

  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        markdown(),
        oneDark,
        jarvisDark,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString()
            if (debounceRef.current) clearTimeout(debounceRef.current)
            debounceRef.current = setTimeout(() => saveContent(text), 2000)
          }
        }),
        EditorView.lineWrapping,
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      view.destroy()
      viewRef.current = null
    }
  }, [content, notePath, saveContent])

  return (
    <div
      ref={containerRef}
      style={{ height: '100%', overflow: 'auto' }}
    />
  )
}
