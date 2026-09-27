import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RuntimeErrorBanner } from "./runtime-error";

describe("RuntimeErrorBanner", () => {
  it("shows a runtime failure as an alert with the engine's message and a dismiss control", () => {
    const markup = renderToStaticMarkup(
      <RuntimeErrorBanner
        message="Replay stopped: execution price must be a finite number > 0"
        onDismiss={() => {}}
      />
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Replay stopped: execution price must be a finite number &gt; 0");
    expect(markup).toContain("Dismiss");
  });
});
