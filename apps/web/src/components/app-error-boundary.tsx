"use client";

import { Component, type ReactNode } from "react";
import { AppErrorFallback } from "./error-fallback";

type Props = { children: ReactNode };
type State = { error: (Error & { digest?: string }) | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <AppErrorFallback
          error={this.state.error}
          reset={() => {
            this.setState({ error: null });
          }}
        />
      );
    }
    return this.props.children;
  }
}
