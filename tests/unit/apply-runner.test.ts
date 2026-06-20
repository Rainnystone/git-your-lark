import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  analyzeRemoteConflicts,
  applyProposal,
  planApplySequence,
  type ApplyRunner
} from "../../scripts/lib/apply-runner.js";
import { readJson } from "../../scripts/lib/fs-utils.js";
import type { CommandResult } from "../../scripts/lib/lark-cli.js";
import type { RemoteManifest } from "../../scripts/lib/remote-scan.js";
import type { SyncProposal } from "../../scripts/lib/proposal.js";
import type { GitYourLarkState } from "../../scripts/lib/state.js";

describe("planApplySequence", () => {
  it("orders phases using current proposal action fields", () => {
    const create = createDocumentAction({ path: "001_new.md", hash: "hash-new" });
    const patch = patchDocumentAction({ path: "000_index.md", hash: "hash-index" });
    const upload = uploadAttachmentAction({ path: "assets/diagram.png", hash: "hash-img", owner: "001_new.md" });

    expect(planApplySequence(proposal({ actions: [upload, patch, create] }))).toEqual([
      { name: "create-placeholders", actions: [create] },
      { name: "write-documents", actions: [patch, create] },
      { name: "insert-attachments", actions: [upload] }
    ]);
  });

  it("skips empty phases", () => {
    const upload = uploadAttachmentAction({ path: "assets/diagram.png", owner: "000_index.md" });

    expect(planApplySequence(proposal({ actions: [upload] }))).toEqual([
      { name: "insert-attachments", actions: [upload] }
    ]);
  });
});

describe("analyzeRemoteConflicts", () => {
  it("detects same-title create conflicts and modified patch bases", () => {
    const conflicts = analyzeRemoteConflicts(
      proposal({
        actions: [
          createDocumentAction({ title: "001_new" }),
          patchDocumentAction({ token: "doc_existing", baseRemoteModifiedTime: "old" })
        ]
      }),
      remoteManifest({
        entries: [
          remoteEntry({ name: "001_new", token: "doc_collision", type: "docx" }),
          remoteEntry({ name: "000_index", token: "doc_existing", type: "docx", modifiedTime: "new" })
        ]
      })
    );

    expect(conflicts).toEqual([
      "Remote docx already exists for new document title: 001_new",
      "Remote document changed since proposal for 000_index.md: expected modifiedTime old, found new"
    ]);
  });

  it("treats a missing patch base modifiedTime as a conflict when the remote has one", () => {
    expect(
      analyzeRemoteConflicts(
        proposal({
          actions: [patchDocumentAction({ token: "doc_existing" })]
        }),
        remoteManifest({
          entries: [remoteEntry({ name: "000_index", token: "doc_existing", modifiedTime: "new" })]
        })
      )
    ).toEqual([
      "Remote document changed since proposal for 000_index.md: expected modifiedTime undefined, found new"
    ]);
  });
});

