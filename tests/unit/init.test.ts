import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCreateFolderArgs, extractCreatedFolder, initCommand, renderInitConfig, renderWorkspaceGitattributes, writeWorkspaceGitattributes } from "../../scripts/commands/init.js";
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

function runGyl(args: string[]) {
  // `node --import tsx` loads tsx as an ESM loader and runs the TS source
  // directly, without going through a bin shim. This avoids resolving
  // `./node_modules/.bin/tsx` (which is `tsx.cmd` on Windows and does not
  // work as a positional node argument) and works identically on every
  // platform. Requires tsx >= 4.19 (we depend on ^4.19.2).
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/gyl.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
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
    expect(yaml).not.toContain("retries:");
  });

  it("renders a pull block for wiki node imports", () => {
    const yaml = renderInitConfig({
      workspaceRoot: ".",
      pullSourceType: "wiki_node",
      pullSourceTokenOrUrl: "https://example.feishu.cn/wiki/wiki_token",
      pullOutputDir: "."
    });

    expect(yaml).toContain("pull:");
    expect(yaml).toContain('type: "wiki_node"');
    expect(yaml).toContain('tokenOrUrl: "https://example.feishu.cn/wiki/wiki_token"');
    expect(yaml).toContain('outputDir: "."');
  });

  it("renders both publish and pull sections when both are configured", () => {
    const yaml = renderInitConfig({
      remoteFolderToken: "fld_token",
      remoteFolderUrl: "https://example.feishu.cn/drive/folder/fld_token",
      workspaceRoot: ".",
      pullSourceType: "doc",
      pullSourceTokenOrUrl: "https://example.feishu.cn/docx/doc_token",
      pullOutputDir: "Imported"
    });

    const config = parseConfig(yaml);
    expect(config.remoteFolderToken).toBe("fld_token");
    expect(config.remoteFolderUrl).toBe("https://example.feishu.cn/drive/folder/fld_token");
    expect(config.pull?.source.type).toBe("doc");
    expect(config.pull?.source.tokenOrUrl).toBe("https://example.feishu.cn/docx/doc_token");
    expect(config.pull?.outputDir).toBe("Imported");
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

  it("writes pull-only config without a publish remote folder", async () => {
    const path = outputPath();

    await expect(initCommand({
      pullSourceType: "folder",
      pullSourceTokenOrUrl: "fld_source",
      pullOutputDir: "Imported",
      outputPath: path
    })).resolves.toBe(0);

    const config = parseConfig(await readFile(path, "utf8"));
    expect(config.remoteFolderToken).toBeUndefined();
    expect(config.pull?.source.type).toBe("folder");
    expect(config.pull?.source.tokenOrUrl).toBe("fld_source");
    expect(config.pull?.outputDir).toBe("Imported");
  });

  it("requires pull source when pull source type is supplied", async () => {
    const path = outputPath();

    await expect(initCommand({
      pullSourceType: "doc",
      outputPath: path
    })).resolves.toBe(1);
    expect(existsSync(path)).toBe(false);
  });

  it("requires pull source type when pull source is supplied", async () => {
    const path = outputPath();

    await expect(initCommand({
      pullSourceTokenOrUrl: "https://example.feishu.cn/docx/doc_token",
      outputPath: path
    })).resolves.toBe(1);
    expect(existsSync(path)).toBe(false);
  });

  it("keeps the publish-first error when no publish or pull options are supplied", async () => {
    const path = outputPath();

    await expect(initCommand({ outputPath: path })).resolves.toBe(1);
    expect(console.error).toHaveBeenCalledWith("Missing --remote-folder-token. For first publish, pass --create-remote-folder --folder-name <name>.");
    expect(existsSync(path)).toBe(false);
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

  it("accepts pull init CLI options for doc, folder, and wiki_node sources", async () => {
    for (const type of ["doc", "folder", "wiki_node"]) {
      const path = outputPath(`${type}.yml`);
      const result = runGyl([
        "init",
        "--pull-source-type",
        type,
        "--pull-source",
        `https://example.feishu.cn/${type}/token`,
        "--pull-output-dir",
        "Imported",
        "--output",
        path
      ]);

      expect(result.status).toBe(0);
      const config = parseConfig(await readFile(path, "utf8"));
      expect(config.pull?.source.type).toBe(type);
      expect(config.pull?.source.tokenOrUrl).toBe(`https://example.feishu.cn/${type}/token`);
      expect(config.pull?.outputDir).toBe("Imported");
    }
  });
});

describe("renderWorkspaceGitattributes", () => {
  it("enforces LF for text and marks common image types binary", () => {
    const content = renderWorkspaceGitattributes();
    expect(content).toContain("* text=auto eol=lf");
    expect(content).toContain("*.cmd text eol=crlf");
    expect(content).toContain("*.bat text eol=crlf");
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "ico"]) {
      expect(content).toContain(`*.${ext} binary`);
    }
  });
});

describe("writeWorkspaceGitattributes", () => {
  it("writes a new .gitattributes into the workspace root and returns its path", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-init-gitattributes-"));
    try {
      const written = await writeWorkspaceGitattributes(workspaceRoot);
      expect(written).toBe(join(workspaceRoot, ".gitattributes"));
      const content = await readFile(join(workspaceRoot, ".gitattributes"), "utf8");
      expect(content).toContain("* text=auto eol=lf");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("does not overwrite an existing .gitattributes", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-init-gitattributes-existing-"));
    try {
      const existing = join(workspaceRoot, ".gitattributes");
      await writeFile(existing, "* text=auto\n", "utf8");

      const written = await writeWorkspaceGitattributes(workspaceRoot);
      expect(written).toBeNull();
      // The user's own content is preserved untouched.
      expect(await readFile(existing, "utf8")).toBe("* text=auto\n");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("creates a workspace .gitattributes during init", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-init-gitattributes-cmd-"));
    const configPath = join(workspaceRoot, "git-your-lark.yml");
    try {
      await expect(initCommand({
        remoteFolderToken: "fld_new",
        workspaceRoot,
        outputPath: configPath
      })).resolves.toBe(0);

      const gitattributesPath = join(workspaceRoot, ".gitattributes");
      expect(existsSync(gitattributesPath)).toBe(true);
      expect(await readFile(gitattributesPath, "utf8")).toContain("* text=auto eol=lf");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("resolves a relative workspaceRoot for .gitattributes from the config output directory", async () => {
    const cwdRoot = join(tempDir, "process-cwd");
    const configDir = join(tempDir, "config");
    const configPath = join(configDir, "git-your-lark.yml");
    const originalCwd = process.cwd();
    await mkdir(cwdRoot, { recursive: true });
    await mkdir(configDir, { recursive: true });

    try {
      process.chdir(cwdRoot);
      await expect(initCommand({
        remoteFolderToken: "fld_new",
        workspaceRoot: "workspace",
        outputPath: configPath
      })).resolves.toBe(0);

      expect(existsSync(join(configDir, "workspace", ".gitattributes"))).toBe(true);
      expect(existsSync(join(cwdRoot, "workspace", ".gitattributes"))).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
