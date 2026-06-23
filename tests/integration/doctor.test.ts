import { describe, expect, it } from "vitest";
import { analyzeDoctor, REQUIRED_LARK_COMMANDS } from "../../scripts/commands/doctor.js";

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
        "docs +media-insert": true,
        "drive +inspect": true,
        "wiki +node-get": true,
        "wiki +node-list": true,
        "docs +media-download": true
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

  it("requires the pull lark-cli commands used by Lark-to-Obsidian imports", () => {
    expect(REQUIRED_LARK_COMMANDS).toEqual([
      "drive files list",
      "drive +create-folder",
      "drive +import",
      "docs +fetch",
      "docs +update",
      "docs +media-insert",
      "drive +inspect",
      "wiki +node-get",
      "wiki +node-list",
      "docs +media-download"
    ]);

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

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      "Required lark-cli command is unavailable: drive +inspect",
      "Required lark-cli command is unavailable: wiki +node-get",
      "Required lark-cli command is unavailable: wiki +node-list",
      "Required lark-cli command is unavailable: docs +media-download"
    ]);
  });
});
