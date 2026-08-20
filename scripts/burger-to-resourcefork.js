#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const input = path.resolve(process.env.BURGER_JSON || path.join(__dirname, "..", "parsed-data", "burger-resources.json"));
const outputRoot = path.resolve(process.env.NOVAPARSE_SOURCE || path.join(__dirname, "..", "parsed-data", "novaparse-source"));

// Reverse map for the MacRoman decoder used by resourceforkjs.
const macRomanHigh = "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";
const macRomanEncode = new Map([...macRomanHigh].map((char, index) => [char, index + 0x80]));

function encodeMacRoman(value) {
  const bytes = [];
  for (const char of String(value || "")) {
    const code = char.codePointAt(0);
    if (code < 0x80) bytes.push(code);
    else if (macRomanEncode.has(char)) bytes.push(macRomanEncode.get(char));
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

function u16(value) { const b = Buffer.alloc(2); b.writeUInt16BE(value); return b; }
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; }

function makeResourceFork(resources) {
  const dataParts = [];
  let dataLength = 0;
  const refs = resources.map(resource => {
    const raw = Buffer.from(resource.dataBase64, "base64");
    const offset = dataLength;
    const part = Buffer.concat([u32(raw.length), raw]);
    dataParts.push(part);
    dataLength += part.length;
    return { ...resource, raw, offset };
  });
  const dataOffset = 256;
  const data = Buffer.concat([Buffer.alloc(dataOffset), ...dataParts]);

  const types = [...new Set(refs.map(resource => resource.type))].sort((a, b) => Buffer.compare(encodeMacRoman(a), encodeMacRoman(b)));
  const typeList = [];
  typeList.push(u16(types.length - 1));
  const typeRefStart = 2 + types.length * 8;
  let refOffset = typeRefStart;
  const names = [];
  const nameOffsets = new Map();
  for (const resource of refs) {
    const name = encodeMacRoman(resource.name);
    if (name.length && name.length < 256 && !nameOffsets.has(resource.name)) {
      nameOffsets.set(resource.name, names.reduce((size, item) => size + item.length, 0));
      names.push(Buffer.concat([Buffer.from([name.length]), name]));
    }
  }
  for (const type of types) {
    const typed = refs.filter(resource => resource.type === type).sort((a, b) => a.id - b.id);
    typeList.push(encodeMacRoman(type).subarray(0, 4));
    typeList.push(u16(typed.length - 1));
    typeList.push(u16(refOffset));
    refOffset += typed.length * 12;
  }
  const nameListOffset = 28 + refOffset;
  const refParts = [];
  for (const type of types) {
    const typed = refs.filter(resource => resource.type === type).sort((a, b) => a.id - b.id);
    for (const resource of typed) {
      const nameOffset = nameOffsets.has(resource.name) ? nameOffsets.get(resource.name) : 0xffff;
      const dataOffset24 = resource.offset;
      refParts.push(Buffer.concat([
        u16(resource.id & 0xffff),
        u16(nameOffset),
        Buffer.from([0]),
        Buffer.from([(dataOffset24 >>> 16) & 0xff, (dataOffset24 >>> 8) & 0xff, dataOffset24 & 0xff]),
        Buffer.alloc(4)
      ]));
    }
  }
  const mapOffset = data.length;
  const mapBody = Buffer.concat([
    Buffer.alloc(16),
    u16(0),
    Buffer.alloc(6),
    u16(28),
    u16(nameListOffset),
    Buffer.concat(typeList),
    Buffer.concat(refParts),
    Buffer.concat(names)
  ]);
  const mapLength = mapBody.length;
  const header = Buffer.concat([u32(dataOffset), u32(mapOffset), u32(data.length - dataOffset), u32(mapLength)]);
  header.copy(data, 0);
  header.copy(mapBody, 0);
  return Buffer.concat([data, mapBody]);
}

function main() {
  const source = JSON.parse(fs.readFileSync(input, "utf8"));
  fs.rmSync(outputRoot, { recursive: true, force: true });
  const byFile = new Map();
  for (const resource of source.resources) {
    const file = resource.source.replaceAll("\\", "/");
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(resource);
  }
  for (const [sourceFile, resources] of byFile) {
    const target = path.join(outputRoot, "Nova Files", path.basename(sourceFile).replace(/\.rez$/i, ".ndat"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, makeResourceFork(resources));
  }
  fs.mkdirSync(path.join(outputRoot, "Plug-ins"), { recursive: true });
  console.log(`Wrote ${byFile.size} NovaParse source files to ${outputRoot}`);
}

main();
