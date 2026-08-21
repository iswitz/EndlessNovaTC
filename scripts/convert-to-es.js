#!/usr/bin/env node

/* Convert NovaParse output into an Endless Sky plugin and preserve every EVN type. */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { PNG } = require("pngjs");

const root = path.resolve(process.env.EVN_OUTPUT || path.join(__dirname, "..", "parsed-data"));
const output = path.resolve(process.env.ES_OUTPUT || path.join(__dirname, "..", "converted-plugin"));
const normalized = JSON.parse(fs.readFileSync(path.join(root, "normalized.json"), "utf8"));
const resources = JSON.parse(fs.readFileSync(path.join(root, "resources.json"), "utf8"));
function readJsonFile(file) {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const compressed = `${file}.gz`;
  if (fs.existsSync(compressed)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(compressed)).toString("utf8"));
  throw new Error(`Missing JSON input: ${file} or ${compressed}`);
}
const burger = readJsonFile(path.join(root, "burger-resources.json"));
const referencePath = path.join(__dirname, "..", "reference", "evntoes", "parsedData", "evndata.json");
const referenceData = fs.existsSync(referencePath) ? JSON.parse(fs.readFileSync(referencePath, "utf8")) : {};
const referenceMissions = referenceData["mïsn"] || [];
const referenceGovernments = referenceData["gövt"] || [];
const referenceDudes = referenceData["düde"] || [];
const referenceFleets = referenceData["flët"] || [];
const EVN_COMMODITIES = [
  { name: "Food", flags: [0x10000000, 0x20000000, 0x40000000], min: 100, max: 600 },
  { name: "Industrial", flags: [0x01000000, 0x02000000, 0x04000000], min: 520, max: 920 },
  { name: "Medical", flags: [0x00100000, 0x00200000, 0x00400000], min: 430, max: 930 },
  { name: "Luxury Goods", flags: [0x00010000, 0x00020000, 0x00040000], min: 920, max: 1520 },
  { name: "Metal", flags: [0x00001000, 0x00002000, 0x00004000], min: 190, max: 590 },
  { name: "Equipment", flags: [0x00000100, 0x00000200, 0x00000400], min: 330, max: 730 }
];
const rawTechCache = new Map();
const stringListCache = new Map();

