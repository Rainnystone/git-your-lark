import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const IS_WIN = process.platform === "win32";

const REQUIRED_PLUGIN_FIELDS = ["name", "description", "version"];
const REQUIRED_MARKETPLACE_FIELDS = ["name", "owner", "plugins"];

function readJson(filePath) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(filePath, "utf8")) };
  } catch (error) {
    return { ok: false, error: `invalid JSON in ${filePath}: ${error.message}` };
  }
}

export function validateClaudePlugin(rootDir) {
  const errors = [];
  const pluginPath = join(rootDir, ".claude-plugin", "plugin.json");
  const marketplacePath = join(rootDir, ".claude-plugin", "marketplace.json");

  if (!existsSync(pluginPath)) {
    errors.push(`missing ${pluginPath}`);
  } else {
    const result = readJson(pluginPath);
    if (!result.ok) {
      errors.push(result.error);
    } else {
      for (const field of REQUIRED_PLUGIN_FIELDS) {
        if (!result.value[field]) {
          errors.push(`.claude-plugin/plugin.json missing field: ${field}`);
        }
      }
    }
  }

  if (!existsSync(marketplacePath)) {
    errors.push(`missing ${marketplacePath}`);
  } else {
    const result = readJson(marketplacePath);
    if (!result.ok) {
      errors.push(result.error);
    } else {
      for (const field of REQUIRED_MARKETPLACE_FIELDS) {
        if (!result.value[field]) {
          errors.push(`.claude-plugin/marketplace.json missing field: ${field}`);
        }
      }
      const entry = Array.isArray(result.value.plugins)
        ? result.value.plugins.find((p) => p?.name === "git-your-lark")
        : null;
      if (!entry) {
        errors.push(".claude-plugin/marketplace.json missing plugin entry: git-your-lark");
      } else if (!entry.source) {
        errors.push(".claude-plugin/marketplace.json git-your-lark entry missing field: source");
      }
    }
  }

  const binGylPath = join(rootDir, "bin", "gyl");
  if (!existsSync(binGylPath)) {
    errors.push(`missing ${binGylPath}`);
  } else if (!IS_WIN) {
    // The POSIX executable-bit check is meaningful here; verify the bundle was
    // made executable (npm run build:bundle chmods it).
    const mode = statSync(binGylPath).mode & 0o777;
    if (!(mode & 0o111)) {
      errors.push(`${binGylPath} is not executable (run: npm run build:bundle)`);
    }
  }

  if (IS_WIN) {
    // Windows ignores the `#!/usr/bin/env node` shebang and cannot execute the
    // extensionless `bin/gyl` directly from PATH. The Claude Code plugin places
    // this `bin/` directory on PATH, so on Windows the runnable entry point is
    // `bin/gyl.cmd`. Validate it exists so a plugin install cannot pass
    // validation but fail the first `gyl doctor`. (The exec-bit check above is
    // skipped on Windows for the same reason: fs.statSync().mode exec bits are
    // synthesized and meaningless there.)
    const binGylCmdPath = join(rootDir, "bin", "gyl.cmd");
    if (!existsSync(binGylCmdPath)) {
      errors.push(`${binGylCmdPath} is missing (run: npm run build:bundle)`);
    }
  }

  return errors;
}
