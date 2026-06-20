import { describe, expect, it } from "vitest";
import { analyzeDoctor } from "../../scripts/commands/doctor.js";

describe("analyzeDoctor", () => {
  it("passes when lark-cli path, version, auth and required commands are ok", () => {
    const result = analyzeDoctor({
      larkCliPath: "lark-cli",
      versionOutput: "lark-cli version 1.0.56",
      authOutput: "OK: authorized",
      requiredCommands: {
        "drive files list": true,
        "drive +create-folder": true,
        "drive +import": true,
        "docs +fetch": true,
        "docs +update": true,
        "docs +media-insert": true
      }
    });

    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("reports missing lark-cli", () => {
    const result = analyzeDoctor({
      larkCliPath: "",
      versionOutput: "",
      authOutput: "",
      requiredCommands: {}
    });

    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toMatch(/lark-cli/);
  });
});
