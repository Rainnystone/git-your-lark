import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { proposalCommand } from "../../scripts/commands/proposal.js";
import { readJson, readUtf8 } from "../../scripts/lib/fs-utils.js";
import { buildProposal, renderProposalMarkdown } from "../../scripts/lib/proposal.js";
import type { LocalManifest } from "../../scripts/lib/local-scan.js";
import type { RemoteManifest } from "../../scripts/lib/remote-scan.js";
import type { GitYourLarkState } from "../../scripts/lib/state.js";

describe("buildProposal", () => {
  it("plans changed existing doc and new doc", () => {
    const proposal = buildProposal({
      local: localManifest({
        documents: [
          localDocument({ path: "000_index.md", hash: "a" }),
          localDocument({ path: "001_doc.md", hash: "b" })
        ]
      }),
      remote: remoteManifest({
        entries: [remoteDocument({ name: "000_index", token: "doc1", modifiedTime: "1" })]
      }),
      state: state({
        documents: {
          "000_index.md": stateDocument({ path: "000_index.md", localHash: "old", token: "doc1" })
        }
      })
    });

    expect(proposal.actions.map((action) => action.kind)).toEqual(["patch-document", "create-document"]);
    expect(proposal.actions[0]).toMatchObject({
      kind: "patch-document",
      path: "000_index.md",
      token: "doc1",
      hash: "a",
      baseRemoteModifiedTime: "1"
    });
    expect(proposal.actions[1]).toMatchObject({
      kind: "create-document",
      path: "001_doc.md",
      title: "001_doc",
      hash: "b"
    });
  });

  it("flags remote-only docs without deleting them", () => {
    const proposal = buildProposal({
      local: localManifest({ documents: [] }),
      remote: remoteManifest({
        entries: [remoteDocument({ name: "old_doc", token: "doc-old" })]
      }),
      state: state({
        documents: {
          "old_doc.md": stateDocument({ path: "old_doc.md", title: "old_doc", token: "doc-old" })
        }
      })
    });

    expect(proposal.actions).toEqual([]);
    expect(proposal.warnings).toEqual(["Remote-only document left untouched: old_doc.md"]);
  });

  it("blocks local docs that collide with unbound same-title remote docs", () => {
    const proposal = buildProposal({
      local: localManifest({
        documents: [localDocument({ path: "000_index.md", title: "000_index", stem: "000_index" })]
      }),
      remote: remoteManifest({
        entries: [remoteDocument({ name: "000_index", token: "doc1" })]
      }),
      state: state()
    });

    expect(proposal.actions).toEqual([]);
    expect(proposal.blockers).toEqual(["Remote document with title exists but is not bound in state: 000_index.md -> 000_index"]);
  });

  it("blocks state-bound docs when the state token is missing from the remote scan", () => {
    const proposal = buildProposal({
      local: localManifest({
        documents: [localDocument({ path: "000_index.md", hash: "new" })]
      }),
      remote: remoteManifest({ entries: [] }),
      state: state({
        documents: {
          "000_index.md": stateDocument({ path: "000_index.md", token: "doc-missing", localHash: "old" })
        }
      })
    });

    expect(proposal.actions).toEqual([]);
    expect(proposal.blockers).toEqual(["State token missing from remote scan for 000_index.md: doc-missing"]);
  });

  it("warns about unmanaged remote docx entries without deleting them", () => {
    const proposal = buildProposal({
      local: localManifest({ documents: [] }),
      remote: remoteManifest({
        entries: [remoteDocument({ name: "remote_only", token: "doc-remote-only" })]
      }),
      state: state()
    });

    expect(proposal.actions).toEqual([]);
    expect(proposal.warnings).toEqual(["Unmanaged remote document left untouched: remote_only"]);
  });

  it("blocks unresolved references", () => {
    const proposal = buildProposal({
      local: localManifest({
        documents: [
          localDocument({
            path: "000_index.md",
            references: [{ target: "missing_doc", raw: "[[missing_doc]]" }]
          })
        ]
      }),
      remote: remoteManifest(),
      state: state()
    });

    expect(proposal.blockers).toEqual(["Unresolved reference in 000_index.md: missing_doc"]);
  });

  it("resolves relative markdown references from the owner document directory", () => {
    const proposal = buildProposal({
      local: localManifest({
        documents: [
          localDocument({
            path: "docs/a.md",
            references: [{ target: "b.md", raw: "[B](b.md)" }]
          }),
          localDocument({ path: "docs/b.md" })
        ]
      }),
      remote: remoteManifest(),
      state: state()
    });

    expect(proposal.blockers).toEqual([]);
    expect(proposal.actions.map((action) => action.kind)).toEqual(["create-document", "create-document"]);
  });

  it("blocks relative markdown references that only match a basename outside the owner document directory", () => {
    const proposal = buildProposal({
      local: localManifest({
        documents: [
          localDocument({
            path: "docs/a.md",
            references: [{ target: "b.md", raw: "[B](b.md)" }]
          }),
          localDocument({ path: "b.md" })
        ]
      }),
      remote: remoteManifest(),
      state: state()
    });

    expect(proposal.blockers).toEqual(["Unresolved reference in docs/a.md: b.md"]);
  });

  it("blocks missing attachments", () => {
    const proposal = buildProposal({
      local: localManifest({
        documents: [
          localDocument({
            path: "000_index.md",
            attachments: [{ path: "assets/missing.png", hash: "missing", owner: "000_index.md" }]
          })
        ],
        attachments: [{ path: "assets/missing.png", hash: "missing", owner: "000_index.md" }]
      }),
      remote: remoteManifest(),
      state: state()
    });

    expect(proposal.blockers).toEqual(["Missing attachment: assets/missing.png"]);
  });

  it("uploads new attachments and renders markdown sections", () => {
    const proposal = buildProposal({
      local: localManifest({
        documents: [localDocument({ path: "000_index.md" })],
        attachments: [{ path: "assets/diagram.png", hash: "img-hash", owner: "000_index.md" }]
      }),
      remote: remoteManifest(),
      state: state()
    });

    expect(proposal.actions.map((action) => action.kind)).toEqual(["create-document", "upload-attachment"]);
    expect(renderProposalMarkdown(proposal)).toContain("## Actions");
    expect(renderProposalMarkdown(proposal)).toContain("## Blockers");
    expect(renderProposalMarkdown(proposal)).toContain("## Warnings");
  });

  it("blocks present attachments instead of uploading them when attachmentPolicy is block", () => {
    const proposal = buildProposal({
      local: localManifest({
        documents: [localDocument({ path: "000_index.md" })],
        attachments: [{ path: "assets/diagram.png", hash: "img-hash", owner: "000_index.md" }]
      }),
      remote: remoteManifest(),
      state: state(),
      attachmentPolicy: "block"
    });

    expect(proposal.actions.map((action) => action.kind)).toEqual(["create-document"]);
    expect(proposal.blockers).toEqual(["Attachment blocked by attachmentPolicy=block: assets/diagram.png"]);
    expect(proposal.warnings).toEqual([]);
  });

  it("warns about present attachments without uploading them when attachmentPolicy is warn-only", () => {
    const proposal = buildProposal({
      local: localManifest({
        documents: [localDocument({ path: "000_index.md" })],
        attachments: [{ path: "assets/diagram.png", hash: "img-hash", owner: "000_index.md" }]
      }),
      remote: remoteManifest(),
      state: state(),
      attachmentPolicy: "warn-only"
    });

    expect(proposal.actions.map((action) => action.kind)).toEqual(["create-document"]);
    expect(proposal.blockers).toEqual([]);
    expect(proposal.warnings).toEqual(["Attachment not uploaded because attachmentPolicy=warn-only: assets/diagram.png"]);
  });
});

