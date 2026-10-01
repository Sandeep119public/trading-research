// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders the icon, title, and guidance", () => {
    const markup = renderToStaticMarkup(
      <EmptyState icon="▶" title="At start of data" body="Press Play or Step to advance." />
    );
    expect(markup).toContain("At start of data");
    expect(markup).toContain("Press Play or Step to advance.");
    expect(markup).toContain("▶");
  });

  it("hides the icon from assistive tech and exposes the title as a heading", () => {
    const markup = renderToStaticMarkup(<EmptyState icon="▶" title="End of data" />);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toMatch(/<h3[^>]*>End of data<\/h3>/);
  });

  it("renders actions when provided and omits the slots when not", () => {
    const withActions = renderToStaticMarkup(
      <EmptyState icon="▶" title="Failed" body="Why." actions={<button type="button">Retry</button>} />
    );
    expect(withActions).toContain("Retry");
    expect(withActions).toContain("empty-state-actions");

    const bare = renderToStaticMarkup(<EmptyState icon="▶" title="Nothing yet" />);
    expect(bare).not.toContain("empty-state-body");
    expect(bare).not.toContain("empty-state-actions");
  });
});