function mkdir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function write(file, text) { mkdir(path.dirname(file)); fs.writeFileSync(file, text.replace(/\s+$/, "") + "\n"); }
function q(value) {
  return `"${String(value == null ? "" : value).replace(/\\/g, "\\\\").replace(/"/g, "'").replace(/[\r\n]+/g, " ")}"`;
}
function number(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}
function refId(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value !== "string") return null;
  const match = value.match(/:(-?\d+)$/);
  return match ? match[1] : value;
}
function nameOf(type, value) {
  const id = refId(value);
  const candidates = [value, id, id == null ? null : `nova:${id}`].filter(candidate => candidate != null);
  const object = normalized[type] && candidates.map(candidate => normalized[type][candidate]).find(Boolean);
  return object && object.name ? object.name : `${type} ${id == null ? value : id}`;
}
function normalizedOf(type, value) {
  const id = refId(value);
  const candidates = [value, id, id == null ? null : `nova:${id}`].filter(candidate => candidate != null);
  return normalized[type] && candidates.map(candidate => normalized[type][candidate]).find(Boolean);
}
function weaponSoundId(weaponId) {
  const resource = burger.resources.find(item => item.type === "wëap" && String(item.id) === String(refId(weaponId)));
  if (!resource) return null;
  const bytes = Buffer.from(resource.dataBase64, "base64");
  if (bytes.length < 20) return null;
  const value = bytes.readInt16BE(18);
  return value === -1 ? null : value + 200;
}
function planetGovernmentName(planetId) {
  const resource = burger.resources.find(item => item.type === "spöb" && String(item.id) === String(refId(planetId)));
  if (!resource) return null;
  const bytes = Buffer.from(resource.dataBase64, "base64");
  if (bytes.length < 22) return null;
  const governmentId = bytes.readInt16BE(20);
  const government = resources["gövt"] && (resources["gövt"][`nova:${governmentId}`] || resources["gövt"][String(governmentId)]);
  return government && government.name ? safeName(government.name, null) : null;
}
function referencePlanetRecord(planetId) {
  const target = String(refId(planetId));
  return (referenceData["spöb"] || []).find(record => String(record.id) === target) || null;
}
function hexNumber(value, fallback = 0) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return fallback;
  const parsed = Number.parseInt(text.replace(/^0x/i, ""), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function planetRawData(planetId) {
  const reference = referencePlanetRecord(planetId);
  if (reference && reference.data) {
    const data = reference.data;
    return {
      flags: hexNumber(data.Flags),
      tribute: number(data.Tribute, 0),
      techLevel: number(data.TechLevel, 0),
      specialTech: Array.from({ length: 8 }, (_, index) => number(data[`SpecialTech${index + 1}`], -1)),
      government: number(data.Govt, -1),
      defenseDude: number(data.DefDude, -1),
      defenseCount: number(data.DefCount, 0),
      flags2: hexNumber(data.Flags2),
      type: number(data.Type, -1)
    };
  }
  const resource = burger.resources.find(item => item.type === "spöb" && String(item.id) === String(refId(planetId)));
  if (!resource) return null;
  const bytes = Buffer.from(resource.dataBase64, "base64");
  if (bytes.length < 22) return null;
  return {
    flags: bytes.readUInt32BE(6),
    tribute: bytes.readInt16BE(10),
    techLevel: bytes.readInt16BE(12),
    specialTech: [14, 16, 18].map(offset => bytes.readInt16BE(offset)),
    government: bytes.readInt16BE(20),
    defenseDude: bytes.length >= 30 ? bytes.readInt16BE(28) : -1,
    defenseCount: bytes.length >= 32 ? bytes.readInt16BE(30) : 0,
    flags2: bytes.length >= 34 ? bytes.readUInt16BE(32) : 0,
    type: bytes.readInt16BE(4)
  };
}
function systemRawData(systemId) {
  const resource = burger.resources.find(item => item.type === "sÿst" && String(item.id) === String(refId(systemId)));
  if (!resource) return null;
  const bytes = Buffer.from(resource.dataBase64, "base64");
  if (bytes.length < 152) return null;
  return {
    averageShips: bytes.readInt16BE(100),
    government: bytes.readInt16BE(102),
    message: bytes.readInt16BE(104),
    asteroids: bytes.readInt16BE(106),
    interference: bytes.readInt16BE(108),
    murk: bytes.readInt16BE(146),
    asteroidTypes: bytes.readUInt16BE(148),
    visibility: bytes.subarray(150, 250).toString("latin1").split("\0", 1)[0].trim(),
    dudeTypes: Array.from({ length: 8 }, (_, index) => bytes.readInt16BE(68 + index * 2)),
    dudeProbabilities: Array.from({ length: 8 }, (_, index) => bytes.readInt16BE(84 + index * 2)),
    reinforcementFleet: bytes.length >= 408 ? bytes.readInt16BE(406) : -1,
    reinforcementTime: bytes.length >= 410 ? bytes.readInt16BE(408) : 0,
    reinforcementInterval: bytes.length >= 412 ? bytes.readInt16BE(410) : 0
  };
}
function governmentName(governmentId) {
  const id = Number(governmentId);
  if (!Number.isFinite(id) || id < 128) return null;
  const government = resources["gövt"] && (resources["gövt"][`nova:${id}`] || resources["gövt"][String(id)]);
  return government && government.name ? safeName(government.name, `EVN government ${id}`) : null;
}
function referenceGovernment(governmentId) {
  const id = String(refId(governmentId));
  return referenceGovernments.find(government => String(government.id) === id) || null;
}
function evnGovernmentColor(value) {
  const hex = String(value || "").replace(/^0x/i, "").padStart(8, "0");
  if (!/^[0-9a-f]{8}$/i.test(hex)) return [0.5, 0.5, 0.5];
  return [2, 4, 6].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}
function governmentRelations(governments) {
  const classMembers = new Map();
  for (const government of governments) {
    const data = government.data || {};
    for (let index = 1; index <= 4; index++) {
      const classId = Number(data[`Class${index}`]);
      if (!Number.isFinite(classId) || classId < 0) continue;
      if (!classMembers.has(classId)) classMembers.set(classId, new Set());
      classMembers.get(classId).add(safeName(government.name, `EVN government ${government.id}`));
    }
  }
  const relations = new Map();
  for (const government of governments) {
    const data = government.data || {};
    const name = safeName(government.name, `EVN government ${government.id}`);
    const allies = new Set();
    const enemies = new Set();
    for (const relation of ["Ally", "Enemy"]) {
      const target = relation === "Ally" ? allies : enemies;
      for (let index = 1; index <= 4; index++) {
        const classId = Number(data[`${relation}${index}`]);
        if (!Number.isFinite(classId) || classId < 0) continue;
        for (const member of classMembers.get(classId) || []) if (member !== name) target.add(member);
      }
    }
    for (const enemy of enemies) allies.delete(enemy);
    relations.set(name, { allies, enemies });
  }
  return relations;
}
function systemAsteroidLines(raw) {
  const total = Math.max(0, Math.min(16, Math.round(Number(raw && raw.asteroids) || 0)));
  if (!total) return [];
  const sizes = ["small", "medium", "large", "large"];
  const materials = ["metal", "rock", "rock", "rock"];
  const categories = [];
  for (let bit = 0; bit < 16; bit++) {
    if (!(raw.asteroidTypes & (1 << bit))) continue;
    const category = `${sizes[Math.floor(bit / 4)]} ${materials[Math.floor(bit / 4)]}`;
    if (!categories.includes(category)) categories.push(category);
  }
  if (!categories.length) categories.push("small rock");
  const base = Math.floor(total / categories.length);
  const remainder = total % categories.length;
  return categories.flatMap((category, index) => {
    const count = base + (index < remainder ? 1 : 0);
    return count ? [`\tasteroids ${q(category)} ${count} 3`] : [];
  });
}
function evnCommodityTier(flags, commodity) {
  const value = Number(flags) || 0;
  const index = commodity.flags.findIndex(flag => value & flag);
  return index < 0 ? 0 : index + 1;
}
function evnCommodityPrice(commodity, tier) {
  const normalizedTier = Math.max(1, Math.min(3, Number(tier) || 1));
  const ratio = 0.25 + (normalizedTier - 1) * 0.25;
  return Math.round(commodity.min + (commodity.max - commodity.min) * ratio);
}
function systemTradeValues(system) {
  const totals = new Map();
  for (const reference of system.planets || []) {
    const planet = normalizedOf("Planet", reference);
    const raw = planet && planetRawData(planet.id);
    if (!raw || !(raw.flags & 0x2)) continue;
    for (const commodity of EVN_COMMODITIES) {
      const tier = evnCommodityTier(raw.flags, commodity);
      if (!tier) continue;
      const current = totals.get(commodity.name) || { total: 0, count: 0 };
      current.total += tier;
      current.count++;
      totals.set(commodity.name, current);
    }
  }
  const prices = new Map();
  for (const commodity of EVN_COMMODITIES) {
    const current = totals.get(commodity.name);
    if (current) prices.set(commodity.name, evnCommodityPrice(commodity, current.total / current.count));
  }
  return prices;
}
function systemTradeLines(system) {
  return [...systemTradeValues(system)].map(([commodity, price]) => `\ttrade ${q(commodity)} ${price}`);
}
function evnDefenseShipCount(value) {
  const encoded = Math.trunc(number(value, 0));
  if (encoded <= 0) return 0;
  if (encoded <= 1000) return encoded;
  const digits = String(encoded);
  const totalCode = digits.slice(0, -1);
  if (!totalCode) return 0;
  const first = Number(totalCode[0]);
  if (!Number.isFinite(first) || first < 1) return 0;
  const total = Number(`${first - 1}${totalCode.slice(1)}`);
  return Number.isFinite(total) && total > 0 ? total : 0;
}
function systemEnvironmentLines(raw) {
  if (!raw) return [];
  const lines = [];
  const murk = Math.max(0, Math.min(50, Math.trunc(number(raw.murk, 0))));
  if (murk > 0) {
    const haze = murk >= 33 ? "_menu/haze-dark-nebula" : murk >= 10 ? "_menu/haze-133" : "_menu/haze-67";
    lines.push(`\thaze ${haze}`);
  }
  const attributes = [];
  const interference = Math.max(0, Math.min(100, Math.trunc(number(raw.interference, 0))));
  if (interference > 0) attributes.push(`EVN sensor interference ${interference}`);
  if (murk > 0) attributes.push(`EVN murk ${murk}`);
  if (raw.visibility) attributes.push(`EVN visibility ${raw.visibility}`);
  if (attributes.length) lines.push(`\tattributes ${attributes.map(q).join(" ")}`);
  return lines;
}
function referenceFleetRecord(kind, id) {
  const records = kind === "düde" ? referenceDudes : referenceFleets;
  const target = String(refId(id));
  return records.find(record => String(record.id) === target) || null;
}
function generatedFleetName(kind, id) {
  const record = referenceFleetRecord(kind, id);
  if (!record) return null;
  const prefix = kind === "düde" ? "EVN Dude" : "EVN Fleet";
  return safeName(`${prefix} ${record.id} ${record.name}`, `${prefix} ${record.id}`);
}
function evnDudePersonality(aiType) {
  switch (Number(aiType)) {
    case 1: return ["timid"];
    case 2: return ["uninterested"];
    case 3: return ["heroic"];
    case 4: return ["nemesis"];
    default: return [];
  }
}
function shipNameForFleet(shipId) {
  const ship = normalizedOf("Ship", shipId);
  return ship && !ship.parseError ? safeName(ship.name, `EVN ship ${shipId}`) : null;
}
function systemFleetPeriod(averageShips, probability) {
  const density = Math.max(1, Number(averageShips) || 1);
  const chance = Math.max(1, Number(probability) || 1);
  return Math.max(300, Math.round((12000 * 4) / (density * chance)));
}
function convertFleets() {
  const lines = ["# EVN düde and flët records converted to Endless Sky fleets.", "# düde probabilities become variant weights; flët escort ranges become mean fixed counts.", ""];
  let dudeCount = 0;
  let fleetCount = 0;
  for (const record of referenceDudes) {
    const data = record.data || {};
    const variants = new Map();
    for (let index = 1; index <= 16; index++) {
      const shipName = shipNameForFleet(data[`ShipType${index}`]);
      const probability = Number(data[`Probability${index}`]);
      if (!shipName || !Number.isFinite(probability) || probability <= 0) continue;
      variants.set(shipName, (variants.get(shipName) || 0) + probability);
    }
    if (!variants.size) continue;
    const name = generatedFleetName("düde", record.id);
    if (!name) continue;
    lines.push(`fleet ${q(name)}`);
    const government = governmentName(data.Govt);
    if (government) lines.push(`\tgovernment ${q(government)}`);
    const personality = evnDudePersonality(data.AIType);
    if (personality.length) lines.push(`\tpersonality ${personality.join(" ")}`);
    for (const [shipName, probability] of [...variants.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      lines.push(`\tvariant ${Math.max(1, Math.round(probability))}`);
      lines.push(`\t\t${q(shipName)}`);
    }
    lines.push("");
    dudeCount++;
  }
  for (const record of referenceFleets) {
    const data = record.data || {};
    const ships = new Map();
    const leadName = shipNameForFleet(data.LeadShipType);
    if (!leadName) continue;
    ships.set(leadName, 1);
    const escortTypes = Array.isArray(data.EscortType) ? data.EscortType : [];
    const minimums = Array.isArray(data.Min) ? data.Min : [];
    const maximums = Array.isArray(data.Max) ? data.Max : [];
    escortTypes.forEach((shipId, index) => {
      const shipName = shipNameForFleet(shipId);
      if (!shipName) return;
      const minimum = Math.max(0, Number(minimums[index]) || 0);
      const maximum = Math.max(minimum, Number(maximums[index]) || 0);
      const count = Math.round((minimum + maximum) / 2);
      if (count > 0) ships.set(shipName, (ships.get(shipName) || 0) + count);
    });
    const name = generatedFleetName("flët", record.id);
    if (!name) continue;
    lines.push(`fleet ${q(name)}`);
    const government = governmentName(data.Govt);
    if (government) lines.push(`\tgovernment ${q(government)}`);
    lines.push("\tpersonality heroic");
    lines.push("\tvariant");
    for (const [shipName, count] of ships) lines.push(`\t\t${q(shipName)}${count > 1 ? ` ${count}` : ""}`);
    lines.push("");
    fleetCount++;
  }
  write(path.join(output, "data", "fleets.txt"), lines.join("\n"));
  return { dudeCount, fleetCount };
}
function rawTechLevel(type, id, offset) {
  const key = `${type}:${refId(id)}:${offset}`;
  if (rawTechCache.has(key)) return rawTechCache.get(key);
  const resource = burger.resources.find(item => item.type === type && String(item.id) === String(refId(id)));
  if (!resource) {
    rawTechCache.set(key, 0);
    return 0;
  }
  const bytes = Buffer.from(resource.dataBase64, "base64");
  const value = bytes.length >= offset + 2 ? bytes.readInt16BE(offset) : 0;
  rawTechCache.set(key, value);
  return value;
}
function specialServiceName(kind, planet) {
  return `EVN ${kind} ${safeName(planet.name, `planet ${planet.id}`)} ${refId(planet.id)}`;
}
function planetSpecialItems(planet, raw, kind) {
  if (!raw) return [];
  const specialTech = new Set(raw.specialTech.filter(value => Number.isFinite(Number(value)) && Number(value) >= 0));
  const source = kind === "Outfits" ? Object.values(normalized.Outfit || {}) : Object.values(normalized.Ship || {});
  const type = kind === "Outfits" ? "oütf" : "shïp";
  const offset = kind === "Outfits" ? 4 : 46;
  const seen = new Set();
  return source
    .filter(item => !item.parseError && specialTech.has(rawTechLevel(type, item.id, offset)))
    .map(item => safeName(item.name, `EVN ${kind.slice(0, -1).toLowerCase()} ${item.id}`))
    .filter(name => !seen.has(name) && seen.add(name))
    .sort((a, b) => a.localeCompare(b));
}
function evnTextResource(id) {
  const value = Number(id);
  if (!Number.isFinite(value) || value < 0) return null;
  const resource = burger.resources.find(item => item.type === "dësc" && Number(item.id) === value);
  if (!resource) return null;
  return Buffer.from(resource.dataBase64, "base64").toString("latin1").split("\0", 1)[0].trim();
}
function evnStringListResource(id) {
  const value = Number(id);
  if (!Number.isFinite(value) || value < 0) return [];
  if (stringListCache.has(value)) return stringListCache.get(value);
  const resource = burger.resources.find(item => item.type === "STR#" && Number(item.id) === value);
  if (!resource) {
    stringListCache.set(value, []);
    return [];
  }
  const bytes = Buffer.from(resource.dataBase64, "base64");
  if (bytes.length < 2) {
    stringListCache.set(value, []);
    return [];
  }
  const strings = [];
  const count = bytes.readUInt16BE(0);
  let offset = 2;
  for (let index = 0; index < count && offset < bytes.length; index++) {
    const length = bytes[offset++];
    if (offset + length > bytes.length) break;
    strings.push(bytes.subarray(offset, offset + length).toString("latin1"));
    offset += length;
  }
  stringListCache.set(value, strings);
  return strings;
}
function evnNewsText(value) {
  return String(value || "")
    .replace(/\r\n?|\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function esText(value) {
  return `\`${evnNewsText(value).replace(/`/g, "'")}\``;
}
function cronNewsEntries(data) {
  const entries = [];
  const seen = new Set();
  const independent = Math.trunc(Number(data.IndNewsStr));
  if (Number.isFinite(independent) && independent > 0) entries.push({ id: independent, scope: "independent", governmentId: null });
  for (let index = 1; index <= 4; index++) {
    const id = Math.trunc(Number(data[`GovtNewsStr${index}`]));
    const governmentId = Math.trunc(Number(data[`NewsGovt${index}`]));
    if (!Number.isFinite(id) || id <= 0) continue;
    const key = `${id}:${governmentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ id, scope: "government", governmentId });
  }
  return entries;
}
function cronNewsName(recordId, entry) {
  return entry.scope === "independent"
    ? `EVN crön ${recordId} news ${entry.id} independent`
    : `EVN crön ${recordId} news ${entry.id} government ${entry.governmentId}`;
}
function evnConversationText(id) {
  const text = evnTextResource(id);
  if (!text) return null;
  return text
    .replace(/\{G\s*"[^"]+"\s+"[^"]+"\}/g, "them")
    .replace(/<CQ>|<CT>/g, "<cargo>")
    .replace(/<RST>|<DST>/g, "<destination>")
    .replace(/<RSY>|<DSY>|<SN>/g, "<system>")
    .replace(/<PN>/g, "<planet>")
    .replace(/<PSN>/g, "<ship>")
    .replace(/<DL>/g, "the deadline")
    .replace(/`/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
function serviceName(kind, techLevel) { return `EVN ${kind} ${Math.max(0, techLevel)}`; }
function licenseName(techLevel) { return `EVN Tech License ${Math.max(0, techLevel)}`; }
function evnBitFlag(bit) { return `EVN bit ${Math.max(0, Number(bit))}`; }
function evnBitActions(expression) {
  const matches = String(expression || "").match(/!?b\d+/g) || [];
  return matches.map(token => ({ bit: token.startsWith("!") ? token.slice(2) : token.slice(1), negate: token.startsWith("!") }));
}
function simpleEvnBitCondition(expression) {
  const value = String(expression || "").trim();
  const match = value.match(/^(!?)b(\d+)$/);
  return match ? { flag: evnBitFlag(match[2]), negate: Boolean(match[1]) } : null;
}
function missionCargoLines(data, sourceName) {
  const type = Number(data && data.CargoType);
  const rawQuantity = Number(data && data.CargoQty);
  if (!Number.isFinite(type) || type < 0 || !Number.isFinite(rawQuantity) || rawQuantity === -1) {
    return /passenger/i.test(sourceName) ? ["\tpassengers 1"] : [];
  }
  const quantity = Math.abs(Math.round(rawQuantity));
  if (!quantity) return [];
  if (type === 6 || /passenger/i.test(sourceName)) return [`\tpassengers ${quantity}`];
  const cargoName = type === 1000 ? "EVN random cargo" : `EVN cargo type ${type}`;
  return [`\tcargo ${q(cargoName)} ${quantity}`];
}
function missionNpcLines(data) {
  const count = Number(data && data.ShipCount);
  const dudeId = Number(data && data.ShipDude);
  if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(dudeId) || dudeId < 128) return [];
  const resource = burger.resources.find(item => item.type === "düde" && Number(item.id) === dudeId);
  if (!resource) return [];
  const bytes = Buffer.from(resource.dataBase64, "base64");
  if (bytes.length < 72) return [];
  const shipIds = [];
  let bestShip = -1;
  let bestProbability = -1;
  for (let i = 0; i < 16; i++) {
    const shipId = bytes.readInt16BE(8 + i * 2);
    const probability = bytes.readInt16BE(40 + i * 2);
    if (shipId >= 128) shipIds.push(shipId);
    if (shipId >= 128 && probability > bestProbability) {
      bestShip = shipId;
      bestProbability = probability;
    }
  }
  if (bestShip < 128) return [];
  const lines = ["\tnpc"];
  const governmentId = bytes.readInt16BE(2);
  const government = resources["gövt"] && resources["gövt"][`nova:${governmentId}`];
  if (government && government.name) lines.push(`\t\tgovernment ${q(safeName(government.name, `EVN government ${governmentId}`))}`);
  const systemId = Number(data && data.ShipSyst);
  if (systemId >= 128) lines.push(`\t\tsystem ${q(nameOf("System", systemId))}`);
  else if (systemId === -3) lines.push("\t\tsystem destination");
  const goal = Number(data && data.ShipGoal);
  const personality = goal === 3 || goal === 4 || goal === 5 ? "heroic staying" : goal === 0 || goal === 1 || goal === 2 || goal === 6 ? "nemesis staying" : "staying";
  lines.push(`\t\tpersonality ${personality}`);
  const shipName = nameOf("Ship", bestShip);
  for (let i = 0; i < Math.min(31, Math.round(count)); i++) lines.push(`\t\tship ${q(shipName)}`);
  return lines;
}
function emitEvnBitActions(lines, expression, indent) {
  const actions = evnBitActions(expression);
  for (const action of actions) lines.push(`${indent}${action.negate ? "clear" : "set"} ${q(evnBitFlag(action.bit))}`);
  return actions.length;
}
function parseEvnBitExpression(expression) {
  const tokens = String(expression || "").match(/b\d+|[!&|()]/g) || [];
  if (!tokens.length || tokens.join("") !== String(expression || "").replace(/\s+/g, "")) return null;
  let index = 0;
  function primary() {
    if (tokens[index] === "(") {
      index++;
      const value = orExpression();
      if (tokens[index++] !== ")") throw new Error("unbalanced EVN bit expression");
      return value;
    }
    const token = tokens[index++];
    if (!token || !/^b\d+$/.test(token)) throw new Error("invalid EVN bit expression");
    return { type: "bit", bit: token.slice(1), negate: false };
  }
  function unary() {
    if (tokens[index] === "!") {
      index++;
      return { type: "not", value: unary() };
    }
    return primary();
  }
  function andExpression() {
    let value = unary();
    while (tokens[index] === "&") {
      index++;
      value = { type: "and", left: value, right: unary() };
    }
    return value;
  }
  function orExpression() {
    let value = andExpression();
    while (tokens[index] === "|") {
      index++;
      value = { type: "or", left: value, right: andExpression() };
    }
    return value;
  }
  try {
    const value = orExpression();
    return index === tokens.length ? value : null;
  } catch (_) {
    return null;
  }
}
function evnBitDnf(node, inverted = false) {
  if (!node) return null;
  if (node.type === "bit") return [[{ bit: node.bit, negate: node.negate !== inverted }]];
  if (node.type === "not") return evnBitDnf(node.value, !inverted);
  const left = evnBitDnf(node.left, inverted);
  const right = evnBitDnf(node.right, inverted);
  if (!left || !right) return null;
  if ((node.type === "or" && !inverted) || (node.type === "and" && inverted)) return left.concat(right);
  const terms = [];
  for (const a of left) for (const b of right) terms.push(a.concat(b));
  return terms;
}
function emitEvnBitConditions(lines, expression, indent) {
  const tree = parseEvnBitExpression(expression);
  const terms = tree && evnBitDnf(tree);
  if (!terms || !terms.length || terms.length > 32) return false;
  const condition = term => {
    const prefix = term.negate ? "not" : "has";
    return `${prefix} ${q(evnBitFlag(term.bit))}`;
  };
  const emitTerm = (term, prefix) => {
    if (term.length === 1) lines.push(`${prefix}${condition(term[0])}`);
    else {
      lines.push(`${prefix}and`);
      for (const item of term) lines.push(`${prefix}\t${condition(item)}`);
    }
  };
  if (terms.length === 1) emitTerm(terms[0], indent);
  else {
    lines.push(`${indent}or`);
    for (const term of terms) emitTerm(term, `${indent}\t`);
  }
  return true;
}
function safeName(value, fallback) {
  const name = String(value || fallback).replace(/[\r\n]/g, " ").trim();
  return name || fallback;
}
function add(lines, key, value, indent = "\t") {
  if (key === undefined || key === null || value === undefined || value === null || value === "") return;
  lines.push(`${indent}${q(key)} ${typeof value === "number" ? value : q(value)}`);
}
function block(lines, type, name, fields) {
  lines.push(`${q(type)} ${q(name)}`);
  for (const [key, value] of fields) {
    if (Array.isArray(value)) {
      lines.push(`\t${q(key)} ${value.map(v => typeof v === "number" ? v : q(v)).join(" ")}`);
    } else add(lines, key, value);
  }
  lines.push("");
}
function countPorts(points) {
  return Array.isArray(points) ? points.filter(point => Array.isArray(point) && point.some(number => number !== 0)).length : 0;
}

function convertShips() {
  const lines = ["# Generated from EV Nova shïp resources via NovaParse.", "# Sprites and hardpoint positions require asset conversion and manual tuning.", ""];
  for (const ship of Object.values(normalized.Ship || {})) {
    if (ship.parseError) continue;
    const name = safeName(ship.name, `EVN ship ${ship.id}`);
    const p = ship.physics || {};
    const fields = [
      ["sprite", `ship/${name.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase()}`],
      ["thumbnail", `thumbnail/${name.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase()}`]
    ];
    lines.push(`${q("ship")} ${q(name)}`);
    add(lines, "plural", `${name}s`);
    const shipTech = Math.max(0, rawTechLevel("shïp", ship.id, 46));
    for (const [key, value] of fields) add(lines, key, value);
    lines.push("\tattributes");
    if (shipTech > 0) {
      lines.push("\t\tlicenses");
      lines.push(`\t\t\t${q(licenseName(shipTech))}`);
    }
    for (const [key, value] of [
      ["shields", number(p.shield)],
      ["shield generation", number(p.shieldRecharge)],
      ["hull", number(p.armor)],
      ["hull repair rate", number(p.armorRecharge)],
      ["energy", number(p.energy)],
      ["energy generation", number(p.energyRecharge)],
      ["mass", number(p.mass)],
      ["drag", number(p.mass) ? number(p.mass) / Math.max(number(p.speed), 1) * 10 : 1],
      ["acceleration", number(p.acceleration) / 100],
      ["turn", number(p.turnRate)],
      ["cargo space", number(p.freeCargo)],
      ["outfit space", number(p.freeMass)],
      ["gun ports", countPorts(ship.animation && ship.animation.exitPoints && ship.animation.exitPoints.gun)],
      ["turret mounts", countPorts(ship.animation && ship.animation.exitPoints && ship.animation.exitPoints.turret)],
      ["turret turn", countPorts(ship.animation && ship.animation.exitPoints && ship.animation.exitPoints.turret) ? 1 : null],
      ["missile mounts", countPorts(ship.animation && ship.animation.exitPoints && ship.animation.exitPoints.guided)],
      ["fighter bays", countPorts(ship.animation && ship.animation.exitPoints && ship.animation.exitPoints.beam)]
    ]) add(lines, key, value, "\t\t");
    lines.push("");
    if (ship.outfits) {
      let remaining = Math.max(0, number(p.freeMass));
      const fitted = [];
      for (const [ref, quantity] of Object.entries(ship.outfits)) {
        const outfit = normalizedOf("Outfit", ref);
        const count = Math.max(0, Math.floor(number(quantity, 1)));
        const cost = Math.max(0, number(outfit && outfit.physics && outfit.physics.freeMass));
        const fitCount = cost ? Math.min(count, Math.floor(remaining / cost)) : count;
        if (fitCount > 0) {
          fitted.push([ref, fitCount]);
          remaining -= fitCount * cost;
        }
      }
      lines.push(`\toutfits`);
      for (const [ref, quantity] of fitted) {
        lines.push(`\t\t${q(nameOf("Outfit", ref))} ${quantity}`);
      }
    }
    if (ship.desc) add(lines, "description", ship.desc);
    lines.push("");
  }
  const techLevels = [...new Set(Object.values(normalized.Ship || {}).map(item => Math.max(0, rawTechLevel("shïp", item.id, 46))))].sort((a, b) => a - b);
  for (const tech of techLevels) {
    lines.push(`shipyard ${q(serviceName("Ships", tech))}`);
    for (const licenseTech of techLevels.filter(level => level > 0 && level <= tech)) {
      lines.push(`\t${q(licenseName(licenseTech))}`);
    }
    for (const ship of Object.values(normalized.Ship || {})) {
      if (rawTechLevel("shïp", ship.id, 46) <= tech) lines.push(`\t${q(safeName(ship.name, `EVN ship ${ship.id}`))}`);
    }
    lines.push("");
  }
  write(path.join(output, "data", "ships.txt"), lines.join("\n"));
}

function convertOutfits() {
  const lines = ["# Generated from EV Nova oütf and wëap resources.", "# EVN availability, mission bits, and government tech levels require later mapping.", ""];
  const weapons = normalized.Weapon || {};
  for (const outfit of Object.values(normalized.Outfit || {})) {
    if (outfit.parseError) continue;
    const name = safeName(outfit.name, `EVN outfit ${outfit.id}`);
    const weaponRefs = Object.keys(outfit.weapons || {});
    const firstWeapon = weaponRefs.length ? normalizedOf("Weapon", weaponRefs[0]) : null;
    const category = firstWeapon && firstWeapon.exitType === "turret" ? "Turrets" : weaponRefs.length ? "Guns" : "Systems";
    const fields = [
      ["category", category],
      ["cost", number(outfit.price)],
      ["thumbnail", `outfit/${name.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase()}`],
      ["mass", number(outfit.physics && outfit.physics.freeMass)],
      ["outfit space", -number(outfit.physics && outfit.physics.freeMass)],
      [firstWeapon && firstWeapon.exitType === "turret" ? "turret mounts" : weaponRefs.length ? "gun ports" : null, weaponRefs.length ? -1 : null]
    ];
    lines.push(`${q("outfit")} ${q(name)}`);
    add(lines, "plural", `${name}s`);
    const outfitTech = Math.max(0, rawTechLevel("oütf", outfit.id, 4));
    if (outfitTech > 0) {
      lines.push("\tlicenses");
      lines.push(`\t\t${q(licenseName(outfitTech))}`);
    }
    for (const [key, value] of fields) add(lines, key, value);
    for (const ref of weaponRefs) {
      const weapon = normalizedOf("Weapon", ref);
      if (!weapon || weapon.parseError) continue;
      const weaponFields = [
        ["sprite", `projectile/${safeName(weapon.name, name).replace(/[^A-Za-z0-9]+/g, "_").toLowerCase()}`],
        ["sound", weaponSoundId(weapon.id) == null ? null : `evn-${weaponSoundId(weapon.id)}`],
        ["inaccuracy", number(weapon.accuracy)],
        ["velocity", number(weapon.shotSpeed) / 200],
        ["lifetime", number(weapon.shotDuration)],
        ["reload", number(weapon.fireRate) ? 60 / number(weapon.fireRate) : 0],
      ["shield damage", number(weapon.damageType === "ion" ? 0 : weapon.physics && weapon.physics.shield)],
      ["hull damage", number(weapon.physics && weapon.physics.armor)],
        ["ion damage", number(weapon.physics && weapon.physics.ionization)],
        ["turret turn", 1]
      ];
      lines.push(`\t${q("weapon")}`);
      for (const [key, value] of weaponFields) add(lines, key, value, "\t\t");
    }
    add(lines, "description", outfit.desc || "");
    lines.push("");
  }
  const techLevels = [...new Set(Object.values(normalized.Outfit || {}).map(item => Math.max(0, rawTechLevel("oütf", item.id, 4))))].sort((a, b) => a - b);
  for (const tech of techLevels.filter(level => level > 0)) {
    lines.push(`outfit ${q(licenseName(tech))}`);
    lines.push("\tcategory \"Licenses\"");
    lines.push("\tseries \"Licenses\"");
    lines.push(`\tcost ${tech * 1000}`);
    lines.push(`\tdescription ${q(`EVN technology license for tier ${tech}.`)}`);
    lines.push("");
  }
  for (const tech of techLevels) {
    lines.push(`outfitter ${q(serviceName("Outfits", tech))}`);
    for (const licenseTech of techLevels.filter(level => level > 0 && level <= tech)) {
      lines.push(`\t${q(licenseName(licenseTech))}`);
    }
    for (const outfit of Object.values(normalized.Outfit || {})) {
      if (rawTechLevel("oütf", outfit.id, 4) <= tech) lines.push(`\t${q(safeName(outfit.name, `EVN outfit ${outfit.id}`))}`);
    }
    lines.push("");
  }
  write(path.join(output, "data", "outfits.txt"), lines.join("\n"));
}

function convertPlanets() {
  const lines = ["# Generated from EV Nova spöb resources.", "# Planet government, docking, tech shops, tribute, and defense fleets converted.", "# EVN wave timing has no ES equivalent; encoded DefCount becomes total tribute-fleet spawns.", ""];
  for (const planet of Object.values(normalized.Planet || {})) {
    if (planet.parseError) continue;
    const name = safeName(planet.name, `EVN planet ${planet.id}`);
    const raw = planetRawData(planet.id);
    lines.push(`${q("planet")} ${q(name)}`);
    add(lines, "landscape", `land/${name.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase()}`);
    add(lines, "government", planetGovernmentName(planet.id));
    if (raw && (raw.flags & 0x1)) add(lines, "spaceport", planet.landingDesc || "");
    if (raw && (raw.flags & 0x4)) {
      lines.push(`\toutfitter ${q(serviceName("Outfits", raw.techLevel))}`);
      if (planetSpecialItems(planet, raw, "Outfits").length) lines.push(`\toutfitter ${q(specialServiceName("Outfits", planet))}`);
    }
    if (raw && (raw.flags & 0x8)) {
      lines.push(`\tshipyard ${q(serviceName("Ships", raw.techLevel))}`);
      if (planetSpecialItems(planet, raw, "Ships").length) lines.push(`\tshipyard ${q(specialServiceName("Ships", planet))}`);
    }
    if (raw && (raw.flags & 0x1) && raw.techLevel >= 0) {
      const tribute = raw.tribute > 0 ? raw.tribute : raw.techLevel * 1000;
      if (tribute > 0) {
        lines.push(`\ttribute ${tribute}`);
        const defenseFleet = generatedFleetName("düde", raw.defenseDude);
        const defenseCount = evnDefenseShipCount(raw.defenseCount);
        if (defenseFleet && defenseCount > 0) {
          lines.push(`\t\tfleet ${q(defenseFleet)} ${defenseCount}`);
          if (raw.defenseCount > 1000) lines.push(`\t\t# EVN DefCount ${raw.defenseCount}: wave timing collapsed to ${defenseCount} ES spawns.`);
        }
      }
    }
    add(lines, "description", planet.landingDesc || "");
    lines.push("");
  }
  write(path.join(output, "data", "planets.txt"), lines.join("\n"));
}

function convertShops() {
  const lines = ["# EVN spöb SpecialTech access converted to dedicated ES shops.", "# SpecialTech values expose items with exactly matching EVN tech levels.", ""];
  let outfitters = 0;
  let shipyards = 0;
  for (const planet of Object.values(normalized.Planet || {})) {
    if (planet.parseError) continue;
    const raw = planetRawData(planet.id);
    if (!raw) continue;
    for (const [kind, flag, keyword] of [["Outfits", 0x4, "outfitter"], ["Ships", 0x8, "shipyard"]]) {
      if (!(raw.flags & flag)) continue;
      const items = planetSpecialItems(planet, raw, kind);
      if (!items.length) continue;
      lines.push(`${keyword} ${q(specialServiceName(kind, planet))}`);
      for (const item of items) lines.push(`\t${q(item)}`);
      lines.push("");
      if (kind === "Outfits") outfitters++;
      else shipyards++;
    }
  }
  write(path.join(output, "data", "shops.txt"), lines.join("\n"));
  return { outfitters, shipyards };
}

function convertSystems() {
  const lines = ["# Generated from EV Nova sÿst resources.", "# Government, asteroid fields, trade, traffic fleets, reinforcement fleets, and murk haze converted.", "# EVN sensor interference and visibility are retained as EVN system attributes; ES has no direct equivalents.", "# EVN nëbu map decorations remain in source/nëbu.json; ES has no direct nebula-region syntax.", ""];
  for (const system of Object.values(normalized.System || {})) {
    if (system.parseError) continue;
    const name = safeName(system.name, `EVN system ${system.id}`);
    const pos = Array.isArray(system.position) ? system.position : [0, 0];
    const raw = systemRawData(system.id);
    lines.push(`${q("system")} ${q(name)}`);
    lines.push(`\t${q("pos")} ${number(pos[0])} ${number(pos[1])}`);
    const government = raw && governmentName(raw.government);
    if (government) add(lines, "government", government);
    for (const link of system.links || []) add(lines, "link", nameOf("System", link));
    lines.push(...systemAsteroidLines(raw || { asteroids: 0, asteroidTypes: 0 }));
    lines.push(...systemTradeLines(system));
    lines.push(...systemEnvironmentLines(raw));
    if (raw) {
      const schedules = new Map();
      for (let index = 0; index < raw.dudeTypes.length; index++) {
        const type = Number(raw.dudeTypes[index]);
        const name = type < 0 ? generatedFleetName("flët", Math.abs(type)) : generatedFleetName("düde", type);
        if (!name) continue;
        const period = systemFleetPeriod(raw.averageShips, raw.dudeProbabilities[index]);
        if (!schedules.has(name) || period < schedules.get(name)) schedules.set(name, period);
      }
      const reinforcement = generatedFleetName("flët", raw.reinforcementFleet);
      if (reinforcement && raw.reinforcementTime > 0 && (!schedules.has(reinforcement) || raw.reinforcementTime < schedules.get(reinforcement))) {
        schedules.set(reinforcement, Math.max(300, raw.reinforcementTime));
      }
      for (const [fleet, period] of schedules) lines.push(`\tfleet ${q(fleet)} ${period}`);
    }
    for (const planet of system.planets || []) add(lines, "object", nameOf("Planet", planet));
    lines.push("");
  }
  write(path.join(output, "data", "systems.txt"), lines.join("\n"));
}

function convertExplosions() {
  const lines = ["# EVN bööm resources have no direct ES resource type.", "# See source/normalized/Explosion.json for preserved definitions.", ""];
  write(path.join(output, "data", "explosions.txt"), lines.join("\n"));
}

function resizePng(sourcePath, destinationPath, width) {
  const source = PNG.sync.read(fs.readFileSync(sourcePath));
  const height = Math.max(1, Math.round(source.height * width / source.width));
  const resized = new PNG({ width, height });
  const xScale = source.width / width;
  const yScale = source.height / height;

  for (let y = 0; y < height; y++) {
    const sourceY = (y + 0.5) * yScale - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(source.height - 1, y0 + 1);
    const yWeight = Math.max(0, Math.min(1, sourceY - y0));
    for (let x = 0; x < width; x++) {
      const sourceX = (x + 0.5) * xScale - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const xWeight = Math.max(0, Math.min(1, sourceX - x0));
      const outputIndex = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const topLeft = source.data[(y0 * source.width + x0) * 4 + channel];
        const topRight = source.data[(y0 * source.width + x1) * 4 + channel];
        const bottomLeft = source.data[(y1 * source.width + x0) * 4 + channel];
        const bottomRight = source.data[(y1 * source.width + x1) * 4 + channel];
        const top = topLeft + (topRight - topLeft) * xWeight;
        const bottom = bottomLeft + (bottomRight - bottomLeft) * xWeight;
        resized.data[outputIndex + channel] = Math.round(top + (bottom - top) * yWeight);
      }
    }
  }

  mkdir(path.dirname(destinationPath));
  fs.writeFileSync(destinationPath, PNG.sync.write(resized));
}

function prepareMenuArt() {
  const sourcePath = path.join(output, "images", "_menu", "title-source.png");
  if (!fs.existsSync(sourcePath)) return;
  resizePng(sourcePath, path.join(output, "images", "_menu", "endless-nova-title@1x.png"), 1024);
  resizePng(sourcePath, path.join(output, "images", "_menu", "endless-nova-title@2x.png"), 2048);
}

function convertMenuInterface() {
  const lines = [
    "# Endless Nova TC menu override.",
    "# Replace stock Endless Sky menu artwork with the EVN/ES hybrid title scene.",
    "",
    "overwrite",
    "interface \"menu background\"",
    "\tsprite \"_menu/endless-nova-title\"",
    "\t\tcenter 0 -80",
    ""
  ];
  write(path.join(output, "data", "_ui", "interfaces.txt"), lines.join("\n"));
}

function convertStarts() {
  const character = Object.values(resources["chär"] || {})[0];
  const raw = character && burger.resources.find(item => item.type === "chär" && Number(item.id) === Number(character.id));
  if (!raw) return;
  const bytes = Buffer.from(raw.dataBase64, "base64");
  if (bytes.length < 14) return;
  const cash = bytes.readInt32BE(0);
  const shipId = bytes.readInt16BE(4);
  const systemIds = [6, 8, 10, 12].map(offset => bytes.readInt16BE(offset)).filter(id => id >= 128);
  const system = systemIds.map(id => normalizedOf("System", id)).find(Boolean);
  if (!system) return;
  const firstPlanet = Array.isArray(system.planets) ? system.planets.map(ref => normalizedOf("Planet", ref)).find(Boolean) : null;
  const shipName = normalizedOf("Ship", shipId);
  const startId = "evn-trader";
  const conversationName = "EVN start trader";
  const lines = ["# EVN chär character template converted to an ES start.", "", `start ${q(startId)}`];
  lines.push(`\tname ${q("Endless Nova Trader")}`);
  lines.push(`\tdescription ${q(`EV Nova character template: ${safeName(character.name, "Trader")}.`)}`);
  lines.push(`\tsystem ${q(safeName(system.name, "Kania"))}`);
  if (firstPlanet) lines.push(`\tplanet ${q(safeName(firstPlanet.name, "Port Kane"))}`);
  lines.push("\tdate 1 1 3020");
  lines.push(`\tconversation ${q(conversationName)}`);
  lines.push("\taccount", `\t\tcredits ${Math.max(0, cash)}`, "\t\tscore 0");
  lines.push("\tset \"license: Pilot's\"", `\tset ${q("start: EVN trader")}`, "");
  lines.push(`conversation ${q(conversationName)}`);
  lines.push("\taction");
  if (shipName) lines.push(`\t\tgive ship ${q(safeName(shipName.name, "Shuttle"))} ${q("EVN Trader")}`);
  lines.push("\t\tset \"EVN character: trader\"", "\t\tlog \"Started as the EVN Trader character template.\"", "\t`Your Nova career begins in the Kania system.`", "\tname", "");
  write(path.join(output, "data", "starts.txt"), lines.join("\n"));
}

function convertGovernments() {
  const lines = ["# Government data extracted from EV Nova gövt resources.", "# Class-based allies and enemies, colors, initial reputation, and xenophobic behavior mapped to ES.", ""];
  const seen = new Set();
  const referenceByName = new Map(referenceGovernments.map(government => [safeName(government.name, `EVN government ${government.id}`), government]));
  const relations = governmentRelations(referenceGovernments);
  for (const government of Object.values(resources["gövt"] || {})) {
    const name = safeName(government.name, `EVN government ${government.id}`);
    if (seen.has(name)) continue;
    seen.add(name);
    const reference = referenceByName.get(name) || referenceGovernment(government.id);
    const data = reference && reference.data ? reference.data : {};
    const color = evnGovernmentColor(data.Color);
    lines.push(`${q("government")} ${q(name)}`);
    lines.push(`\t${q("color")} ${color.map(value => value.toFixed(4)).join(" ")}`);
    const initialReputation = Number(data.InitialRec);
    if (Number.isFinite(initialReputation) && initialReputation !== 0) lines.push(`\t${q("player reputation")} ${initialReputation}`);
    const relation = relations.get(name);
    const allies = relation ? [...relation.allies].sort() : [];
    const enemies = relation ? [...relation.enemies].sort() : [];
    if (allies.length || enemies.length) {
      lines.push(`\t${q("attitude toward")}`);
      for (const ally of allies) lines.push(`\t\t${q(ally)} 1`);
      for (const enemy of enemies) lines.push(`\t\t${q(enemy)} -1`);
    }
    const flags = Number.parseInt(String(data.Flags || "0"), 16);
    if (flags & 0x0001) lines.push(`\t${q("default attitude")} -1`);
    lines.push("");
  }
  write(path.join(output, "data", "governments.txt"), lines.join("\n"));
}

function convertMissionStubs() {
  const lines = ["# EV Nova mission catalog.", "# Simple contracts preserve EVN availability bits, completion flags, and recoverable offer/completion text.", "# Complex control-bit expressions and branch conversations remain disabled stubs.", ""];
  const conversations = [];
  const seen = new Set();
  for (const mission of Object.values(resources["mïsn"] || {})) {
    const sourceName = safeName(mission.name, `EVN mission ${mission.id}`);
    const name = `EVN: ${sourceName}`;
    if (seen.has(name)) continue;
    seen.add(name);
    const reference = Array.isArray(referenceMissions) ? referenceMissions.find(item => String(item.id) === String(mission.id)) : null;
    const data = reference && reference.data;
    const destination = data && Number(data.ReturnStel);
    const planet = Number.isFinite(destination) && destination >= 128 ? normalized.Planet && (normalized.Planet[`nova:${destination}`] || normalized.Planet[String(destination)]) : null;
    const simple = planet && Number(data.PayVal) > 0 && /(delivery|visit|passenger|rush|escort)/i.test(sourceName);
    if (simple) {
      lines.push(`mission ${q(name)}`);
      lines.push("\tlanding");
      if (data && Number(data.AvailStel) >= 128) {
        const source = normalized.Planet && (normalized.Planet[`nova:${Number(data.AvailStel)}`] || normalized.Planet[String(Number(data.AvailStel))]);
        if (source && source.name) lines.push(`\tsource ${q(source.name)}`);
      }
      lines.push(`\tdestination ${q(planet.name)}`);
      lines.push(`\tdescription ${q(`EV Nova contract: ${sourceName}.`)}`);
      lines.push(...missionCargoLines(data, sourceName));
      const timeLimit = Number(data && data.TimeLimit);
      if (Number.isFinite(timeLimit) && timeLimit > 0) lines.push(`\tdeadline ${Math.round(timeLimit)}`);
      lines.push(...missionNpcLines(data));
      lines.push("\tto offer");
      emitEvnBitConditions(lines, data && data.AvailBits, "\t\t");
      const random = Math.max(1, Math.min(100, Math.round(Number(data.AvailRandom) || 20)));
      lines.push(`\t\trandom < ${random}`);
      const offerText = evnConversationText(data && data.QuickBrief);
      const completeText = evnConversationText(data && data.CompText);
      if (offerText) {
        const conversationName = `EVN dialogue ${mission.id} offer`;
        lines.push("\ton offer");
        lines.push(`\t\tconversation ${q(conversationName)}`);
        conversations.push(`conversation ${q(conversationName)}`);
        conversations.push(`\t\`${offerText}\``);
        conversations.push("");
      }
      const acceptActions = evnBitActions(data && data.OnAccept);
      if (acceptActions.length) {
        lines.push("\ton accept");
        for (const action of acceptActions) if (!action.negate) lines.push(`\t\tset ${q(evnBitFlag(action.bit))}`);
      }
      lines.push("\ton complete");
      lines.push(`\t\tpayment ${Math.max(1, Math.round(Number(data.PayVal)))}`);
      emitEvnBitActions(lines, data && data.OnSuccess, "\t\t");
      const compGovtId = Number(data && data.CompGovt);
      const compReward = Number(data && data.CompReward);
      const compGovt = resources["gövt"] && resources["gövt"][`nova:${compGovtId}`];
      if (compGovt && compGovt.name && Number.isFinite(compReward) && compReward !== 0) {
        lines.push(`\t\t${q(`reputation: ${safeName(compGovt.name, `EVN government ${compGovtId}`)}`)} += ${Math.round(compReward)}`);
      }
      if (completeText) {
        const conversationName = `EVN dialogue ${mission.id} complete`;
        lines.push(`\t\tconversation ${q(conversationName)}`);
        conversations.push(`conversation ${q(conversationName)}`);
        conversations.push(`\t\`${completeText}\``);
        conversations.push("");
      }
      const failText = evnConversationText(data && data.FailText);
      const failureActions = evnBitActions(data && data.OnFailure);
      if (failureActions.length || failText) {
        lines.push("\ton fail");
        emitEvnBitActions(lines, data && data.OnFailure, "\t\t");
        if (failText) {
          const conversationName = `EVN dialogue ${mission.id} fail`;
          lines.push(`\t\tconversation ${q(conversationName)}`);
          conversations.push(`conversation ${q(conversationName)}`);
          conversations.push(`\t\`${failText}\``);
          conversations.push("");
        }
      }
      const abortActions = evnBitActions(data && data.OnAbort);
      if (abortActions.length) {
        lines.push("\ton abort");
        emitEvnBitActions(lines, data && data.OnAbort, "\t\t");
      }
      const refuseText = evnConversationText(data && data.RefuseText);
      const refuseActions = evnBitActions(data && data.OnRefuse);
      if (refuseText || refuseActions.length) {
        lines.push("\ton decline");
        emitEvnBitActions(lines, data && data.OnRefuse, "\t\t");
        if (refuseText) {
          const conversationName = `EVN dialogue ${mission.id} decline`;
          lines.push(`\t\tconversation ${q(conversationName)}`);
          conversations.push(`conversation ${q(conversationName)}`);
          conversations.push(`\t\`${refuseText}\``);
          conversations.push("");
        }
      }
      lines.push("");
      continue;
    }
    lines.push(`mission ${q(name)}`);
    lines.push("\tinvisible");
    lines.push("\tto offer");
    lines.push("\t\tnever");
    lines.push("");
  }
  lines.push(...conversations);
  write(path.join(output, "data", "missions.txt"), lines.join("\n"));
}

function evnDate(data, prefix) {
  const day = Math.trunc(Number(data && data[`${prefix}Day`]) || 0);
  const month = Math.trunc(Number(data && data[`${prefix}Month`]) || 0);
  const year = Math.trunc(Number(data && data[`${prefix}Year`]) || 0);
  return day > 0 && month > 0 && year > 0 ? [day, month, year] : null;
}

function evnControlActions(expression) {
  const value = String(expression || "").trim();
  if (!value) return [];
  if (!/^(?:!?b\d+)(?:\s*(?:[&|]|\s+)\s*(?:!?b\d+))*$/.test(value)) return null;
  return value.match(/!?b\d+|\d+/g).map(token => ({
    bit: token.replace(/^!?b/, ""),
    negate: token.startsWith("!")
  }));
}

function emitEventBitActions(lines, expression, indent) {
  const actions = evnControlActions(expression);
  if (actions === null) return false;
  for (const action of actions) lines.push(`${indent}${action.negate ? "clear" : "set"} ${q(evnBitFlag(action.bit))}`);
  return true;
}

function cronHasDateConstraint(data) {
  return ["FirstDay", "FirstMonth", "FirstYear", "LastDay", "LastMonth", "LastYear"]
    .some(key => Number(data && data[key]) > 0);
}

function convertCronEvents() {
  const lines = [
    "# EVN crön records converted to mission-triggered ES events.",
    "# ES has no independent daily cron hook; hidden landing missions approximate activation timing.",
    "# Date-constrained records remain source-only until an ES date-window condition is available.",
    ""
  ];
  const missionLines = [
    "# Hidden schedulers for EVN crön records.",
    "# EnableOn becomes an ES mission condition; PreHoldoff, Duration, and PostHoldoff become delayed events.",
    ""
  ];
  let emitted = 0;
  let scheduled = 0;
  let skippedDate = 0;
  let skippedCondition = 0;
  let unsupportedActions = 0;
  let skippedNews = 0;
  const newsDefinitions = new Map();
  for (const record of referenceData["crön"] || []) {
    const data = record.data || {};
    const name = safeName(record.name, `EVN crön ${record.id}`);
    const startDate = evnDate(data, "First");
    const dateConstraint = cronHasDateConstraint(data);
    const enableOn = String(data.EnableOn || "").replace(/\0/g, "").trim();
    const enableTree = parseEvnBitExpression(enableOn);
    if (dateConstraint) {
      skippedDate++;
      const dateDescription = startDate ? `date ${startDate.join(" ")}` : "wildcard date window";
      lines.push(`# Skipped EVN crön ${record.id} ${q(name)}: ${dateDescription}; ES date-window condition not available.`);
      continue;
    }
    if (enableOn && !enableTree) {
      skippedCondition++;
      lines.push(`# Skipped EVN crön ${record.id} ${q(name)}: EnableOn ${q(enableOn)} is not a pure control-bit expression.`);
      continue;
    }

    const eventName = `EVN crön ${record.id}: ${name}`;
    const endName = `${eventName} end`;
    const cooldownName = `${eventName} cooldown`;
    const activeFlag = `EVN crön active ${record.id}`;
    const pendingFlag = `EVN crön pending ${record.id}`;
    const random = Math.max(1, Math.min(100, Math.trunc(Number(data.Random) || 1)));
    const preHoldoff = Math.max(0, Math.trunc(Number(data.PreHoldoff) || 0));
    const duration = Math.max(0, Math.trunc(Number(data.Duration) || 0));
    const postHoldoff = Math.max(0, Math.trunc(Number(data.PostHoldoff) || 0));
    const endDelay = preHoldoff + duration;
    const cooldownDelay = endDelay + postHoldoff;
    const activeNews = [];
    for (const entry of cronNewsEntries(data)) {
      const messages = evnStringListResource(entry.id).map(evnNewsText).filter(Boolean);
      if (!messages.length) {
        skippedNews++;
        lines.push(`# EVN crön ${record.id} news ${entry.id}: STR# resource unavailable or empty.`);
        continue;
      }
      const government = entry.scope === "government" ? governmentName(entry.governmentId) : null;
      if (entry.scope === "government" && !government) {
        skippedNews++;
        lines.push(`# EVN crön ${record.id} news ${entry.id}: government ${entry.governmentId} has no ES mapping.`);
        continue;
      }
      const newsName = cronNewsName(record.id, entry);
      newsDefinitions.set(newsName, { messages });
      activeNews.push({ name: newsName, entry, government });
    }

    lines.push(`# EVN crön ${record.id}: Random ${random}, PreHoldoff ${preHoldoff}, Duration ${duration}, PostHoldoff ${postHoldoff}.`);
    lines.push(`event ${q(eventName)}`);
    lines.push(`\tset ${q(activeFlag)}`);
    if (!emitEventBitActions(lines, data.OnStart, "\t")) {
      unsupportedActions++;
      lines.push(`\t# EVN OnStart preserved: ${q(data.OnStart)}`);
    }
    if (String(data.Flags || "0000") !== "0000") lines.push(`\t# EVN Flags preserved: ${q(data.Flags)}; continuous iteration requires dedicated ES logic.`);
    for (const news of activeNews) {
      lines.push(`\tnews ${q(news.name)}`);
      lines.push("\t\tlocation");
      if (news.entry.scope === "independent") lines.push(`\t\t\tnear ${q("Sol")} 100`);
      else lines.push(`\t\t\tgovernment ${q(news.government)}`);
    }
    lines.push("");

    lines.push(`event ${q(endName)}`);
    if (!emitEventBitActions(lines, data.OnEnd, "\t")) {
      unsupportedActions++;
      lines.push(`\t# EVN OnEnd preserved: ${q(data.OnEnd)}`);
    }
    for (const news of activeNews) {
      lines.push(`\tnews ${q(news.name)}`);
      lines.push("\t\tremove location");
    }
    lines.push(`\tclear ${q(activeFlag)}`);
    if (!postHoldoff) lines.push(`\tclear ${q(pendingFlag)}`);
    lines.push("");
    if (postHoldoff > 0) {
      lines.push(`event ${q(cooldownName)}`);
      lines.push(`\tclear ${q(pendingFlag)}`);
      lines.push("");
    }
    emitted++;

    missionLines.push(`mission ${q(`EVN crön scheduler ${record.id}: ${name}`)}`);
    missionLines.push("\tinvisible");
    missionLines.push("\tnon-blocking");
    missionLines.push("\tlanding");
    missionLines.push("\trepeat");
    missionLines.push("\tto offer");
    missionLines.push(`\t\tnot ${q(activeFlag)}`);
    missionLines.push(`\t\tnot ${q(pendingFlag)}`);
    if (enableOn && !emitEvnBitConditions(missionLines, enableOn, "\t\t")) {
      skippedCondition++;
      missionLines.push(`\t\t# EVN EnableOn preserved: ${q(enableOn)}`);
    }
    missionLines.push(`\t\trandom < ${random}`);
    missionLines.push("\ton offer");
    missionLines.push(`\t\tset ${q(pendingFlag)}`);
    missionLines.push(`\t\tevent ${q(eventName)} ${preHoldoff}`);
    missionLines.push(`\t\tevent ${q(endName)} ${endDelay}`);
    if (postHoldoff > 0) missionLines.push(`\t\tevent ${q(cooldownName)} ${cooldownDelay}`);
    missionLines.push("\t\tfail", "");
    scheduled++;
  }
  const newsLines = [
    "# EVN STR# news strings converted to ES news definitions.",
    "# Definitions stay inactive until crön start events add a location.",
    "# Independent EVN news uses near Sol 100 as an ES approximation of global news.",
    ""
  ];
  for (const [name, definition] of newsDefinitions) {
    newsLines.push(`news ${q(name)}`);
    newsLines.push("\tname", "\t\tword", `\t\t\t${q("EVN News")}`);
    newsLines.push("\tmessage", "\t\tword");
    for (const message of definition.messages) newsLines.push(`\t\t\t${esText(message)}`);
    newsLines.push("");
  }
  write(path.join(output, "data", "cron-events.txt"), lines.join("\n"));
  write(path.join(output, "data", "cron-schedulers.txt"), missionLines.join("\n"));
  write(path.join(output, "data", "news.txt"), newsLines.join("\n"));
  return { emitted, scheduled, skippedDate, skippedCondition, unsupportedActions, news: newsDefinitions.size, skippedNews };
}

function convertDisasters() {
  const lines = [
    "# EVN öops disasters converted to ES system-level trade events.",
    "# EVN changes one planet or station; ES trade prices belong to the containing system.",
    "# The hidden landing mission approximates EVN's daily Freq roll because ES has no daily random event hook.",
    ""
  ];
  const missionLines = [
    "# Hidden landing schedulers for EVN öops disasters.",
    "# Freq is applied when the player lands at the affected planet or station.",
    ""
  ];
  const byPlanet = new Map();
  const systems = new Map();
  for (const system of Object.values(normalized.System || {})) {
    if (system.parseError) continue;
    const systemName = safeName(system.name, `EVN system ${system.id}`);
    systems.set(systemName, systemTradeValues(system));
    for (const reference of system.planets || []) byPlanet.set(String(refId(reference)), { system, systemName });
  }
  let emitted = 0;
  let skipped = 0;
  for (const record of referenceData["öops"] || []) {
    const data = record.data || {};
    const target = Math.trunc(Number(data.Stellar));
    const commodity = EVN_COMMODITIES[Math.trunc(Number(data.Commodity))];
    const location = byPlanet.get(String(target));
    const targetPlanet = normalizedOf("Planet", target);
    const targetName = targetPlanet ? safeName(targetPlanet.name, `EVN planet ${target}`) : null;
    const base = location && commodity && systems.get(location.systemName).get(commodity.name);
    if (!location || !commodity || !Number.isFinite(base)) {
      lines.push(`# Skipped EVN öops ${record.id} ${q(record.name)}: no ES system market mapping.`);
      skipped++;
      continue;
    }
    const delta = Math.trunc(Number(data.PriceDelta) || 0);
    const adjusted = Math.max(1, base + delta);
    const eventName = `EVN öops ${record.id}: ${safeName(record.name, `disaster ${record.id}`)}`;
    const endName = `${eventName} end`;
    const activeFlag = `EVN öops active ${record.id}`;
    const freq = Math.max(1, Math.min(100, Math.trunc(Number(data.Freq) || 1)));
    const duration = Math.max(0, Math.trunc(Number(data.Duration) || 0));

    lines.push(`# EVN target ${targetName || `stellar ${target}`} in ${location.systemName}; base ${base}, delta ${delta}, duration ${duration}, frequency ${freq}.`);
    lines.push(`event ${q(eventName)}`);
    lines.push(`\tset ${q(activeFlag)}`);
    lines.push(`\tsystem ${q(location.systemName)}`);
    lines.push(`\t\ttrade ${q(commodity.name)} ${adjusted}`);
    if (data.ActivateOn) lines.push(`# EVN ActivateOn ${q(data.ActivateOn)} is enforced by the scheduler mission.`);
    lines.push("");
    if (duration > 0) {
      lines.push(`event ${q(endName)}`);
      lines.push(`\tclear ${q(activeFlag)}`);
      lines.push(`\tsystem ${q(location.systemName)}`);
      lines.push(`\t\ttrade ${q(commodity.name)} ${base}`);
      lines.push("");
    }

    missionLines.push(`mission ${q(`EVN öops scheduler ${record.id}: ${safeName(record.name, `disaster ${record.id}`)}`)}`);
    missionLines.push("\tinvisible");
    missionLines.push("\tnon-blocking");
    missionLines.push("\tlanding");
    missionLines.push("\trepeat");
    if (targetName) missionLines.push(`\tsource ${q(targetName)}`);
    missionLines.push("\tto offer");
    missionLines.push(`\t\tnot ${q(activeFlag)}`);
    if (data.ActivateOn && !emitEvnBitConditions(missionLines, data.ActivateOn, "\t\t")) missionLines.push(`\t\t# EVN ActivateOn preserved: ${q(data.ActivateOn)}`);
    missionLines.push(`\t\trandom < ${freq}`);
    missionLines.push("\ton offer");
    missionLines.push(`\t\tevent ${q(eventName)}`);
    if (duration > 0) missionLines.push(`\t\tevent ${q(endName)} ${duration}`);
    missionLines.push("\t\tfail", "");
    emitted++;
  }
  write(path.join(output, "data", "disasters.txt"), lines.join("\n"));
  write(path.join(output, "data", "disaster-schedulers.txt"), missionLines.join("\n"));
  return { emitted, skipped };
}

function preserveAllResources() {
  const sourceDir = path.join(output, "source");
  mkdir(sourceDir);
  const manifest = { generatedFrom: root, types: {}, normalized: {} };
  for (const [type, values] of Object.entries(resources)) {
    const file = `${type.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
    write(path.join(sourceDir, file), JSON.stringify(values, null, 2));
    manifest.types[type] = { count: Object.keys(values).length, file: `source/${file}`, esMapping: "preserved source data" };
  }
  for (const [type, values] of Object.entries(normalized)) {
    const file = `${type}.json`;
    write(path.join(sourceDir, file), JSON.stringify(values, null, 2));
    manifest.normalized[type] = { count: Object.keys(values).length, file: `source/${file}` };
  }
  write(path.join(output, "conversion-manifest.json"), JSON.stringify(manifest, null, 2));
}

function main() {
  for (const child of ["data", "source", "conversion-manifest.json"]) {
    fs.rmSync(path.join(output, child), { recursive: true, force: true });
  }
  mkdir(output);
  convertShips();
  convertOutfits();
  convertPlanets();
  convertShops();
  convertFleets();
  convertSystems();
  convertExplosions();
  prepareMenuArt();
  convertMenuInterface();
  convertStarts();
  convertGovernments();
  convertMissionStubs();
  const cron = convertCronEvents();
  const disasters = convertDisasters();
  preserveAllResources();
  console.log(JSON.stringify({ output, cron, disasters, normalized: Object.fromEntries(Object.entries(normalized).map(([k, v]) => [k, Object.keys(v).length])), raw: Object.fromEntries(Object.entries(resources).map(([k, v]) => [k, Object.keys(v).length])) }, null, 2));
}

main();
