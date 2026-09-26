import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfigInputs } from "./config-inputs";
import { DEFAULT_TRADE_DRAFT } from "./trade-config";

describe("ConfigInputs", () => {
  it("renders the current draft values in labeled inputs", () => {
    const markup = renderToStaticMarkup(
      <ConfigInputs draft={{ fee: "2", slippage: "0.5", size: "0.25" }} errors={[]} onChange={() => {}} />
    );
    expect(markup).toContain('aria-label="Fee per unit"');
    expect(markup).toContain('aria-label="Slippage per unit"');
    expect(markup).toContain('aria-label="Position size"');
    expect(markup).toContain('value="2"');
    expect(markup).toContain('value="0.5"');
    expect(markup).toContain('value="0.25"');
    expect(markup).not.toContain("config-error");
  });

  it("shows validation errors visibly instead of hiding them", () => {
    const markup = renderToStaticMarkup(
      <ConfigInputs
        draft={DEFAULT_TRADE_DRAFT}
        errors={["Fee must be a finite number >= 0", "Size must be a finite number > 0"]}
        onChange={() => {}}
      />
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Fee must be a finite number &gt;= 0");
    expect(markup).toContain("Size must be a finite number &gt; 0");
  });
});
