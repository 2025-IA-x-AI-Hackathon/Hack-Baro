import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureRendererException } from "../sentry";

type SentryErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type SentryErrorBoundaryState = {
  hasError: boolean;
  error?: Error;
  info?: ErrorInfo;
};

const isProductionEnv = (): boolean => {
  if (typeof process === "undefined" || !process?.env) {
    return false;
  }
  return process.env.NODE_ENV === "production";
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

  static getDerivedStateFromError(error: Error): SentryErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    captureRendererException(error);

    if (!isProductionEnv()) {
      // eslint-disable-next-line no-console -- Helpful during development to see the component stack.
      console.error(
        "Renderer error boundary caught an error",
        error,
        errorInfo,
      );
    }

    this.setState({ error, info: errorInfo });
  }

  render() {
    const { hasError, error, info } = this.state;
    const { fallback, children } = this.props;

    if (hasError) {
      if (!isProductionEnv()) {
        return (
          <div className="renderer-error-boundary p-4 text-left">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="mb-2 text-sm opacity-80">
              Error: {error?.message ?? "Unknown error"}
            </p>
            {error?.stack ? (
              <pre className="overflow-auto rounded bg-black/10 p-2 text-xs">
                {error.stack}
              </pre>
            ) : null}
            {info?.componentStack ? (
              <pre className="mt-2 overflow-auto rounded bg-black/5 p-2 text-xs">
                {info.componentStack}
              </pre>
            ) : null}
          </div>
        );
      }
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
