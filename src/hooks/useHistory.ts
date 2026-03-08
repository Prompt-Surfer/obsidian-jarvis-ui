import { useRef, useCallback } from 'react'

const MAX_HISTORY = 50

export function useHistory() {
  const stackRef = useRef<string[]>([])
  const indexRef = useRef(-1)

  const push = useCallback((nodeId: string) => {
    // Truncate forward stack on new navigation
    const stack = stackRef.current.slice(0, indexRef.current + 1)
    stack.push(nodeId)
    if (stack.length > MAX_HISTORY) stack.shift()
    stackRef.current = stack
    indexRef.current = stack.length - 1
  }, [])

  const back = useCallback((): string | null => {
    if (indexRef.current <= 0) return null
    indexRef.current--
    return stackRef.current[indexRef.current]
  }, [])

  const forward = useCallback((): string | null => {
    if (indexRef.current >= stackRef.current.length - 1) return null
    indexRef.current++
    return stackRef.current[indexRef.current]
  }, [])

  return { push, back, forward }
}
