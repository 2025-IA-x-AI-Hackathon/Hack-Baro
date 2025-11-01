import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SentryErrorBoundary, {
  DEFAULT_SENTRY_FALLBACK,
} from "../components/SentryErrorBoundary";

const Thrower = () => {
  throw new Error("boom");
};

describe("SentryErrorBoundary", () => {
  it("renders children when no error occurs", () => {
    render(
      <SentryErrorBoundary fallback={DEFAULT_SENTRY_FALLBACK}>
        <div>safe content</div>
      </SentryErrorBoundary>,
    );

    expect(screen.getByText("safe content")).toBeInTheDocument();
  });

  it("shows fallback content after an error", () => {
    render(
      <SentryErrorBoundary fallback={DEFAULT_SENTRY_FALLBACK}>
        <Thrower />
      </SentryErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("respects custom fallback content", () => {
    render(
      <SentryErrorBoundary fallback={<div>custom fallback</div>}>
        <Thrower />
      </SentryErrorBoundary>,
    );

    expect(screen.getByText("custom fallback")).toBeInTheDocument();
  });
});