describe("applyProposal", () => {
  it("stops before writes and creates a journal when the proposal has blockers", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-apply-blocked-"));
    const configPath = await writeConfig(workspaceRoot);
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        blockers: ["Unresolved reference in 000_index.md: missing"],
        actions: [createDocumentAction()]
      })
    );
    const run = vi.fn<ApplyRunner>(async () => result());
    const scanRemoteFolder = vi.fn(async () => remoteManifest());

    const applyResult = await applyProposal({
      proposalPath,
      configPath,
      run,
      scanRemoteFolder
    });

    expect(applyResult).toMatchObject({ ok: false, status: "blocked" });
    expect(run).not.toHaveBeenCalled();
    expect(scanRemoteFolder).not.toHaveBeenCalled();
    await expect(readJson(applyResult.journalPath)).resolves.toMatchObject({
      status: "blocked",
      events: [{ step: "blocked", problems: ["Unresolved reference in 000_index.md: missing"] }]
    });
  });

  it("creates a placeholder, overwrites it with rendered markdown, and saves document state", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-apply-create-"));
    const configPath = await writeConfig(workspaceRoot, { referenceMode: "url-link" });
    await writeFile(join(workspaceRoot, "001_new.md"), "Hello new document.\n", "utf8");
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        actions: [createDocumentAction({ path: "001_new.md", title: "001_new", hash: "hash-new" })]
      })
    );
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const run = vi.fn<ApplyRunner>(async (command, args, cwd) => {
      calls.push({ command, args, cwd });
      if (args.includes("+import")) {
        return result({ stdout: JSON.stringify({ data: { token: "doc_new", url: "https://example.test/doc_new", modified_time: "m1" } }) });
      }
      return result({ stdout: JSON.stringify({ data: { ok: true } }) });
    });
    const scanRemoteFolder = vi.fn(async () => remoteManifest());

    const applyResult = await applyProposal({
      proposalPath,
      configPath,
      run,
      scanRemoteFolder
    });

    expect(applyResult).toMatchObject({ ok: true, status: "applied" });
    expect(scanRemoteFolder).toHaveBeenCalledWith("fld_remote");
    expect(calls[0].command).toBe("lark-cli");
    expect(calls[0].cwd).toBe(workspaceRoot);
    const fileIndex = calls[0].args.indexOf("--file");
    expect(fileIndex).toBeGreaterThan(0);
    const placeholderPath = calls[0].args[fileIndex + 1];
    expect(placeholderPath).toMatch(/\.md$/);
    expect(calls[0].args).toEqual([
      "drive",
      "+import",
      "--as",
      "user",
      "--file",
      placeholderPath,
      "--type",
      "docx",
      "--folder-token",
      "fld_remote",
      "--name",
      "001_new"
    ]);
    expect(calls[1]).toEqual({
      command: "lark-cli",
      cwd: workspaceRoot,
      args: [
        "docs",
        "+update",
        "--api-version",
        "v2",
        "--as",
        "user",
        "--doc",
        "doc_new",
        "--command",
        "overwrite",
        "--doc-format",
        "markdown",
        "--content",
        "Hello new document.\n"
      ]
    });
    await expect(readJson<GitYourLarkState>(join(workspaceRoot, ".git-your-lark", "state.json"))).resolves.toMatchObject({
      documents: {
        "001_new.md": {
          path: "001_new.md",
          title: "001_new",
          token: "doc_new",
          url: "https://example.test/doc_new",
          remoteModifiedTime: "m1",
          localHash: "hash-new"
        }
      },
      lastAppliedProposalId: "proposal-test"
    });
  });

  it("patches existing documents with docs str_replace when the diff is narrow", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-apply-patch-"));
    const configPath = await writeConfig(workspaceRoot, { state: state({
      documents: {
        "000_index.md": stateDocument({ path: "000_index.md", title: "000_index", token: "doc_index", localHash: "old-hash" })
      }
    }) });
    await writeFile(join(workspaceRoot, "000_index.md"), "before\nnew\nafter\n", "utf8");
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        actions: [
          patchDocumentAction({
            path: "000_index.md",
            title: "000_index",
            token: "doc_index",
            hash: "new-hash",
            baseRemoteModifiedTime: "1"
          })
        ]
      })
    );
    const calls: Array<{ args: string[] }> = [];
    const run = vi.fn<ApplyRunner>(async (_command, args) => {
      calls.push({ args });
      if (args.includes("+fetch")) {
        return result({ stdout: JSON.stringify({ data: { document: { content: "before\nold\nafter\n" } } }) });
      }
      return result();
    });

    const applyResult = await applyProposal({
      proposalPath,
      configPath,
      run,
      scanRemoteFolder: async () =>
        remoteManifest({
          entries: [remoteEntry({ name: "000_index", token: "doc_index", modifiedTime: "1" })]
        })
    });

    expect(applyResult).toMatchObject({ ok: true, status: "applied" });
    expect(calls[0].args).toEqual([
      "docs",
      "+fetch",
      "--api-version",
      "v2",
      "--as",
      "user",
      "--doc",
      "doc_index",
      "--doc-format",
      "markdown",
      "--format",
      "json"
    ]);
    expect(calls[1].args).toEqual([
      "docs",
      "+update",
      "--api-version",
      "v2",
      "--as",
      "user",
      "--doc",
      "doc_index",
      "--command",
      "str_replace",
      "--doc-format",
      "markdown",
      "--pattern",
      "old\n",
      "--content",
      "new\n"
    ]);
    expect(calls[1].args).not.toContain("--replacement");
    await expect(readJson<GitYourLarkState>(join(workspaceRoot, ".git-your-lark", "state.json"))).resolves.toMatchObject({
      documents: {
        "000_index.md": {
          localHash: "new-hash"
        }
      }
    });
  });

  it("uses upload action owner to resolve the document for media insertion", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-apply-attachment-"));
    await mkdir(join(workspaceRoot, "assets"), { recursive: true });
    await writeFile(join(workspaceRoot, "assets", "diagram.png"), "fake image", "utf8");
    await writeFile(join(workspaceRoot, "assets", "spec.pdf"), "fake file", "utf8");
    const configPath = await writeConfig(workspaceRoot, {
      state: state({
        documents: {
          "001_owner.md": stateDocument({ path: "001_owner.md", title: "001_owner", token: "doc_owner", localHash: "hash-owner" })
        }
      })
    });
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        actions: [
          uploadAttachmentAction({ path: "assets/diagram.png", hash: "hash-img", owner: "001_owner.md" }),
          uploadAttachmentAction({ path: "assets/spec.pdf", hash: "hash-pdf", owner: "001_owner.md" })
        ]
      })
    );
    const calls: string[][] = [];
    const run = vi.fn<ApplyRunner>(async (_command, args) => {
      calls.push(args);
      const token = `media_${calls.length}`;
      return result({ stdout: JSON.stringify({ data: { token, url: `https://example.test/${token}` } }) });
    });

    const applyResult = await applyProposal({
      proposalPath,
      configPath,
      run,
      scanRemoteFolder: async () => remoteManifest()
    });

    expect(applyResult).toMatchObject({ ok: true, status: "applied" });
    expect(calls[0]).toEqual([
      "docs",
      "+media-insert",
      "--as",
      "user",
      "--doc",
      "doc_owner",
      "--file",
      join(workspaceRoot, "assets", "diagram.png"),
      "--type",
      "image"
    ]);
    expect(calls[1]).toEqual([
      "docs",
      "+media-insert",
      "--as",
      "user",
      "--doc",
      "doc_owner",
      "--file",
      join(workspaceRoot, "assets", "spec.pdf"),
      "--type",
      "file"
    ]);
    await expect(readJson<GitYourLarkState>(join(workspaceRoot, ".git-your-lark", "state.json"))).resolves.toMatchObject({
      attachments: {
        "assets/diagram.png": {
          localPath: "assets/diagram.png",
          remoteToken: "media_1",
          remoteUrl: "https://example.test/media_1",
          hash: "hash-img"
        },
        "assets/spec.pdf": {
          localPath: "assets/spec.pdf",
          remoteToken: "media_2",
          remoteUrl: "https://example.test/media_2",
          hash: "hash-pdf"
        }
      }
    });
  });

  it("stops before scanning or running commands when proposal base folder differs from config", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-apply-folder-mismatch-"));
    const configPath = await writeConfig(workspaceRoot);
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        baseRemoteFolderToken: "fld_stale",
        actions: [createDocumentAction()]
      })
    );
    const run = vi.fn<ApplyRunner>(async () => result());
    const scanRemoteFolder = vi.fn(async () => remoteManifest());

    const applyResult = await applyProposal({
      proposalPath,
      configPath,
      run,
      scanRemoteFolder
    });

    const problem = "Proposal base remote folder token fld_stale does not match config remote folder token fld_remote";
    expect(applyResult).toMatchObject({ ok: false, status: "failed", problems: [problem] });
    expect(scanRemoteFolder).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    await expect(readJson(applyResult.journalPath)).resolves.toMatchObject({
      status: "failed",
      events: [{ step: "folder-token-mismatch", problems: [problem] }]
    });
  });

  it("journals a created placeholder side effect before reporting a state save failure", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-apply-save-failure-"));
    const configPath = await writeConfig(workspaceRoot);
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        actions: [createDocumentAction({ path: "001_new.md", title: "001_new", hash: "hash-new" })]
      })
    );
    const run = vi.fn<ApplyRunner>(async (_command, args) => {
      if (args.includes("+import")) {
        return result({ stdout: JSON.stringify({ data: { token: "doc_new", url: "https://example.test/doc_new" } }) });
      }
      return result();
    });

    const applyResult = await applyProposal({
      proposalPath,
      configPath,
      run,
      scanRemoteFolder: async () => remoteManifest(),
      loadState: async () => state(),
      saveState: async () => {
        throw new Error("state store unavailable");
      }
    });

    expect(applyResult).toMatchObject({ ok: false, status: "failed", problems: ["state store unavailable"] });
    const journal = await readJson<{ status: string; events: Array<Record<string, unknown>> }>(applyResult.journalPath);
    expect(journal.status).toBe("failed");
    expect(journal.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "create-placeholder",
          action: expect.objectContaining({ kind: "create-document", path: "001_new.md" }),
          createdToken: "doc_new"
        }),
        expect.objectContaining({
          step: "failed",
          problems: ["state store unavailable"]
        })
      ])
    );
  });
});

