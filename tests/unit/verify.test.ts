import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { verifyCommand } from "../../scripts/commands/verify.js";
import type { LocalManifest } from "../../scripts/lib/local-scan.js";
import type { RemoteManifest } from "../../scripts/lib/remote-scan.js";
import { verifyManifest } from "../../scripts/lib/verify.js";

describe("verifyManifest", () => {
  it("passes when every local document title has a remote docx and no remote markdown files exist", () => {
    expect(
      verifyManifest(
        localManifest({
          documents: [localDocument({ title: "000_index" }), localDocument({ title: "001_doc" })]
        }),
        remoteManifest({
          entries: [
            remoteEntry({ name: "000_index", type: "docx" }),
            remoteEntry({ name: "001_doc", type: "docx" })
          ]
        })
      )
    ).toEqual({ ok: true, problems: [] });
  });

  it("catches missing remote docx documents and remote markdown files", () => {
    expect(
      verifyManifest(
        localManifest({
          documents: [localDocument({ title: "000_index" }), localDocument({ title: "001_missing" })]
        }),
        remoteManifest({
          entries: [
            remoteEntry({ name: "000_index", type: "docx" }),
            remoteEntry({ name: "legacy.md", type: "file" })
          ]
        })
      )
    ).toEqual({
      ok: false,
      problems: [
        "Local document is missing a remote docx with the same title: 001_missing",
        "Remote plain Markdown file should not exist after publish: legacy.md"
      ]
    });
  });
});

describe("verifyCommand", () => {
  it("returns 1 and prints problems when verification fails", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-verify-command-"));
    const configPath = join(workspaceRoot, "git-your-lark.yml");
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(configPath, ['workspaceRoot: "."', 'remoteFolderToken: "fld_remote"', ""].join("\n"), "utf8");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const exitCode = await verifyCommand(configPath, {
        scanLocalWorkspace: async () =>
          localManifest({
            workspaceRoot,
            documents: [localDocument({ title: "001_missing" })]
          }),
        scanRemoteFolder: async () => remoteManifest()
      });

      expect(exitCode).toBe(1);
      expect(log).toHaveBeenCalledWith(JSON.stringify({
        ok: false,
        problems: ["Local document is missing a remote docx with the same title: 001_missing"]
      }, null, 2));
    } finally {
      log.mockRestore();
    }
  });
});

function localManifest(input: Partial<LocalManifest> = {}): LocalManifest {
  return {
    workspaceRoot: "/workspace",
    documents: [],
    attachments: [],
    ...input
  };
}

function localDocument(input: Partial<LocalManifest["documents"][number]> = {}): LocalManifest["documents"][number] {
  const title = input.title ?? "000_index";
  return {
    path: `${title}.md`,
    title,
    stem: title,
    hash: "hash",
    references: [],
    attachments: [],
    ...input
  };
}

function remoteManifest(input: Partial<RemoteManifest> = {}): RemoteManifest {
  return {
    folderToken: "fld_remote",
    entries: [],
    ...input
  };
}

function remoteEntry(input: Partial<RemoteManifest["entries"][number]> = {}): RemoteManifest["entries"][number] {
  return {
    name: "000_index",
    token: "doc_index",
    type: "docx",
    ...input
  };
}
