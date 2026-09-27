#!/usr/bin/env node
/**
 * dev:all - start apps/web (vite) and services/data-api (wrangler dev)
 * together, safely.
 *
 * Pre-flight (fail fast): Node version, install state, git tree (AGENTS.md:22
 * surfaced by tooling, not memory), port availability with ownership
 * classification, local config presence. Then labeled startup with
 * ready-waiting, crash supervision, and Ctrl+C shutdown of BOTH services with
 * an explicit post-shutdown port check so orphans cannot hide.
 *
 * Pure logic (version verdicts, port parsing, ownership classification) lives
 * in lib.mjs and is unit-tested by scripts/lib.test.mjs. This file owns I/O,
 * prompts, spawning, and signals only.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  classifyOwner,
  extractVitePort,
  extractWranglerDevPort,
  nodeVersionVerdict,
  parseListeningPids,
  parseProcessList,
  portFromUrl
} from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_VITE_PORT = 5173;
const DEFAULT_API_PORT = 8787;
const READY_TIMEOUT_MS = 90_000;
const SHUTDOWN_GRACE_MS = 5_000;
const IS_WIN = process.platform === "win32";
const NPM = IS_WIN ? "npm.cmd" : "npm";

const log = message => console.log(`[dev] ${message}`);
const logWarn = message => console.log(`[dev] WARNING: ${message}`);
const logFail = message => console.log(`[dev] FAIL: ${message}`);
const debug = message => {
  if (process.env.DEBUG_DEV) console.error(`[debug] ${message}`);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function execFileAsync(file, args, options = {}) {
  return new Promise(resolve => {
    execFile(file, args, { windowsHide: true, ...options }, (error, stdout, stderr) =>
      resolve({ ok: !error, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), error })
    );
  });
}

let activePrompt = null;
let rl = null;
let rlClosed = false;
let pendingLine = null;
const lineQueue = [];

function ensureInterface() {
  if (rl || rlClosed) return;
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  debug(`interface created (isTTY=${process.stdin.isTTY})`);
  rl.on("line", line => {
    const value = line.trim();
    debug(`line received: ${JSON.stringify(value)} (pending=${pendingLine !== null}, queued=${lineQueue.length})`);
    if (pendingLine) pendingLine(value);
    else lineQueue.push(value); // piped answers can arrive before their prompt
  });
  rl.on("close", () => {
    debug(`close received (queued=${lineQueue.length})`);
    rlClosed = true;
    rl = null;
    if (pendingLine) pendingLine(null);
  });
}

function ask(question, { defaultYes = false } = {}) {
  return new Promise(resolve => {
    const hint = defaultYes ? "[Y/n]" : "[y/N]";
    const settle = value => {
      debug(`ask settled: ${JSON.stringify(value)}`);
      if (value !== null && !process.stdin.isTTY) process.stdout.write(`${value}\n`);
      pendingLine = null;
      activePrompt = null;
      resolve(value);
    };
    // Buffered answers stay valid after stdin closes (piped input ends early).
    if (lineQueue.length > 0) {
      const value = lineQueue.shift();
      process.stdout.write(`${question} ${hint} `);
      settle(value);
      return;
    }
    if (rlClosed) {
      process.stdout.write(`${question} ${hint} \n`);
      settle(null);
      return;
    }
    ensureInterface();
    if (lineQueue.length > 0) {
      const value = lineQueue.shift();
      process.stdout.write(`${question} ${hint} `);
      settle(value);
      return;
    }
    activePrompt = { abort: () => settle(null) };
    pendingLine = settle;
    debug(`ask waiting for input: ${question}`);
    process.stdout.write(`${question} ${hint} `);
  });
}

function confirm(answer, { defaultYes = false } = {}) {
  if (answer === null) return defaultYes;
  if (answer === "") return defaultYes;
  return /^y(es)?$/i.test(answer);
}

function tryConnect(port, host, family) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host, family });
    const finish = inUse => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(inUse);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(800, () => finish(false));
  });
}

// Services can bind IPv4 (127.0.0.1) or IPv6 (::1) only - check both, or a
// ::1-only listener looks "free" while it is alive.
async function portInUse(port) {
  return (await tryConnect(port, "127.0.0.1", 4)) || (await tryConnect(port, "::1", 6));
}

async function probe(urls) {
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
      return { status: response.status, url };
    } catch {
      // try the next address
    }
  }
  return null;
}

async function waitForPortFree(port, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portInUse(port))) return true;
    await sleep(250);
  }
  return !(await portInUse(port));
}

async function portOwners(port) {
  if (IS_WIN) {
    // Plain -ano: Windows `netstat -p tcp` silently drops IPv6 listeners.
    const netstat = await execFileAsync("netstat", ["-ano"], { maxBuffer: 8 * 1024 * 1024 });
    const pids = parseListeningPids(netstat.stdout, port);
    if (pids.length === 0) return [];
    const filter = pids.map(pid => `ProcessId=${pid}`).join(" OR ");
    const script = `(Get-CimInstance Win32_Process -Filter "${filter}") | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`;
    const list = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script]);
    const rows = parseProcessList(list.stdout);
    return pids.map(pid => ({ pid, commandLine: rows.find(row => row.pid === pid)?.commandLine ?? "(no command line readable)" }));
  }
  const lsof = await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  const pids = lsof.stdout.split(/\s+/).map(Number).filter(Number.isInteger);
  if (pids.length === 0) return [];
  const ps = await execFileAsync("ps", ["-p", pids.join(","), "-o", "pid=,args="]);
  const rows = ps.stdout.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    const space = trimmed.indexOf(" ");
    return { pid: Number(trimmed.slice(0, space)), commandLine: trimmed.slice(space + 1) };
  });
  return pids.map(pid => ({ pid, commandLine: rows.find(row => row.pid === pid)?.commandLine ?? "" }));
}

async function killPidTree(pid) {
  if (IS_WIN) {
    const result = await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]);
    return result.ok;
  }
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

/** pid -> ppid map of every running process (works from ParentProcessId records even when the parent is already dead). */
async function processTable() {
  const table = new Map();
  if (IS_WIN) {
    const result = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      '(Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)" })'
    ]);
    for (const line of result.stdout.split(/\r?\n/)) {
      const [pid, ppid] = line.split("|").map(Number);
      if (Number.isInteger(pid) && Number.isInteger(ppid)) table.set(pid, ppid);
    }
    return table;
  }
  const result = await execFileAsync("ps", ["-eo", "pid=", "ppid="]);
  for (const line of result.stdout.split(/\r?\n/)) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(pid) && Number.isInteger(ppid)) table.set(pid, ppid);
  }
  return table;
}

