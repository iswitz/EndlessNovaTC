const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "converted-plugin", "data");

function read(name) {
	return fs.readFileSync(path.join(dataDir, name), "utf8");
}

function decodeQuoted(value) {
	return JSON.parse(`"${value}"`);
}

function eventNames(text) {
	const names = new Set();
	for (const match of text.matchAll(/^event "((?:[^"\\]|\\.)*)"\s*$/gm)) names.add(decodeQuoted(match[1]));
	return names;
}

function eventReferences(text) {
	const names = [];
	for (const match of text.matchAll(/^\s+event "((?:[^"\\]|\\.)*)"(?:\s+\d+)?\s*$/gm)) names.push(decodeQuoted(match[1]));
	return names;
}

function missionBlocks(text) {
	return [...text.matchAll(/^mission "((?:[^"\\]|\\.)*)"\s*\n([\s\S]*?)(?=^mission |(?![\s\S]))/gm)]
		.map(match => ({ name: decodeQuoted(match[1]), body: match[2] }));
}

function validateScheduler(kind, eventFile, schedulerFile) {
	const events = eventNames(read(eventFile));
	const schedulerText = read(schedulerFile);
	const missions = missionBlocks(schedulerText);
	const references = eventReferences(schedulerText);
	const missingEvents = references.filter(name => !events.has(name));
	const invalidMissions = [];
	for (const mission of missions) {
		const body = mission.body;
		const required = [
			[/^\tinvisible$/m, "invisible"],
			[/^\tnon-blocking$/m, "non-blocking"],
			[/^\tlanding$/m, "landing"],
			[/^\trepeat$/m, "repeat"],
			[/^\tto offer$/m, "to offer"],
			[/^\ton offer$/m, "on offer"],
			[/^\t\trandom < \d+$/m, "random"],
			[/^\t\tfail$/m, "fail"]
		];
		const missing = required.filter(([pattern]) => !pattern.test(body)).map(([, label]) => label);
		if (missing.length) invalidMissions.push({ name: mission.name, missing });
	}
	return {
		kind,
		eventDefinitions: events.size,
		schedulerMissions: missions.length,
		eventReferences: references.length,
		missingEvents: [...new Set(missingEvents)],
		invalidMissions
	};
}

const results = [
	validateScheduler("crön", "cron-events.txt", "cron-schedulers.txt"),
	validateScheduler("öops", "disasters.txt", "disaster-schedulers.txt")
];

const failures = results.filter(result => result.missingEvents.length || result.invalidMissions.length);
for (const result of results) {
	console.log(`${result.kind}: ${result.schedulerMissions} scheduler missions, ${result.eventDefinitions} event definitions, ${result.eventReferences} event references`);
	if (result.missingEvents.length) console.error(`  missing events: ${result.missingEvents.join(", ")}`);
	if (result.invalidMissions.length) console.error(`  invalid missions: ${result.invalidMissions.map(item => `${item.name} [${item.missing.join(", ")}]`).join("; ")}`);
}
if (failures.length) process.exitCode = 1;
