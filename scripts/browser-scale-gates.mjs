import { createServer } from "node:http";
import { createReadStream, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";

const ROOT = new URL("../dist/", import.meta.url).pathname;
const chromeCandidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => existsSync(candidate));
if (!chrome) throw new Error("Chrome/Chromium is required for browser scale gates");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};
let activeFixture = { nodes: 30, soak: false, run: "startup" };
const requestCounts = new Map();

function count(label) {
  const counts = requestCounts.get(activeFixture.run) ?? {};
  counts[label] = (counts[label] ?? 0) + 1;
  requestCounts.set(activeFixture.run, counts);
}

function nodeList(size) {
  return Array.from({ length: size }, (_, index) => ({
    uuid: `node-${index}`,
    name: `Scale Node ${index}`,
    group: `Group ${index % 8}`,
    region: `R${index % 16}`,
    hidden: false,
    mem_total: 2_147_483_648,
    disk_total: 21_474_836_480,
    weight: index,
    os: "linux",
    arch: "amd64",
    traffic_limit: 1_000_000_000_000,
  }));
}

function report(index, sequence) {
  return {
    online: true,
    cpu: { usage: (index + sequence) % 100 },
    ram: { used: 536_870_912 + ((index + sequence) % 100) * 1_048_576, total: 2_147_483_648 },
    swap: { used: 0, total: 0 },
    disk: { used: 5_368_709_120, total: 21_474_836_480 },
    load: { load1: 0.5, load5: 0.4, load15: 0.3 },
    network: {
      up: sequence * 100 + index,
      down: sequence * 120 + index,
      totalUp: sequence * 1_000 + index,
      totalDown: sequence * 2_000 + index,
    },
    connections: { tcp: 10, udp: 2 },
    uptime: sequence,
    process: 20,
    updated_at: 1_700_000_000 + sequence,
  };
}

