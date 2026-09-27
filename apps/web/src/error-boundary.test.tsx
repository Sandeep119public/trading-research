import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorBoundary, ErrorFallback } from "./error-boundary";

describe("ErrorBoundary", () => {
  it("maps a thrown Error to its message as the fallback state", () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error("boom"))).toEqual({ message: "boom" });
  });

  it("maps a thrown non-Error to readable text", () => {
    expect(ErrorBoundary.getDerivedStateFromError("plain string")).toEqual({ message: "plain string" });
  });
});

describe("ErrorFallback", () => {
  it("shows the failure visibly with the message instead of an empty screen", () => {
    const markup = renderToStaticMarkup(<ErrorFallback message="boom" />);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("boom");
    expect(markup).toContain("Reload");
  });
});