describe("proposalCommand", () => {
  it("writes JSON and Markdown proposal files and returns 0 without blockers", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-proposal-command-"));
    const configPath = join(workspaceRoot, "git-your-lark.yml");
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(
      configPath,
      [
        'workspaceRoot: "."',
        'remoteFolderToken: "fld_remote"',
        "proposalDir: .git-your-lark/proposals",
        "exclude: []",
        ""
      ].join("\n"),
      "utf8"
    );

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const exitCode = await proposalCommand(configPath, {
        now: () => new Date("2026-06-19T00:00:00.000Z"),
        scanLocalWorkspace: async () =>
          localManifest({
            workspaceRoot,
            documents: [localDocument({ path: "000_index.md", hash: "new" })]
          }),
        scanRemoteFolder: async () =>
          remoteManifest({
            entries: [remoteDocument({ name: "000_index", token: "doc1", modifiedTime: "1" })]
          }),
        loadState: async () =>
          state({
            documents: {
              "000_index.md": stateDocument({ path: "000_index.md", localHash: "old", token: "doc1" })
            }
          })
      });

      const jsonPath = join(workspaceRoot, ".git-your-lark", "proposals", "proposal-2026-06-19T00-00-00-000Z.json");
      const markdownPath = join(workspaceRoot, ".git-your-lark", "proposals", "proposal-2026-06-19T00-00-00-000Z.md");
      await expect(readJson(jsonPath)).resolves.toMatchObject({
        id: "proposal-2026-06-19T00-00-00-000Z",
        actions: [{ kind: "patch-document", path: "000_index.md" }],
        blockers: [],
        warnings: []
      });
      await expect(readUtf8(markdownPath)).resolves.toContain("## Actions");
      expect(exitCode).toBe(0);
      expect(log).toHaveBeenCalledWith(`Wrote proposal JSON: ${jsonPath}`);
      expect(log).toHaveBeenCalledWith(`Wrote proposal Markdown: ${markdownPath}`);
    } finally {
      log.mockRestore();
    }
  });

  it("returns 2 when the generated proposal has blockers", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-proposal-command-"));
    const configPath = join(workspaceRoot, "git-your-lark.yml");
    await writeFile(
      configPath,
      ['workspaceRoot: "."', 'remoteFolderToken: "fld_remote"', ""].join("\n"),
      "utf8"
    );

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const exitCode = await proposalCommand(configPath, {
        now: () => new Date("2026-06-19T00:00:00.000Z"),
        scanLocalWorkspace: async () =>
          localManifest({
            workspaceRoot,
            documents: [
              localDocument({
                path: "000_index.md",
                references: [{ target: "missing_doc", raw: "[[missing_doc]]" }]
              })
            ]
          }),
        scanRemoteFolder: async () => remoteManifest(),
        loadState: async () => state()
      });

      expect(exitCode).toBe(2);
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
  const path = input.path ?? "000_index.md";
  const stem = path.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? path;
  return {
    path,
    title: stem,
    stem,
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

function remoteDocument(input: Partial<RemoteManifest["entries"][number]> = {}): RemoteManifest["entries"][number] {
  return {
    name: "000_index",
    token: "doc1",
    type: "docx",
    ...input
  };
}

function state(input: Partial<GitYourLarkState> = {}): GitYourLarkState {
  return {
    version: 1,
    remoteFolderToken: "fld_remote",
    documents: {},
    attachments: {},
    ...input
  };
}

function stateDocument(input: Partial<GitYourLarkState["documents"][string]> = {}): GitYourLarkState["documents"][string] {
  return {
    path: "000_index.md",
    title: "000_index",
    token: "doc1",
    url: "https://example.test/doc1",
    localHash: "hash",
    ...input
  };
}
