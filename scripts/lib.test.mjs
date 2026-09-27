import { describe, expect, it } from "vitest";
import {
  classifyOwner,
  extractVitePort,
  extractWranglerDevPort,
  nodeVersionVerdict,
  parseListeningPids,
  parseNodeVersion,
  parseProcessList,
  portFromUrl
} from "./lib.mjs";

describe("parseNodeVersion", () => {
  it("parses the v-prefixed output of node --version", () => {
    expect(parseNodeVersion("v20.18.0")).toEqual({ major: 20, minor: 18, patch: 0 });
  });

  it("parses a bare version and tolerates missing patch", () => {
    expect(parseNodeVersion("22.12")).toEqual({ major: 22, minor: 12, patch: 0 });
  });

  it("returns null for garbage instead of throwing", () => {
    expect(parseNodeVersion("not-a-version")).toBeNull();
    expect(parseNodeVersion("")).toBeNull();
    expect(parseNodeVersion(undefined)).toBeNull();
  });
});

describe("nodeVersionVerdict", () => {
  it("blocks below the repo's major floor (install/build known to fail)", () => {
    expect(nodeVersionVerdict("v18.19.0")).toMatchObject({ level: "block" });
    expect(nodeVersionVerdict("v16.20.2")).toMatchObject({ level: "block" });
  });

  it("warns on versions that work but miss the Vite 20.19+/22.12+ floor", () => {
    expect(nodeVersionVerdict("v20.18.0")).toMatchObject({ level: "warn" });
    expect(nodeVersionVerdict("v20.0.0")).toMatchObject({ level: "warn" });
    expect(nodeVersionVerdict("v21.7.0")).toMatchObject({ level: "warn" });
  });

  it("is ok exactly on and above the documented floors", () => {
    expect(nodeVersionVerdict("v20.19.0")).toMatchObject({ level: "ok" });
    expect(nodeVersionVerdict("v20.19.3")).toMatchObject({ level: "ok" });
    expect(nodeVersionVerdict("v22.12.0")).toMatchObject({ level: "ok" });
    expect(nodeVersionVerdict("v23.6.0")).toMatchObject({ level: "ok" });
    expect(nodeVersionVerdict("v24.0.0")).toMatchObject({ level: "ok" });
  });

  it("never blocks on an unparseable version — the script is already running", () => {
    expect(nodeVersionVerdict("mystery").level).not.toBe("block");
  });
});

describe("extractVitePort", () => {
  it("reads an explicit server.port from vite config source", () => {
    expect(extractVitePort("server: { port: 4000 }")).toBe(4000);
  });

  it("returns null when no port is configured (vite default applies)", () => {
    expect(extractVitePort("export default defineConfig({ plugins: [react()] });")).toBeNull();
  });
});

describe("extractWranglerDevPort", () => {
  it("reads port from the [dev] section only", () => {
    const toml = 'name = "x"\n[dev]\nport = 9000\n';
    expect(extractWranglerDevPort(toml)).toBe(9000);
  });

  it("ignores ports outside [dev] and returns null when absent", () => {
    expect(extractWranglerDevPort('name = "x"\nport = 1111\n')).toBeNull();
    expect(extractWranglerDevPort('name = "x"\ncompatibility_date = "2026-05-03"\n')).toBeNull();
  });
});

describe("portFromUrl", () => {
  it("extracts the port from a URL and defaults http to 80", () => {
    expect(portFromUrl("http://127.0.0.1:8787")).toBe(8787);
    expect(portFromUrl("http://localhost")).toBe(80);
  });

  it("returns null for non-URL input", () => {
    expect(portFromUrl("not a url")).toBeNull();
    expect(portFromUrl(undefined)).toBeNull();
  });
});

describe("parseListeningPids", () => {
  const NETSTAT = `
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       1234
  TCP    [::1]:5173             [::]:0                 LISTENING       1234
  TCP    127.0.0.1:51730        0.0.0.0:0              LISTENING       5555
  TCP    0.0.0.0:8787           0.0.0.0:0              LISTENING       9999
  TCP    127.0.0.1:5173         0.0.0.0:0              TIME_WAIT       1111
  UDP    0.0.0.0:5173           *:*                                    4444
`;

  it("returns the PIDs of TCP LISTENING sockets on the exact port", () => {
    expect(parseListeningPids(NETSTAT, 5173)).toEqual([1234]);
    expect(parseListeningPids(NETSTAT, 8787)).toEqual([9999]);
  });

  it("does not match a different port that merely contains the digits", () => {
    expect(parseListeningPids(NETSTAT, 5173)).not.toContain(5555);
    expect(parseListeningPids(NETSTAT, 51730)).toEqual([5555]);
  });

  it("ignores non-LISTENING states and UDP sockets", () => {
    expect(parseListeningPids(NETSTAT, 5173)).not.toContain(1111);
    expect(parseListeningPids(NETSTAT, 5173)).not.toContain(4444);
  });

  it("returns an empty list when the port is free", () => {
    expect(parseListeningPids(NETSTAT, 3000)).toEqual([]);
  });
});

describe("parseProcessList", () => {
  it("parses pid|command lines from the PowerShell inventory", () => {
    const out = "1234|node C:\\repo\\node_modules\\.bin\\vite.CMD\n9999|wrangler dev\n";
    expect(parseProcessList(out)).toEqual([
      { pid: 1234, commandLine: "node C:\\repo\\node_modules\\.bin\\vite.CMD" },
      { pid: 9999, commandLine: "wrangler dev" }
    ]);
  });

  it("skips blank lines and lines without a numeric pid", () => {
    expect(parseProcessList("\nnope|garbage\n\n")).toEqual([]);
  });
});

describe("classifyOwner", () => {
  const ROOT = "C:\\Users\\me\\Documents\\trading-research";

  it("classifies command lines containing this repo's path as ours", () => {
    expect(classifyOwner(`node ${ROOT}\\node_modules\\.bin\\vite.CMD`, ROOT)).toBe("ours");
    expect(classifyOwner(`npm run dev --workspace @trading-research/web (cwd: ${ROOT})`, ROOT)).toBe("ours");
  });

  it("is case-insensitive and separator-agnostic about the root path", () => {
    expect(classifyOwner("node c:/users/me/documents/trading-research/node_modules/vite/bin/vite.js", ROOT)).toBe(
      "ours"
    );
  });

  it("classifies unrelated command lines as unknown", () => {
    expect(classifyOwner("node -e require('http').createServer().listen(5173)", ROOT)).toBe("unknown");
    expect(classifyOwner("C:\\other\\project\\node_modules\\.bin\\vite.CMD", ROOT)).toBe("unknown");
    expect(classifyOwner("", ROOT)).toBe("unknown");
  });
});
