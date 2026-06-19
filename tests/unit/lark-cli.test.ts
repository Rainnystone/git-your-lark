import { describe, expect, it } from "vitest";
import { extractJson, runCommand } from "../../scripts/lib/lark-cli.js";

describe("extractJson", () => {
  it("skips earlier braces that are not valid JSON", () => {
    expect(extractJson('warning {not json}\n{"data":{"folder_token":"fld"}}')).toEqual({
      data: { folder_token: "fld" }
    });
  });
});

describe("runCommand", () => {
  it("returns a nonzero result when the executable is missing", async () => {
    const result = await runCommand("definitely-not-a-real-gyl-executable", []);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/ENOENT|not found|no such file/i);
  });
});
