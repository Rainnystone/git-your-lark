import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCreateFolderArgs, extractCreatedFolder, initCommand, renderInitConfig } from "../../scripts/commands/init.js";
import { parseConfig } from "../../scripts/lib/config.js";
import type { CommandResult } from "../../scripts/lib/lark-cli.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "gyl-init-"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

function outputPath(name = "git-your-lark.yml"): string {
  return join(tempDir, name);
}

function commandResult(result: Partial<CommandResult>): CommandResult {
  return {
    code: result.code ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

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

  it("rejects mutually exclusive existing-folder and create-folder modes", async () => {
    const path = outputPath();

    await expect(initCommand({
      remoteFolderToken: "fld_existing",
      createRemoteFolder: true,
      folderName: "Project Notes",
      outputPath: path
    })).resolves.toBe(1);
    expect(existsSync(path)).toBe(false);
  });

  it("refuses to overwrite an existing config without force", async () => {
    const path = outputPath();
    await writeFile(path, "remoteFolderToken: old\n", "utf8");

    await expect(initCommand({
      remoteFolderToken: "fld_new",
      outputPath: path
    })).resolves.toBe(1);
    await expect(readFile(path, "utf8")).resolves.toBe("remoteFolderToken: old\n");
  });

  it("overwrites an existing config when force is set", async () => {
    const path = outputPath();
    await writeFile(path, "remoteFolderToken: old\n", "utf8");

    await expect(initCommand({
      remoteFolderToken: "fld_new",
      remoteFolderUrl: "https://example/fld_new",
      outputPath: path,
      force: true
    })).resolves.toBe(0);

    const config = parseConfig(await readFile(path, "utf8"));
    expect(config.remoteFolderToken).toBe("fld_new");
    expect(config.remoteFolderUrl).toBe("https://example/fld_new");
  });

  it("does not write config when create-folder exits nonzero", async () => {
    const path = outputPath();

    await expect(initCommand({
      createRemoteFolder: true,
      folderName: "Project Notes",
      outputPath: path,
      run: async () => commandResult({ code: 1, stderr: "failed" })
    })).resolves.toBe(1);
    expect(existsSync(path)).toBe(false);
  });

  it("does not write config when create-folder returns bad JSON", async () => {
    const path = outputPath();

    await expect(initCommand({
      createRemoteFolder: true,
      folderName: "Project Notes",
      outputPath: path,
      run: async () => commandResult({ stdout: "not json" })
    })).resolves.toBe(1);
    expect(existsSync(path)).toBe(false);
  });

  it("does not write config when create-folder omits folder_token", async () => {
    const path = outputPath();

    await expect(initCommand({
      createRemoteFolder: true,
      folderName: "Project Notes",
      outputPath: path,
      run: async () => commandResult({ stdout: '{"data":{"url":"https://example/missing"}}' })
    })).resolves.toBe(1);
    expect(existsSync(path)).toBe(false);
  });

  it("writes parseable config after successful create-folder", async () => {
    const path = outputPath();

    await expect(initCommand({
      createRemoteFolder: true,
      folderName: "Project Notes",
      outputPath: path,
      run: async () => commandResult({
        stdout: 'warning {not json}\n{"data":{"folder_token":"fld_new","url":"https://example/fld_new"}}'
      })
    })).resolves.toBe(0);

    const config = parseConfig(await readFile(path, "utf8"));
    expect(config.remoteFolderToken).toBe("fld_new");
    expect(config.remoteFolderUrl).toBe("https://example/fld_new");
    expect(config.referenceMode).toBe("lark-doc-cite");
    expect(config.overwritePolicy).toBe("explicit-only");
  });
});
