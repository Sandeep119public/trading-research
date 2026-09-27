import { Component, type ReactNode } from "react";

/**
 * Last-resort crash surface: any render/lifecycle error in the app tree shows
 * a visible alert with the failure message and a reload control instead of an
 * empty white screen. Testable statically: getDerivedStateFromError only maps
 * the thrown value to a message (no DOM), and ErrorFallback is plain markup.
 */
export function ErrorFallback({ message }: { message: string }) {
  return (
    <div className="app-error" role="alert">
      <h1>The app hit an unexpected error</h1>
      <p>{message}</p>
      <button type="button" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}

interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  message: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown): void {
    console.error("Unhandled UI error:", error);
  }

  render(): ReactNode {
    if (this.state.message !== null) return <ErrorFallback message={this.state.message} />;
    return this.props.children;
  }
}
