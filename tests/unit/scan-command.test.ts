import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { scanCommand } from "../../scripts/commands/scan.js";
import { readJson } from "../../scripts/lib/fs-utils.js";
import { emptyState } from "../../scripts/lib/state.js";
import type { LocalManifest } from "../../scripts/lib/local-scan.js";
import type { RemoteManifest } from "../../scripts/lib/remote-scan.js";

describe("scanCommand", () => {
  it("writes a manifest from local, remote, and state scans", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-scan-command-"));
    const configPath = join(workspaceRoot, "git-your-lark.yml");
    const localManifest: LocalManifest = {
      workspaceRoot,
      documents: [
        {
          path: "001_doc.md",
          title: "001_doc",
          stem: "001_doc",
          hash: "hash-doc",
          references: [],
          attachments: []
        }
      ],
      attachments: []
    };
    const remoteManifest: RemoteManifest = {
      folderToken: "fld_remote",
      entries: [
        {
          name: "001_doc",
          token: "doc_1",
          type: "docx",
          modifiedTime: "1710000000"
        }
      ]
    };

    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(
      configPath,
      [
        'workspaceRoot: "."',
        'remoteFolderToken: "fld_remote"',
        "include:",
        '  - "**/*.md"',
        "exclude: []",
        ""
      ].join("\n"),
      "utf8"
    );

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const exitCode = await scanCommand(configPath, {
        scanLocalWorkspace: async () => localManifest,
        scanRemoteFolder: async () => remoteManifest
      });

      await expect(readJson(join(workspaceRoot, ".git-your-lark", "manifest.json"))).resolves.toEqual({
        local: localManifest,
        remote: remoteManifest,
        state: emptyState("fld_remote")
      });
      expect(exitCode).toBe(0);
    } finally {
      log.mockRestore();
    }
  });
});
