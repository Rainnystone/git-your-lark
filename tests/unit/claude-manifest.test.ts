import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateClaudePlugin } from "../../scripts/claude-manifest.mjs";

// Error messages embed the OS-native path (e.g. `...\bin\gyl` on Windows vs
// `.../bin/gyl` on POSIX). Normalize slashes before substring-checking so the
// assertions hold on both.
function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gyl-claude-"));
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writePlugin(extra: Record<string, unknown> = {}) {
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "git-your-lark", description: "d", version: "0.3.0", ...extra })
  );
}

function writeMarket(plugins: unknown[] = [{ name: "git-your-lark", source: "./" }]) {
  writeFileSync(
    join(root, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "git-your-lark", owner: { name: "Rainnystone" }, plugins })
  );
}

describe("validateClaudePlugin (manifests)", () => {
  it("returns no errors for valid manifests", () => {
    writePlugin();
    writeMarket();
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(join(root, "bin", "gyl"), "#!/usr/bin/env node\n");
    chmodSync(join(root, "bin", "gyl"), 0o755);
    expect(validateClaudePlugin(root)).toEqual([]);
  });

  it("reports missing bin/gyl", () => {
    writePlugin();
    writeMarket();
    expect(
      validateClaudePlugin(root).some((e) => normalizeSlashes(e).includes("bin/gyl"))
    ).toBe(true);
  });

  // The POSIX exec-bit check in validateClaudePlugin is intentionally skipped
  // on Windows (fs.statSync().mode exec bits are meaningless there), so this
  // test — which asserts the validator flags a non-executable file — only
  // applies on macOS/Linux.
  it.skipIf(process.platform === "win32")("reports non-executable bin/gyl", () => {
    writePlugin();
    writeMarket();
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(join(root, "bin", "gyl"), "#!/usr/bin/env node\n");
    chmodSync(join(root, "bin", "gyl"), 0o644);
    expect(validateClaudePlugin(root).some((e) => e.includes("not executable"))).toBe(true);
  });

  it("reports missing plugin.json", () => {
    writeMarket();
    expect(validateClaudePlugin(root).some((e) => e.includes("plugin.json"))).toBe(true);
  });

  it("reports missing marketplace.json", () => {
    writePlugin();
    expect(validateClaudePlugin(root).some((e) => e.includes("marketplace.json"))).toBe(true);
  });

  it("reports missing required plugin fields", () => {
    writeFileSync(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "git-your-lark" }));
    writeMarket();
    const errors = validateClaudePlugin(root);
    expect(errors.some((e) => e.includes("description"))).toBe(true);
    expect(errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("reports invalid JSON", () => {
    writeFileSync(join(root, ".claude-plugin", "plugin.json"), "{ not json");
    writeMarket();
    expect(validateClaudePlugin(root).some((e) => e.includes("invalid JSON"))).toBe(true);
  });

  it("reports marketplace missing git-your-lark entry", () => {
    writePlugin();
    writeMarket([{ name: "other", source: "./" }]);
    expect(validateClaudePlugin(root).some((e) => e.includes("git-your-lark"))).toBe(true);
  });

  it("reports marketplace entry missing source", () => {
    writePlugin();
    writeMarket([{ name: "git-your-lark" }]);
    expect(validateClaudePlugin(root).some((e) => e.includes("source"))).toBe(true);
  });
});