/** All PIDs whose ancestor chain reaches rootPid (excluding rootPid itself). */
async function collectDescendants(rootPid) {
  const table = await processTable();
  const byParent = new Map();
  for (const [pid, ppid] of table) {
    if (!byParent.has(ppid)) byParent.set(ppid, []);
    byParent.get(ppid).push(pid);
  }
  const descendants = [];
  const queue = [rootPid];
  const seen = new Set([rootPid]);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const child of byParent.get(current) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      descendants.push(child);
      queue.push(child);
    }
  }
  return descendants;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function signalPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function checkNode() {
  const verdict = nodeVersionVerdict(process.version);
  if (verdict.level === "block") {
    logFail(verdict.message);
    process.exit(1);
  }
  if (verdict.level === "warn") logWarn(verdict.message);
  else log(`node        ${verdict.message}`);
}

async function checkDependencies() {
  const modules = path.join(ROOT, "node_modules");
  const lock = path.join(ROOT, "package-lock.json");
  if (!existsSync(modules)) {
    log("node_modules is missing.");
    const answer = await ask("Run `npm install` now?", { defaultYes: true });
    if (!confirm(answer, { defaultYes: true })) {
      logFail("cannot start without node_modules - run `npm install` and rerun.");
      process.exit(1);
    }
    const install = spawn(NPM, ["install"], { cwd: ROOT, stdio: "inherit", shell: IS_WIN });
    const code = await new Promise(resolve => install.on("exit", resolve));
    if (code !== 0) {
      logFail(`npm install failed (exit ${code}).`);
      process.exit(1);
    }
  }
  if (!existsSync(lock)) {
    logWarn("package-lock.json is missing - installs will not be reproducible.");
  } else {
    const installed = path.join(modules, ".package-lock.json");
    if (existsSync(installed) && statSync(lock).mtimeMs > statSync(installed).mtimeMs) {
      log("package-lock.json is newer than the last install (possibly stale).");
      const answer = await ask("Run `npm install` now?");
      if (confirm(answer)) {
        const install = spawn(NPM, ["install"], { cwd: ROOT, stdio: "inherit", shell: IS_WIN });
        const code = await new Promise(resolve => install.on("exit", resolve));
        if (code !== 0) {
          logFail(`npm install failed (exit ${code}).`);
          process.exit(1);
        }
      } else {
        log("continuing with the existing install (possibly stale).");
      }
    }
  }
  log("deps       node_modules present" + (existsSync(lock) ? ", package-lock.json present" : ""));
}