function sendJson(response, body) {
  response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://fixture.local");
  if (url.pathname === "/api/nodes") {
    count("nodes");
    return sendJson(response, nodeList(activeFixture.nodes));
  }
  if (url.pathname === "/api/public") {
    count("public");
    return sendJson(response, {
      sitename: "Komari Scale Gate",
      theme: "LuminaPlus",
      theme_settings: {
        showHomeOverview: false,
        showGroupTabs: false,
        desktopNodeViewMode: "compact",
        homepagePingBindings: { "1": nodeList(activeFixture.nodes).map((node) => node.uuid) },
      },
    });
  }
  if (url.pathname === "/api/me") {
    count("me");
    return sendJson(response, { logged_in: false, username: "", uuid: "" });
  }
  if (url.pathname === "/api/rpc2" && request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    count(`rpc:${payload.method}`);
    let result = {};
    if (payload.method === "rpc.discover") {
      result = {
        jsonrpc_version: "2.0",
        contract: "komari.rpc.v2.4",
        methods: ["common:getRealtimeDelta", "common:getPingOverview"],
        capabilities: { "realtime.delta": "1", "ping.overview": "2" },
      };
    } else if (payload.method === "common:getRealtimeDelta") {
      const since = Number(payload.params?.since ?? 0);
      const sequence = since + 1;
      const reports = {};
      if (since === 0 || (activeFixture.soak && since < 1_800)) {
        for (let index = 0; index < activeFixture.nodes; index += 1) {
          reports[`node-${index}`] = report(index, sequence);
        }
      }
      result = {
        sequence,
        snapshot: since === 0,
        reports,
        online: since === 0 ? nodeList(activeFixture.nodes).map((node) => node.uuid) : undefined,
      };
      if (!activeFixture.soak && since > 0) await new Promise((resolve) => setTimeout(resolve, 250));
      if (activeFixture.soak && since >= 1_800) await new Promise((resolve) => setTimeout(resolve, 250));
    } else if (payload.method === "common:getPingOverview") {
      const to = Math.floor(Date.now() / 1_000);
      const stats = {};
      const series = {};
      for (let index = 0; index < activeFixture.nodes; index += 1) {
        const uuid = `node-${index}`;
        stats[uuid] = { "1": { name: "edge", total: 60, lost: 1, latest: 20 + (index % 30), avg: 25, tail: 0.2, loss: 1.67, min: 10, max: 80 } };
        series[uuid] = { "1": Array.from({ length: 24 }, (_, point) => ({
          time: to - (23 - point) * 150,
          value: 20 + ((index + point) % 30),
          sample_count: 2,
          loss_count: point === 11 ? 1 : 0,
          loss: point === 11 ? 50 : 0,
        })) };
      }
      result = { from: to - 3_600, to, tasks: [{ id: 1, name: "edge", type: "icmp", interval: 60 }], stats, series };
    }
    return sendJson(response, { jsonrpc: "2.0", id: payload.id, result });
  }

  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const safePath = normalize(join(ROOT, requested));
  const path = safePath.startsWith(normalize(ROOT)) && existsSync(safePath)
    ? safePath
    : join(ROOT, "index.html");
  response.writeHead(200, {
    "Content-Type": mime[extname(path)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(path).pipe(response);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("fixture server did not bind TCP");
const browserPort = 10_000 + Math.floor(Math.random() * 40_000);
const profile = mkdtempSync(join(tmpdir(), "lumina-browser-gate-"));
const child = spawn(chrome, [
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  `--remote-debugging-port=${browserPort}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErrors = "";
child.stderr.on("data", (chunk) => { chromeErrors += chunk.toString(); });

async function waitForDebugger() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${browserPort}/json/list`).then((result) => result.json());
      const page = pages.find((item) => item.type === "page" && !String(item.url).startsWith("chrome-extension:"));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Chrome DevTools did not start: ${chromeErrors.slice(-1_000)}`);
}

class CDP {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  call(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async value(expression) {
    const result = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

async function waitUntil(cdp, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.value(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const diagnostics = await cdp.value(`({
    text: document.body?.innerText?.slice(0, 600),
    cards: document.querySelectorAll('.home-node-card-slot').length,
    rows: document.querySelectorAll('.node-list-row').length,
    url: location.href
  })`);
  throw new Error(`browser condition timed out: ${expression}; ${JSON.stringify(diagnostics)}`);
}

const results = [];
let cdp;
try {
  cdp = new CDP(await waitForDebugger());
  await cdp.open();
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("HeapProfiler.enable");

  for (const [nodes, budgetMs] of [[30, 4_000], [300, 6_000], [1_000, 12_000]]) {
    const run = `scale-${nodes}`;
    activeFixture = { nodes, soak: false, run };
    requestCounts.set(run, {});
    await cdp.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/?fixture=${nodes}` });
    await waitUntil(cdp, `document.querySelectorAll('.home-node-card-slot').length === ${nodes}`, budgetMs);
    await waitUntil(cdp, "document.querySelectorAll('.ping-task-sparkline-line').length > 0", budgetMs);
    const metrics = await cdp.value(`(() => ({
      renderMs: performance.now(),
      cards: document.querySelectorAll('.home-node-card-slot').length,
      canvases: document.querySelectorAll('canvas').length,
      activeCanvases: document.querySelectorAll('canvas[data-render-active="true"]').length,
      pingTrendLines: document.querySelectorAll('.ping-task-sparkline-line').length,
      emptyPingTrends: document.querySelectorAll('.ping-task-sparkline-empty').length,
      contentVisibility: getComputedStyle(document.querySelector('.home-node-card-slot')).contentVisibility,
      bodyWidth: document.body.scrollWidth
    }))()`);
    if (metrics.renderMs > budgetMs) throw new Error(`${nodes}-node render ${metrics.renderMs}ms > ${budgetMs}ms`);
    if (nodes >= 300 && metrics.contentVisibility !== "auto") {
      throw new Error(`${nodes}-node browser card virtualization is disabled`);
    }
    if (nodes >= 300 && metrics.canvases > 0 && metrics.activeCanvases >= metrics.canvases) {
      throw new Error(`${nodes}-node browser did not suspend offscreen canvases`);
    }
    if (metrics.pingTrendLines === 0 || metrics.emptyPingTrends !== 0) {
      throw new Error(`${nodes}-node Ping trend regression: lines=${metrics.pingTrendLines}, empty=${metrics.emptyPingTrends}`);
    }
    const counts = requestCounts.get(run) ?? {};
    if ((counts.nodes ?? 0) !== 1) throw new Error(`${nodes}-node /api/nodes count=${counts.nodes ?? 0}`);
    if ((counts["rpc:common:getPingOverview"] ?? 0) > 1) throw new Error(`${nodes}-node Ping overview fanned out`);
    if (counts["rpc:common:getNodesLatestStatus"]) throw new Error(`${nodes}-node legacy status poll was used`);
    results.push({ nodes, ...metrics, requests: counts });
  }

  activeFixture = { nodes: 30, soak: true, run: "soak-30" };
  requestCounts.set(activeFixture.run, {});
  await cdp.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/?fixture=30&soak=1` });
  await waitUntil(cdp, "document.querySelectorAll('.home-node-card-slot').length === 30", 4_000);
  await cdp.call("HeapProfiler.collectGarbage");
  const heapBefore = await cdp.call("Runtime.getHeapUsage");
  const soakDeadline = Date.now() + 15_000;
  while ((requestCounts.get("soak-30")?.["rpc:common:getRealtimeDelta"] ?? 0) < 1_800 && Date.now() < soakDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if ((requestCounts.get("soak-30")?.["rpc:common:getRealtimeDelta"] ?? 0) < 1_800) {
    throw new Error("browser soak did not finish");
  }
  await cdp.call("HeapProfiler.collectGarbage");
  const heapAfter = await cdp.call("Runtime.getHeapUsage");
  const heapGrowth = heapAfter.usedSize - heapBefore.usedSize;
  if (heapGrowth > 16 * 1024 * 1024) throw new Error(`browser soak heap grew ${heapGrowth} bytes`);
  results.push({ soakTicks: 1_800, heapBefore: heapBefore.usedSize, heapAfter: heapAfter.usedSize, heapGrowth });

  console.log(JSON.stringify(results, null, 2));
} finally {
  cdp?.close();
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
