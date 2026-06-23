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

    // A missing executable must always surface as a failure. The exit code is
    // the reliable, locale-independent signal: on POSIX (no shell) Node emits
    // `ENOENT`; on Windows we spawn through cmd.exe (see lark-cli.ts), so a
    // missing command surfaces as cmd's localized "'X' is not recognized as an
    // internal or external command" message — e.g. zh-CN Windows prints a
    // GBK-encoded Chinese phrase that no ASCII regex can match. Asserting
    // nonzero code plus a non-empty stderr keeps this portable across locales
    // without hard-coding a specific error string.
    expect(result.code).not.toBe(0);
    expect(result.stderr.trim().length).toBeGreaterThan(0);
  });
});
