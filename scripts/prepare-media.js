#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const root = path.resolve(process.env.EVN_OUTPUT || path.join(__dirname, "..", "parsed-data"));
const source = JSON.parse(fs.readFileSync(path.join(root, "burger-resources.json"), "utf8"));
const resources = source.resources.filter(resource => resource.type === "rlëD" || resource.type === "snd ");
fs.writeFileSync(path.join(root, "media-resources.json"), JSON.stringify({ resources }) + "\n");
console.log(`Prepared ${resources.length} media resources.`);