async function checkGitTree() {
  const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: ROOT });
  if (!status.ok) {
    logFail(`git status unavailable (${status.stderr.trim() || "unknown error"}) - refusing to start blind.`);
    process.exit(1);
  }
  const lines = status.stdout.split(/\r?\n/).filter(line => line.trim() !== "");
  if (lines.length > 0) {
    log(`git tree is DIRTY (${lines.length} entr${lines.length === 1 ? "y" : "ies"}):`);
    for (const line of lines.slice(0, 20)) console.log(`  ${line}`);
    if (lines.length > 20) console.log(`  ... and ${lines.length - 20} more`);
    log("A dirty tree can be normal mid-dev - but if you did not make these changes,");
    log("this may be a second session (AGENTS.md:22: one worktree, one session).");
    const answer = await ask("Continue with the dirty tree?");
    if (!confirm(answer)) {
      logFail("aborted: dirty tree not confirmed.");
      process.exit(1);
    }
  }
  log(`git tree   ${lines.length === 0 ? "clean" : "dirty (confirmed by you)"}`);
}

async function checkConfig(apiPort) {
  const wranglerToml = path.join(ROOT, "services", "data-api", "wrangler.toml");
  if (!existsSync(wranglerToml)) {
    logFail("services/data-api/wrangler.toml is missing - wrangler dev cannot start. Restore it from git.");
    process.exit(1);
  }
  const toml = readFileSync(wranglerToml, "utf8");
  if (!/^\s*compatibility_date\s*=/m.test(toml)) {
    logWarn("wrangler.toml has no compatibility_date (the repo pins one as the deploy/local contract).");
  }
  const devVars = path.join(ROOT, "services", "data-api", ".dev.vars");
  log(
    `config     wrangler.toml present, no secrets required (public Binance API)` +
      (existsSync(devVars) ? ", .dev.vars present" : "")
  );
  const override = process.env.VITE_DATA_API_URL;
  const overridePort = override ? portFromUrl(override) : null;
  if (override && overridePort === null) {
    logWarn(`VITE_DATA_API_URL="${override}" is not parseable - the web app will fail to reach the API.`);
  }
  const effectiveApiPort = overridePort ?? apiPort;
  if (override) log(`env        VITE_DATA_API_URL=${override} (API port assumed ${effectiveApiPort})`);
  const configApiPort = extractWranglerDevPort(toml);
  if (configApiPort !== null && configApiPort !== effectiveApiPort) {
    logWarn(`wrangler.toml [dev] port=${configApiPort} differs from ${effectiveApiPort} - pre-flight checked ${effectiveApiPort}.`);
  }
  return effectiveApiPort;
}

async function handlePort(port, name, service) {
  if (!(await portInUse(port))) {
    log(`port ${port}   free (${name})`);
    return;
  }
  const owners = await portOwners(port);
  if (owners.length === 0) {
    logFail(`port ${port} (${name}) is in use, but no owning process could be identified. Stop it manually and rerun.`);
    process.exit(1);
  }
  const ours = owners.filter(owner => classifyOwner(owner.commandLine, ROOT) === "ours");
  if (ours.length < owners.length) {
    const foreign = owners.find(owner => classifyOwner(owner.commandLine, ROOT) !== "ours");
    logFail(`port ${port} (${name}) is used by PID ${foreign.pid}: ${foreign.commandLine || "(no command line)"}`);
    logFail("This does not look like it was started from this working directory, so it will not be touched.");
    logFail("Stop it manually and rerun.");
    process.exit(1);
  }
  log(`port ${port}   USED by this repo's process(es): ${owners.map(owner => `PID ${owner.pid} (${owner.commandLine || "?"})`).join(", ")}`);
  log("This is the AGENTS.md:22 scenario (one worktree, one session): a leftover dev");
  log("server from a prior run, or a second session already active in this worktree.");
  const answer = await ask("Kill it and start fresh [k], reuse the running instance [r], or abort [a]?");
  const choice = (answer ?? "").toLowerCase();
  if (choice === "k" || choice.startsWith("kill")) {
    for (const owner of owners) {
      log(`killing PID ${owner.pid} (tree)...`);
      await killPidTree(owner.pid);
    }
    if (!(await waitForPortFree(port))) {
      logFail(`port ${port} is still in use after the kill - stop it manually and rerun.`);
      process.exit(1);
    }
    log(`port ${port}   free after cleanup`);
    return;
  }
  if (choice === "r" || choice.startsWith("re")) {
    const hit = await probe(service.probeUrls);
    if (hit === null) {
      logFail(`port ${port} is occupied but ${service.probeUrls.join(", ")} does not respond - cannot reuse. Abort.`);
      process.exit(1);
    }
    service.reused = true;
    log(`port ${port}   reusing the running instance (HTTP ${hit.status} at ${hit.url}) - it will be left running on exit`);
    return;
  }
  logFail("aborted (port in use, no decision).");
  process.exit(1);
}

