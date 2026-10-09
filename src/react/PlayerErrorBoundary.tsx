'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface PlayerErrorBoundaryProps {
  children?: ReactNode;
  /** Rendered when the wrapper itself fails to render. Media errors never reach this boundary. */
  fallback?: ReactNode;
  onRenderError?: (error: unknown, info: ErrorInfo) => void;
}

interface State {
  failed: boolean;
}

/**
 * Catches failures of the React wrapper (rendering, effects that construct the
 * player). Media/playback errors are reported through `onError` and the
 * in-player error UI instead.
 */
export class PlayerErrorBoundary extends Component<PlayerErrorBoundaryProps, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onRenderError?.(error, info);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        this.props.fallback ?? (
          <div className="rsp-root rsp-render-error" role="alert">
            <p className="rsp-error-title">The video player could not be displayed.</p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
