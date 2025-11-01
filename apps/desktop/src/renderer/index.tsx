import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { i18nInstance, initializeI18n } from "../shared/i18n";
import App from "./App";
import SentryErrorBoundary, {
  DEFAULT_SENTRY_FALLBACK,
} from "./components/SentryErrorBoundary";
import "./sentry";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container element was not found");
}

const root = createRoot(container);

const renderApp = () => {
  root.render(
    <StrictMode>
      <SentryErrorBoundary fallback={DEFAULT_SENTRY_FALLBACK}>
        <I18nextProvider i18n={i18nInstance}>
          <Suspense fallback={<div className="i18n-loading">Loading…</div>}>
            <App />
          </Suspense>
        </I18nextProvider>
      </SentryErrorBoundary>
    </StrictMode>,
  );
};

initializeI18n()
  .then(renderApp)
  .catch((error) => {
    // eslint-disable-next-line no-console -- Surface i18n bootstrap issues during development.
    console.error("Failed to initialise i18n", error);
    renderApp();
  });
