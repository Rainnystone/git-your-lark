import { describe, expect, it } from "vitest";
import { buildCreateFolderArgs, extractCreatedFolder, renderInitConfig } from "../../scripts/commands/init.js";

describe("renderInitConfig", () => {
  it("includes remote folder token/url, lark doc references, and explicit-only overwrite policy", () => {
    const yaml = renderInitConfig({
      remoteFolderToken: "fld_token",
      remoteFolderUrl: "https://example.feishu.cn/drive/folder/fld_token",
      workspaceRoot: "."
    });

    expect(yaml).toContain('remoteFolderToken: "fld_token"');
    expect(yaml).toContain('remoteFolderUrl: "https://example.feishu.cn/drive/folder/fld_token"');
    expect(yaml).toContain("referenceMode: lark-doc-cite");
    expect(yaml).toContain("overwritePolicy: explicit-only");
  });

  it("builds create-folder args for first publish under user drive root", () => {
    expect(buildCreateFolderArgs({ folderName: "Project Notes" })).toEqual([
      "drive",
      "+create-folder",
      "--as",
      "user",
      "--name",
      "Project Notes",
      "--json"
    ]);
  });

  it("builds create-folder args under a parent folder", () => {
    expect(buildCreateFolderArgs({ folderName: "Project Notes", parentFolderToken: "parent" })).toEqual([
      "drive",
      "+create-folder",
      "--as",
      "user",
      "--folder-token",
      "parent",
      "--name",
      "Project Notes",
      "--json"
    ]);
  });

  it("extracts created folder metadata", () => {
    expect(extractCreatedFolder({ data: { folder_token: "fld_new", url: "https://example/fld_new" } })).toEqual({
      remoteFolderToken: "fld_new",
      remoteFolderUrl: "https://example/fld_new"
    });
  });
});
