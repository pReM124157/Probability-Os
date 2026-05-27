import fs from "fs";
import path from "path";

const ROOT = path.basename(process.cwd()) === "backend"
  ? process.cwd()
  : path.resolve(process.cwd(), "backend");
const SRC = path.join(ROOT, "src");
const OUT_DIR = path.join(ROOT, "artifacts", "validation");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function collectRoutes(files) {
  const routes = [];
  const routeFileRegex = /src\/routes\/.*\.js$/;
  const methodRegex = /\b(router|app)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g;

  for (const file of files.filter((f) => routeFileRegex.test(f))) {
    const text = read(file);
    let m;
    while ((m = methodRegex.exec(text))) {
      routes.push({ file: rel(file), method: m[2].toUpperCase(), path: m[3] });
    }
  }
  return routes;
}

function collectSchedulers(files) {
  const schedulers = [];
  const cronRegex = /cron\.schedule\(\s*["'`]([^"'`]+)["'`]/g;
  for (const file of files.filter((f) => f.includes("/src/scheduler/") && f.endsWith(".js"))) {
    const text = read(file);
    let m;
    while ((m = cronRegex.exec(text))) {
      schedulers.push({ file: rel(file), cron: m[1] });
    }
  }
  return schedulers;
}

function collectTelegramHandlers(files) {
  const handlers = [];
  const tgRegex = /\bbot\.(command|action|on|hears)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  for (const file of files.filter((f) => f.endsWith("telegram.service.js") || f.includes("dailyHook.scheduler") || f.includes("spikeHook.scheduler"))) {
    const text = read(file);
    let m;
    while ((m = tgRegex.exec(text))) {
      handlers.push({ file: rel(file), type: m[1], trigger: m[2] });
    }
  }
  return handlers;
}

function collectEnvKeys(files) {
  const keys = new Set();
  const envRegex = /process\.env\.([A-Z0-9_]+)/g;
  for (const file of files.filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))) {
    const text = read(file);
    let m;
    while ((m = envRegex.exec(text))) keys.add(m[1]);
  }
  return [...keys].sort();
}

function collectDbTables(files) {
  const tables = new Set();
  const tableRegex = /\.from\(\s*["'`]([a-zA-Z0-9_]+)["'`]\s*\)/g;
  for (const file of files.filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))) {
    const text = read(file);
    let m;
    while ((m = tableRegex.exec(text))) tables.add(m[1]);
  }
  return [...tables].sort();
}

function collectImports(files) {
  const graph = [];
  const importRegex = /import\s+[^"']*["']([^"']+)["']/g;
  for (const file of files.filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))) {
    const text = read(file);
    let m;
    while ((m = importRegex.exec(text))) {
      const target = m[1];
      if (target.startsWith(".")) {
        const resolved = path.normalize(path.join(path.dirname(file), target));
        graph.push({ from: rel(file), to: rel(resolved.endsWith(".js") || resolved.endsWith(".mjs") ? resolved : `${resolved}.js`) });
      }
    }
  }
  return graph;
}

function collectByDir(files, dir) {
  return files
    .filter((f) => f.includes(`/src/${dir}/`) && f.endsWith(".js"))
    .map((f) => rel(f))
    .sort();
}

function collectApiDomains(files) {
  const domains = new Set();
  const urlRegex = /https?:\/\/([a-zA-Z0-9.-]+)/g;
  for (const file of files.filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))) {
    const text = read(file);
    let m;
    while ((m = urlRegex.exec(text))) domains.add(m[1]);
  }
  return [...domains].sort();
}

const files = walk(SRC);
const inventory = {
  generatedAt: new Date().toISOString(),
  routes: collectRoutes(files),
  schedulers: collectSchedulers(files),
  telegramHandlers: collectTelegramHandlers(files),
  dbTablesReferenced: collectDbTables(files),
  envKeysReferenced: collectEnvKeys([...files, ...walk(path.join(ROOT, "tests"))]),
  agents: collectByDir(files, "agents"),
  scanners: collectByDir(files, "scanner"),
  queues: collectByDir(files, "queues"),
  services: collectByDir(files, "services"),
  thirdPartyDomainsReferenced: collectApiDomains(files),
  dependencyEdges: collectImports(files)
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const jsonPath = path.join(OUT_DIR, "phase1_inventory.json");
fs.writeFileSync(jsonPath, JSON.stringify(inventory, null, 2));

const md = [
  "# Phase 1 Static Inventory",
  "",
  `Generated: ${inventory.generatedAt}`,
  "",
  `- Routes: ${inventory.routes.length}`,
  `- Schedulers: ${inventory.schedulers.length}`,
  `- Telegram handlers: ${inventory.telegramHandlers.length}`,
  `- DB tables referenced: ${inventory.dbTablesReferenced.length}`,
  `- ENV keys referenced: ${inventory.envKeysReferenced.length}`,
  `- Agents: ${inventory.agents.length}`,
  `- Scanner modules: ${inventory.scanners.length}`,
  `- Queue modules: ${inventory.queues.length}`,
  "",
  "## Key Outputs",
  "",
  "- `artifacts/validation/phase1_inventory.json`",
  "- Use `dependencyEdges` from JSON to render graph in Mermaid/Graphviz.",
  ""
].join("\n");
fs.writeFileSync(path.join(OUT_DIR, "phase1_inventory.md"), md);

console.log(`Phase 1 inventory generated at ${jsonPath}`);
