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
    // The POSIX executable-bit check is meaningless on Windows: Node synthesizes
    // `fs.statSync().mode` and the owner-exec bit (`0o100`) is typically unset,
    // so this check would always report "not executable" there. The bundled
    // `bin/gyl` is invoked via the npm `.cmd` shim (see package.json "bin"),
    // which does not rely on the exec bit, so skipping on Windows is safe.
    const mode = statSync(binGylPath).mode & 0o777;
    if (!(mode & 0o111)) {
      errors.push(`${binGylPath} is not executable (run: npm run build:bundle)`);
    }
  }

  return errors;
}
