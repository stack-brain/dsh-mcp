import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { applyToolControl } from "../lib/tool-assembly.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** The dsh version installed on this machine (npm global + DeepSeek Harness.app). */
const HOST_VERSION = "0.2.2-rc.1";

/** Live plugin state the transform receives. */
function state() {
	return {
		toolSwitches: new Map(),
		toolMode: "all",
		hotTools: new Map(),
		serverOf: (name) => name.slice(5).split("__")[0],
		promptText: () => "prompt"
	};
}

test("dsh.supported matches the compatibility docs for the local 0.2.2-rc.1 host", () => {
	const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
	assert.equal(pkg.dsh.supported, HOST_VERSION);
	for (const file of ["README.md", "README.en.md", "CHANGELOG.md", "CHANGELOG.en.md"]) {
		const text = readFileSync(join(ROOT, file), "utf8");
		const header = text.split("## [1.15.0]")[0];
		assert.match(header, /0\.2\.2-rc\.1/, `${file}: compatibility section must declare the local host version`);
		const note = text.split("\n").find((line) => line.includes("**支持版本**：`dsh") || line.includes("**Supported DSH version**: `dsh"));
		if (note) assert.ok(note.includes(HOST_VERSION), `${file}: README header still declares an older host`);
	}
});

test("every non-host runtime import under lib/ is declared in dependencies", () => {
	const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
	const declared = new Set(Object.keys(pkg.dependencies ?? {}));
	const lib = join(ROOT, "lib");
	const imported = new Set();
	for (const file of readdirSync(lib).filter((name) => name.endsWith(".js"))) {
		const source = readFileSync(join(lib, file), "utf8");
		for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
			const spec = match[1];
			if (spec.startsWith(".") || spec.startsWith("node:")) continue;
			if (spec.startsWith("@deepseek-ai/")) continue; // supplied by the DSH host
			imported.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
		}
	}
	assert.ok(imported.has("js-yaml"), "lib/cordis-servers.js still imports js-yaml");
	for (const name of imported) {
		assert.ok(declared.has(name), `lib/ imports ${name} but package.json.dependencies does not declare it (fresh installs would fail at activation)`);
	}
});

test("applyToolControl degrades without mutating the assembly for every non-array tools shape", () => {
	const cases = [
		["undefined", undefined],
		["null", null],
		["0.2.2-shaped assembly (no tools)", { sections: [], contexts: [], variables: {} }],
		["tools: undefined", { tools: undefined }],
		["tools: null", { tools: null }],
		["tools: plain object", { tools: { "mcp__a__b": { name: "mcp__a__b" } } }],
		["tools: string", { tools: "mcp__a__b" }],
		["tools: Promise", { tools: Promise.resolve([]) }],
		["tools: array-like object", { tools: { 0: { name: "mcp__a__b" }, length: 1 } }]
	];
	for (const [label, assembly] of cases) {
		const beforeKeys = assembly === null || assembly === undefined ? null : Object.keys(assembly).join(",");
		const beforeTools = assembly === null || assembly === undefined ? null : assembly.tools;
		assert.equal(applyToolControl(assembly, state()), false, `${label}: must report "not applied"`);
		if (assembly === null || assembly === undefined) continue;
		assert.equal(Object.keys(assembly).join(","), beforeKeys, `${label}: must not add/remove keys`);
		assert.equal(assembly.tools, beforeTools, `${label}: must not replace or inject a tool list`);
	}
});

test("the degraded state is logged once, not on every turn", () => {
	const source = readFileSync(join(ROOT, "lib", "index.js"), "utf8");
	assert.match(source, /if \(!applied && !this\.assembleToolsUnavailableLogged\)/, "warn must be gated by a one-shot flag");
});
