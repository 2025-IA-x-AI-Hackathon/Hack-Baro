import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureRendererException } from "../sentry";

type SentryErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type SentryErrorBoundaryState = {
  hasError: boolean;
};

/**
 * Catches unexpected renderer errors, reports them to Sentry, and displays a minimal fallback UI.
 * The Electron renderer process already registers global listeners, but React render errors may
 * bypass those hooks; this boundary ensures component tree failures are captured with component stack.
 */
class SentryErrorBoundary extends Component<
  SentryErrorBoundaryProps,
  SentryErrorBoundaryState
> {
  constructor(props: SentryErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): SentryErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    captureRendererException(error);

    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console -- Helpful during development to see the component stack.
      console.error(
        "Renderer error boundary caught an error",
        error,
        errorInfo,
      );
    }
  }

  render() {
    const { hasError } = this.state;
    const { fallback, children } = this.props;

    if (hasError) {
      return fallback;
    }

    return children;
  }
}

export const DEFAULT_SENTRY_FALLBACK = (
  <div className="renderer-error-boundary">
    <h1>Something went wrong</h1>
    <p>We&apos;ve captured the error and will investigate.</p>
  </div>
);

export default SentryErrorBoundary;
