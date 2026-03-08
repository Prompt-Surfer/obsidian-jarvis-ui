import { Component, ReactNode, ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          width: '100vw',
          height: '100vh',
          background: '#000000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: '"Courier New", monospace',
          color: '#00d4ff',
          padding: '20px',
        }}>
          <div style={{ textAlign: 'center', maxWidth: 600 }}>
            <div style={{
              fontSize: 18,
              marginBottom: 16,
              letterSpacing: '0.1em',
              color: '#ff6b35',
            }}>
              ✗ WEBGL NOT AVAILABLE
            </div>
            <div style={{
              fontSize: 13,
              lineHeight: 1.8,
              color: '#00a8cc',
              marginBottom: 16,
            }}>
              WebGL failed to initialize. Please try a GPU-enabled browser or ensure WebGL is enabled in your settings.
            </div>
            <div style={{
              fontSize: 11,
              color: '#585b70',
              marginTop: 20,
              padding: '12px',
              background: 'rgba(0,0,0,0.5)',
              borderRadius: 4,
              border: '1px solid #1a3a4a',
            }}>
              Error: {this.state.error?.message || 'Unknown error'}
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
