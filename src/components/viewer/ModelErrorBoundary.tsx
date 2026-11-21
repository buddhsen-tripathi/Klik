import { Component, type ReactNode } from 'react'

/** If a scan file fails to load, fall back to the blockout instead of breaking the page. */
export default class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode; onError?: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.error('Could not load 3D scan, showing blockout instead', err)
    this.props.onError?.()
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