function labelLines(child, svc) {
  const stripAnsi = text => text.replace(/\x1b\[[0-9;]*m/g, "");
  const attach = stream => {
    let buffer = "";
    stream.on("data", chunk => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        svc.logTail.push(line);
        if (svc.logTail.length > 40) svc.logTail.shift();
        const plain = stripAnsi(line);
        if (svc.readyBanner === null && svc.readyPatterns.some(pattern => pattern.test(plain))) {
          svc.readyBanner = plain.trim();
        }
        console.log(`[${svc.name}] ${line}`);
      }
    });
    stream.on("end", () => {
      if (buffer.trim() !== "") {
        svc.logTail.push(buffer);
        console.log(`[${svc.name}] ${buffer}`);
      }
    });
  };
  attach(child.stdout);
  attach(child.stderr);
}

function printLogTail(svc) {
  console.log(`--- last output from ${svc.name} ---`);
  for (const line of svc.logTail) console.log(`[${svc.name}] ${line}`);
  console.log("--- end ---");
}

async function waitReady(svc) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (svc.exited) return { ok: false, reason: `${svc.name} exited during startup` };
    const hit = await probe(svc.probeUrls);
    if (hit !== null) {
      return { ok: true, via: svc.readyBanner ?? `HTTP ${hit.status} via ${hit.url} (ready banner not seen)`, status: hit.status };
    }
    await sleep(400);
  }
  return { ok: false, reason: `no response on ${svc.probeUrls.join(", ")} after ${READY_TIMEOUT_MS / 1000}s` };
}

let shuttingDown = false;
let services = [];

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`shutting down (${reason})...`);
  const targets = services.filter(svc => !svc.reused && svc.child && Number.isInteger(svc.child.pid));
  let orphaned = false;

  // Snapshot EVERY process in each tree before signaling: on Windows the
  // npm/cmd wrapper dies instantly from SIGINT while vite/wrangler/workerd
  // would silently survive it as orphans.
  for (const svc of targets) {
    svc.tree = [svc.child.pid, ...(await collectDescendants(svc.child.pid))];
  }
  for (const svc of targets) {
    if (!svc.exited) {
      try {
        svc.child.kill("SIGINT");
      } catch {
        // already gone
      }
    }
    for (const pid of svc.tree) await signalPid(pid, "SIGINT");
  }
  const aliveCount = () => targets.reduce((count, svc) => count + svc.tree.filter(isAlive).length, 0);
  const graceDeadline = Date.now() + SHUTDOWN_GRACE_MS;
  while (Date.now() < graceDeadline && aliveCount() > 0) await sleep(100);
  const survivors = targets.flatMap(svc => svc.tree).filter(isAlive);
  if (survivors.length > 0) {
    log(`process(es) ignored SIGINT after ${SHUTDOWN_GRACE_MS / 1000}s - force-stopping ${survivors.length}: ${survivors.join(", ")}`);
    for (const pid of survivors) await killPidTree(pid);
    const forceDeadline = Date.now() + 3000;
    while (Date.now() < forceDeadline && aliveCount() > 0) await sleep(100);
  }

  for (const svc of targets) {
    const alive = svc.tree.filter(isAlive);
    if (alive.length > 0) {
      orphaned = true;
      logFail(`${svc.label}: process(es) still alive after shutdown: ${alive.join(", ")} - stop them manually.`);
    }
    if (!(await waitForPortFree(svc.port, 4000))) {
      orphaned = true;
      const owners = await portOwners(svc.port);
      logFail(`port ${svc.port} is still in use after stopping ${svc.name}: ${owners.map(owner => `PID ${owner.pid}`).join(", ") || "owner unknown"}`);
    } else {
      log(`port ${svc.port} free (${svc.name})`);
    }
  }
  const reused = services.filter(svc => svc.reused);
  if (reused.length > 0) log(`reused instance(s) left running: ${reused.map(svc => `${svc.name} :${svc.port}`).join(", ")}`);
  if (orphaned) {
    logFail("shutdown completed WITH orphan warnings - see above.");
  } else {
    log("shutdown complete: no orphaned processes on this script's ports.");
  }
}

