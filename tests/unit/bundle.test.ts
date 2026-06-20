import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const binPath = fileURLToPath(new URL("../../bin/gyl", import.meta.url));

describe("bin/gyl bundle", () => {
  it("exists as a committed artifact", () => {
    expect(existsSync(binPath)).toBe(true);
  });

  it("runs --version and reports the current version", () => {
    const result = spawnSync(process.execPath, [binPath, "--version"], {
      encoding: "utf8"
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0.2.0");
  });
});
