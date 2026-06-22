import { describe, expect, expectTypeOf, it } from "vitest";
import { parseConfig, defaultConfig, requirePublishConfig } from "../../scripts/lib/config.js";

describe("parseConfig", () => {
  it("accepts a pull-only config without remoteFolderToken", () => {
    const config = parseConfig(`
workspaceRoot: "."
pull:
  source:
    type: wiki_node
    tokenOrUrl: "https://example.feishu.cn/wiki/wiki_token"
  outputDir: "."
`);

    expect(config.remoteFolderToken).toBeUndefined();
    expect(config.pull?.source).toEqual({
      type: "wiki_node",
      tokenOrUrl: "https://example.feishu.cn/wiki/wiki_token"
    });
    expect(config.pull?.outputDir).toBe(".");
    expect(config.pull?.linkMode).toBe("obsidian-wiki");
    expect(config.pull?.assetPolicy).toEqual({
      mode: "per-document-folder",
      directoryName: "assets"
    });
  });

  it("types legacy remoteFolderToken as optional", () => {
    const config = parseConfig(`
pull:
  source:
    type: doc
    tokenOrUrl: "doc_token"
`);

    expect(config.remoteFolderToken).toBeUndefined();
    expectTypeOf(config.remoteFolderToken).toEqualTypeOf<string | undefined>();
  });

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

  it("still accepts the legacy publish config shape", () => {
    const config = parseConfig(`
workspaceRoot: "."
remoteFolderToken: "fld_remote"
remoteFolderUrl: "https://example.feishu.cn/drive/folder/fld_remote"
`);

    expect(config.remoteFolderToken).toBe("fld_remote");
    expect(config.publish?.remoteFolderToken).toBeUndefined();
  });

  it("returns publish config through requirePublishConfig", () => {
    const config = parseConfig(`
workspaceRoot: "."
publish:
  remoteFolderToken: "fld_nested"
  remoteFolderUrl: "https://example.test/folder"
`);

    expect(requirePublishConfig(config)).toEqual({
      remoteFolderToken: "fld_nested",
      remoteFolderUrl: "https://example.test/folder"
    });
  });

  it("rejects publish commands when no publish target exists", () => {
    const config = parseConfig(`
pull:
  source:
    type: doc
    tokenOrUrl: "doc_token"
`);

    expect(() => requirePublishConfig(config)).toThrow(/publish remote folder token/i);
  });

  it("defers missing publish target validation until publish config is required", () => {
    const config = parseConfig("include: [\"**/*.md\"]");

    expect(config.remoteFolderToken).toBeUndefined();
    expect(() => requirePublishConfig(config)).toThrow(/publish remote folder token/i);
  });

  it("rejects whitespace-only remote folder token", () => {
    expect(() => parseConfig("remoteFolderToken: '   '")).toThrow(/remoteFolderToken/);
  });

  it("rejects unknown config keys", () => {
    expect(() => parseConfig(`
remoteFolderTokn: fld_token
remoteFolderToken: fld_token
`)).toThrow(/remoteFolderTokn/);
  });

  it("rejects unknown nested rate limit keys", () => {
    expect(() => parseConfig(`
remoteFolderToken: fld
rateLimit:
  typo: 1
`)).toThrow(/typo/);
  });

  it("rejects unimplemented rate limit retry configuration", () => {
    expect(() => parseConfig(`
remoteFolderToken: fld
rateLimit:
  retries: 4
`)).toThrow(/retries/);
  });

  it("exposes a safe default config", () => {
    expect(defaultConfig.include).toEqual(["**/*.md"]);
    expect(defaultConfig.overwritePolicy).toBe("explicit-only");
  });
});
