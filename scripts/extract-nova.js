#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { NovaParse } = require(path.join(__dirname, "..", "vendor", "novaparse", "build", "NovaParse.js"));

const evnRoot = process.env.EVN_ROOT || "C:/Users/Isaac/EV Nova";
const outputRoot = path.resolve(process.env.EVN_OUTPUT || path.join(__dirname, "..", "parsed-data"));
const bridgedSourceRoot = path.join(outputRoot, "novaparse-source");
const sourceRoot = path.resolve(process.env.NOVAPARSE_SOURCE || (fs.existsSync(bridgedSourceRoot) ? bridgedSourceRoot : path.join(outputRoot, "nova-source")));

function toJsonValue(value, seen = new WeakSet(), options = {}) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return Number(value);
    return value;
  }
  if (value instanceof DataView) {
    return options.includeData === false ? { byteLength: value.byteLength } : Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (Buffer.isBuffer(value)) return Array.from(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => toJsonValue(item, seen, options));
  const result = {};
  for (const key of Object.keys(value)) {
    if (key === "idSpace") {
      result[key] = "[Resource ID space omitted]";
      continue;
    }
    try {
      result[key] = toJsonValue(value[key], seen, options);
    } catch (error) {
      result[key] = `[Error: ${error.message}]`;
    }
  }
  return result;
}

function copyNovaSources() {
  if (fs.existsSync(sourceRoot)) fs.rmSync(sourceRoot, { recursive: true, force: true });
  fs.mkdirSync(sourceRoot, { recursive: true });
  const novaFiles = path.join(evnRoot, "Nova Files");
  const plugins = path.join(evnRoot, "Plug-ins");
  const stagedNovaFiles = path.join(sourceRoot, "Nova Files");
  fs.mkdirSync(stagedNovaFiles);
  for (const name of fs.readdirSync(novaFiles)) {
    if (!/^Nova Data \d+\.rez$/i.test(name)) continue;
    const source = path.join(novaFiles, name);
    const targetName = name.toLowerCase().endsWith(".rez") ? `${name.slice(0, -4)}.ndat` : name;
    fs.cpSync(source, path.join(stagedNovaFiles, targetName), { recursive: true });
  }
  if (fs.existsSync(plugins)) fs.cpSync(plugins, path.join(sourceRoot, "Plug-ins"), { recursive: true });
  else fs.mkdirSync(path.join(sourceRoot, "Plug-ins"));
}

function writeFormatReport() {
  const dataFiles = fs.readdirSync(path.join(evnRoot, "Nova Files"))
    .filter(name => /^Nova Data \d+\.rez$/i.test(name))
    .map(name => {
      const filePath = path.join(evnRoot, "Nova Files", name);
      const header = fs.readFileSync(filePath).subarray(0, 16).toString("ascii");
      return { name, size: fs.statSync(filePath).size, headerAscii: header, headerHex: Buffer.from(header, "ascii").toString("hex") };
    });
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, "format-report.json"), JSON.stringify({
    evnRoot,
    parser: "NovaParse",
    supportedInput: ["Mac resource fork", ".ndat"],
    detectedInput: "EV Nova Windows BurgerLib .rez",
    reason: "NovaParse/resourceforkjs reads classic Mac resource-fork headers. Windows EVN .rez files begin with BRGR and require BurgerLib container decoding first.",
    files: dataFiles
  }, null, 2) + "\n");
}

async function main() {
  if (!fs.existsSync(path.join(evnRoot, "Nova Files"))) {
    throw new Error(`EVN Nova Files directory not found: ${evnRoot}`);
  }
  writeFormatReport();
  if (!process.env.NOVAPARSE_SOURCE && !fs.existsSync(bridgedSourceRoot)) copyNovaSources();
  fs.mkdirSync(outputRoot, { recursive: true });

  const parser = new NovaParse(sourceRoot, false);
  const idSpace = await parser.idSpace;
  if (idSpace instanceof Error) throw idSpace;

  const resources = {};
  for (const [resourceType, entries] of Object.entries(idSpace)) {
    resources[resourceType] = {};
    for (const [globalId, resource] of Object.entries(entries)) {
      resources[resourceType][globalId] = toJsonValue(resource, new WeakSet(), { includeData: false });
    }
  }
  fs.writeFileSync(path.join(outputRoot, "resources.json"), JSON.stringify(resources, null, 2) + "\n");

  const normalized = {};
  const normalizedTypes = {
    Ship: parser.data.Ship,
    Outfit: parser.data.Outfit,
    Weapon: parser.data.Weapon,
    Planet: parser.data.Planet,
    System: parser.data.System,
    Explosion: parser.data.Explosion
  };
  for (const [type, gettable] of Object.entries(normalizedTypes)) {
    normalized[type] = {};
    for (const id of await parser.ids.then(ids => ids[type] || [])) {
      try {
        normalized[type][id] = toJsonValue(await gettable.get(id));
      } catch (error) {
        normalized[type][id] = { parseError: error.message };
      }
    }
  }
  fs.writeFileSync(path.join(outputRoot, "normalized.json"), JSON.stringify(normalized, null, 2) + "\n");

  const summary = Object.fromEntries(Object.entries(resources).map(([type, values]) => [type, Object.keys(values).length]));
  fs.writeFileSync(path.join(outputRoot, "summary.json"), JSON.stringify({ evnRoot, sourceRoot, counts: summary }, null, 2) + "\n");
  console.log(JSON.stringify({ outputRoot, counts: summary }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
