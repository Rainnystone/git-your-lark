#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const requiredFiles = [
  "package.json",
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
  ".codex-plugin/plugin.json",
  "skills/sync-workspace/SKILL.md",
  "docs/examples/basic/git-your-lark.yml",
  "dist/gyl.js",
  "dist/scripts/gyl.js",
  "dist/scripts/lib/config.js"
];

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const missingLifecycleScripts = ["prepack", "prepare"].filter(
  (scriptName) => !packageJson.scripts?.[scriptName]?.includes("npm run build")
);

if (missingLifecycleScripts.length > 0) {
  console.error(
    `Package is missing build lifecycle scripts:\n${missingLifecycleScripts.map((scriptName) => `- ${scriptName}`).join("\n")}`
  );
  process.exit(1);
}

const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--silent"], {
  encoding: "utf8"
});

if (result.error) {
  console.error(`Failed to inspect npm pack contents: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.stdout.write(result.stdout);
  process.exit(result.status ?? 1);
}

let packInfo;
try {
  packInfo = JSON.parse(result.stdout);
} catch (error) {
  console.error("npm pack did not return JSON output.");
  process.stderr.write(result.stderr);
  process.stdout.write(result.stdout);
  process.exit(1);
}

const packedFiles = new Set((packInfo[0]?.files ?? []).map((file) => file.path));
const missing = requiredFiles.filter((path) => !packedFiles.has(path));

if (missing.length > 0) {
  console.error(`Package is missing required files:\n${missing.map((path) => `- ${path}`).join("\n")}`);
  process.exit(1);
}

console.log(`Package contents include ${requiredFiles.length} required files.`);