function startService(svc) {
  svc.child = spawn(svc.cmd, svc.args, {
    cwd: svc.cwd ?? ROOT,
    env: { ...process.env, ...(svc.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
    shell: IS_WIN,
    windowsHide: true
  });
  labelLines(svc.child, svc);
  svc.child.on("exit", (code, signal) => {
    svc.exited = true;
    if (shuttingDown) return;
    logFail(`${svc.label} exited unexpectedly (code ${code}, signal ${signal ?? "-"}).`);
    printLogTail(svc);
    shutdown(`crash: ${svc.name}`).then(() => process.exit(1));
  });
  svc.child.on("error", error => {
    svc.exited = true;
    if (shuttingDown) return;
    logFail(`${svc.label} failed to spawn: ${error.message}`);
    shutdown(`spawn error: ${svc.name}`).then(() => process.exit(1));
  });
}

async function main() {
  log("dev:all - pre-flight");
  checkNode();
  await checkDependencies();
  await checkGitTree();

  const viteConfigPath = path.join(ROOT, "apps", "web", "vite.config.ts");
  const vitePort = existsSync(viteConfigPath) ? extractVitePort(readFileSync(viteConfigPath, "utf8")) ?? DEFAULT_VITE_PORT : DEFAULT_VITE_PORT;
  const apiPort = await checkConfig(DEFAULT_API_PORT);

  const webService = {
    name: "web",
    label: "web (vite)",
    port: vitePort,
    cmd: NPM,
    args: ["run", "dev", "--workspace", "@trading-research/web"],
    probeUrls: [`http://127.0.0.1:${vitePort}/`, `http://[::1]:${vitePort}/`],
    readyPatterns: [/ready in \d+ ms/i, /Local:\s+https?:\/\/\S+/i],
    readyBanner: null,
    logTail: [],
    exited: false,
    reused: false
  };
  const apiService = {
    name: "api",
    label: "data-api (wrangler)",
    port: apiPort,
    cmd: NPM,
    args: ["run", "dev", "--workspace", "@trading-research/data-api"],
    probeUrls: [
      `http://127.0.0.1:${apiPort}/klines?symbol=BTCUSDT`,
      `http://[::1]:${apiPort}/klines?symbol=BTCUSDT`
    ],
    readyPatterns: [/Ready on\s+https?:\/\/\S+/i],
    readyBanner: null,
    logTail: [],
    exited: false,
    reused: false
  };
  services = [apiService, webService];

  await handlePort(webService.port, "web (vite)", webService);
  await handlePort(apiService.port, "data-api (wrangler)", apiService);

  log("pre-flight passed: node, deps, git tree, ports, config");
  log("starting services (output labeled [api]/[web])...");

  if (!apiService.reused) startService(apiService);
  if (!webService.reused) startService(webService);

  const readyApi = await waitReady(apiService);
  const readyWeb = await waitReady(webService);
  if (!readyApi.ok || !readyWeb.ok) {
    if (!readyApi.ok) { logFail(`data-api not ready: ${readyApi.reason}`); if (apiService.logTail.length) printLogTail(apiService); }
    if (!readyWeb.ok) { logFail(`web not ready: ${readyWeb.reason}`); if (webService.logTail.length) printLogTail(webService); }
    await shutdown("startup failure");
    process.exit(1);
  }

  const verdict = nodeVersionVerdict(process.version);
  console.log("");
  log("== environment up ======================================");
  log(`web     http://localhost:${webService.port}   ${readyWeb.via}${webService.reused ? " (reused)" : ""}`);
  log(`data-api http://127.0.0.1:${apiService.port}   ${readyApi.via}${apiService.reused ? " (reused)" : ""}`);
  log(`node    ${process.version}${verdict.level === "ok" ? "" : ` (${verdict.level}: ${verdict.message})`}`);
  log("checks  node, deps, git tree, ports, config - all passed");
  log("stop    Ctrl+C stops both services and verifies both ports are released");
  console.log("");

  await new Promise(() => {}); // supervised by child exit handlers + signal handlers
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (activePrompt) {
      log(`\n${signal} during prompt - aborting before anything starts.`);
      activePrompt.abort();
      process.exit(130);
    }
    shutdown(signal).then(() => process.exit(0));
  });
}

main().catch(error => {
  logFail(`unexpected error: ${error?.stack ?? error}`);
  process.exit(1);
});
