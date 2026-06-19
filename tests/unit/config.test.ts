import { describe, expect, it } from "vitest";
import { parseConfig, defaultConfig } from "../../scripts/lib/config.js";

describe("parseConfig", () => {
  it("applies defaults and preserves required remote folder token", () => {
    const config = parseConfig(`
remoteFolderToken: fld_token
remoteFolderUrl: https://example.feishu.cn/drive/folder/fld_token
include:
  - "**/*.md"
`);

    expect(config.remoteFolderToken).toBe("fld_token");
    expect(config.remoteFolderUrl).toBe("https://example.feishu.cn/drive/folder/fld_token");
    expect(config.include).toEqual(["**/*.md"]);
    expect(config.exclude).toContain(".git-your-lark/**");
    expect(config.statePath).toBe(".git-your-lark/state.json");
    expect(config.referenceMode).toBe("lark-doc-cite");
    expect(config.conflictPolicy).toBe("stop");
  });

  it("rejects missing remote folder token", () => {
    expect(() => parseConfig("include: [\"**/*.md\"]")).toThrow(/remoteFolderToken/);
  });

  it("exposes a safe default config", () => {
    expect(defaultConfig.include).toEqual(["**/*.md"]);
    expect(defaultConfig.overwritePolicy).toBe("explicit-only");
  });
});
