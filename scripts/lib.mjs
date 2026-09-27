/**
 * Pure helpers for scripts/dev.mjs — the parts worth unit-testing: version
 * verdicts, port extraction, netstat/process parsing, and ownership
 * classification. No I/O, no process control, no prompts in this file.
 */

export function parseNodeVersion(raw) {
  if (typeof raw !== "string") return null;
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0) };
}

/** True when the version satisfies Vite 7's documented floor: ^20.19 || >=22.12. */
function meetsViteFloor({ major, minor }) {
  if (major < 20) return false;
  if (major === 20) return minor >= 19;
  if (major === 21) return false;
  if (major === 22) return minor >= 12;
  return true;
}

/**
 * Block below the repo's documented floor (installs/builds known to fail),
 * warn when the version works but misses the EBADENGINE-free threshold, ok
 * otherwise. An unparseable version never blocks: the script itself is
 * already running under it.
 */
export function nodeVersionVerdict(raw) {
  const parsed = parseNodeVersion(raw);
  if (parsed === null) {
    return { level: "warn", message: `could not parse Node version "${raw ?? ""}" — continuing unverified` };
  }
  const shown = `v${parsed.major}.${parsed.minor}.${parsed.patch}`;
  if (parsed.major < 20) {
    return {
      level: "block",
      message:
        `${shown} is below this repo's floor: README requires Node.js 20.19+ and ` +
        `installs/builds are known to fail on older majors. Install Node 20.19+ (or 22.12+) and rerun.`
    };
  }
  if (!meetsViteFloor(parsed)) {
    return {
      level: "warn",
      message:
        `${shown} works, but is below Vite's floor (20.19+ / 22.12+): ` +
        `expect an EBADENGINE/"Please upgrade your Node.js version" warning during dev and build.`
    };
  }
  return { level: "ok", message: `${shown}` };
}

export function extractVitePort(source) {
  if (typeof source !== "string") return null;
  const match = /\bport\s*:\s*(\d{1,5})/.exec(source);
  return match ? Number(match[1]) : null;
}

export function extractWranglerDevPort(toml) {
  if (typeof toml !== "string") return null;
  let inDev = false;
  for (const line of toml.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      inDev = header[1].trim() === "dev";
      continue;
    }
    if (!inDev) continue;
    const port = /^\s*port\s*=\s*(\d{1,5})\s*(?:#.*)?$/.exec(line);
    if (port) return Number(port[1]);
  }
  return null;
}

export function portFromUrl(raw) {
  if (typeof raw !== "string" || raw === "") return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.port !== "") return Number(url.port);
  if (url.protocol === "http:") return 80;
  if (url.protocol === "https:") return 443;
  return null;
}

/**
 * Win32 `netstat -ano` (never `-p tcp`: it drops IPv6 listeners) -> PIDs with
 * a TCP LISTENING socket on `port`.
 */
export function parseListeningPids(output, port) {
  const suffix = `:${port}`;
  const pids = [];
  for (const line of String(output ?? "").split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || parts[0] !== "TCP" || parts[3] !== "LISTENING") continue;
    if (!parts[1].endsWith(suffix)) continue;
    const pid = Number(parts[4]);
    if (Number.isInteger(pid)) pids.push(pid);
  }
  return [...new Set(pids)];
}

/** PowerShell `"<pid>|<command line>"` inventory lines → {pid, commandLine}[]. */
export function parseProcessList(output) {
  const rows = [];
  for (const line of String(output ?? "").split(/\r?\n/)) {
    if (!line.includes("|")) continue;
    const sep = line.indexOf("|");
    const pid = Number(line.slice(0, sep));
    if (!Number.isInteger(pid)) continue;
    rows.push({ pid, commandLine: line.slice(sep + 1) });
  }
  return rows;
}

/** Does this process belong to this working directory (AGENTS.md:22 scope)? */
export function classifyOwner(commandLine, repoRoot) {
  const normalize = value => String(value ?? "").toLowerCase().replace(/\\/g, "/");
  return normalize(commandLine).includes(normalize(repoRoot)) ? "ours" : "unknown";
}
