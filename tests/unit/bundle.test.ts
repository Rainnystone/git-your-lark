import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const binPath = fileURLToPath(new URL("../../bin/gyl", import.meta.url));
const checkBundleScriptPath = fileURLToPath(new URL("../../scripts/check-bundle.mjs", import.meta.url));

describe("bin/gyl bundle", () => {
  it("exists as a committed artifact", () => {
    expect(existsSync(binPath)).toBe(true);
  });

  it("runs --version and reports the current version", () => {
    const result = spawnSync(process.execPath, [binPath, "--version"], {
      encoding: "utf8"
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0.3.0");
  });

  it("bundle drift check fails when tracked bin artifacts differ from the working tree", () => {
    const root = mkdtempSync(join(tmpdir(), "gyl-bundle-drift-"));
    try {
      mkdirSync(join(root, "bin"), { recursive: true });
      writeFileSync(join(root, "bin", "gyl"), "#!/usr/bin/env node\nconsole.log('old');\n");
      writeFileSync(join(root, "bin", "gyl.cmd"), "@echo off\r\nnode \"%~dp0gyl\" %*\r\n");
      expect(spawnSync("git", ["init"], { cwd: root }).status).toBe(0);
      expect(spawnSync("git", ["add", "bin/gyl", "bin/gyl.cmd"], { cwd: root }).status).toBe(0);

      writeFileSync(join(root, "bin", "gyl"), "#!/usr/bin/env node\nconsole.log('new');\n");
      const result = spawnSync(process.execPath, [checkBundleScriptPath, "--git-diff"], {
        cwd: root,
        encoding: "utf8"
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Bundled CLI artifacts are out of date");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses a Windows-safe junction for node_modules links", async () => {
    // @ts-ignore check-bundle is an ESM script without TypeScript declarations.
    const bundleCheck = await import("../../scripts/check-bundle.mjs") as {
      nodeModulesLinkType: (platform: string) => "dir" | "junction";
    };

    expect(bundleCheck.nodeModulesLinkType("win32")).toBe("junction");
    expect(bundleCheck.nodeModulesLinkType("darwin")).toBe("dir");
    expect(bundleCheck.nodeModulesLinkType("linux")).toBe("dir");
  });
});
