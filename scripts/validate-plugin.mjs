#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateClaudePlugin } from "./claude-manifest.mjs";

// Claude Code plugin validation (runs independently of Codex tooling).
const claudeErrors = validateClaudePlugin(process.cwd());
if (claudeErrors.length > 0) {
  console.error(
    `Claude plugin validation failed:\n${claudeErrors.map((e) => `- ${e}`).join("\n")}`
  );
  process.exit(1);
}
console.log("Claude plugin manifest OK.");

// Codex plugin validation (delegates to the Codex plugin-creator skill).
const validatorPath = join(
  homedir(),
  ".codex",
  "skills",
  ".system",
  "plugin-creator",
  "scripts",
  "validate_plugin.py"
);

if (!existsSync(validatorPath)) {
  console.error(
    [
      "Codex plugin validator was not found.",
      `Expected: ${validatorPath}`,
      "Install or restore the Codex plugin-creator skill, then rerun npm run validate:plugin."
    ].join("\n")
  );
  process.exit(1);
}

const result = spawnSync("python3", [validatorPath, "."], {
  stdio: "inherit"
});

if (result.error) {
  console.error(`Failed to run plugin validator: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