async function writeConfig(
  workspaceRoot: string,
  input: { referenceMode?: "lark-doc-cite" | "url-link"; state?: GitYourLarkState } = {}
): Promise<string> {
  const configPath = join(workspaceRoot, "git-your-lark.yml");
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(
    configPath,
    [
      'workspaceRoot: "."',
      'remoteFolderToken: "fld_remote"',
      "statePath: .git-your-lark/state.json",
      `referenceMode: ${input.referenceMode ?? "lark-doc-cite"}`,
      "overwritePolicy: explicit-only",
      ""
    ].join("\n"),
    "utf8"
  );
  if (input.state) {
    await mkdir(join(workspaceRoot, ".git-your-lark"), { recursive: true });
    await writeFile(join(workspaceRoot, ".git-your-lark", "state.json"), `${JSON.stringify(input.state, null, 2)}\n`, "utf8");
  }
  return configPath;
}

async function writeProposal(workspaceRoot: string, value: SyncProposal): Promise<string> {
  const proposalPath = join(workspaceRoot, ".git-your-lark", "proposals", `${value.id}.json`);
  await mkdir(join(workspaceRoot, ".git-your-lark", "proposals"), { recursive: true });
  await writeFile(proposalPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return proposalPath;
}

function proposal(input: Partial<SyncProposal> = {}): SyncProposal {
  return {
    id: "proposal-test",
    createdAt: "2026-06-20T00:00:00.000Z",
    baseRemoteFolderToken: "fld_remote",
    actions: [],
    blockers: [],
    warnings: [],
    ...input
  };
}

function createDocumentAction(
  input: Partial<Extract<SyncProposal["actions"][number], { kind: "create-document" }>> = {}
): Extract<SyncProposal["actions"][number], { kind: "create-document" }> {
  return {
    kind: "create-document",
    path: "001_new.md",
    title: "001_new",
    hash: "hash-new",
    ...input
  };
}

function patchDocumentAction(
  input: Partial<Extract<SyncProposal["actions"][number], { kind: "patch-document" }>> = {}
): Extract<SyncProposal["actions"][number], { kind: "patch-document" }> {
  return {
    kind: "patch-document",
    path: "000_index.md",
    title: "000_index",
    token: "doc_index",
    hash: "hash-index",
    ...input
  };
}

function uploadAttachmentAction(
  input: Partial<Extract<SyncProposal["actions"][number], { kind: "upload-attachment" }>> = {}
): Extract<SyncProposal["actions"][number], { kind: "upload-attachment" }> {
  return {
    kind: "upload-attachment",
    path: "assets/diagram.png",
    hash: "hash-img",
    owner: "000_index.md",
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
    token: "doc_index",
    url: "https://example.test/doc_index",
    localHash: "hash-index",
    ...input
  };
}

function result(input: Partial<CommandResult> = {}): CommandResult {
  return {
    code: 0,
    stdout: "",
    stderr: "",
    ...input
  };
}
