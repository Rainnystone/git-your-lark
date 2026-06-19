import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyState, loadState, saveState, type GitYourLarkState } from "../../scripts/lib/state.js";

describe("state persistence", () => {
  it("loads an empty state when the state file is missing", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-state-"));
    const state = await loadState(join(workspaceRoot, ".git-your-lark", "state.json"), "fld_remote");

    expect(state).toEqual(emptyState("fld_remote"));
  });

  it("roundtrips a saved state object", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-state-"));
    const statePath = join(workspaceRoot, ".git-your-lark", "state.json");
    const state: GitYourLarkState = {
      version: 1,
      remoteFolderToken: "fld_remote",
      remoteFolderUrl: "https://example.test/folder",
      documents: {
        "docs/a.md": {
          path: "docs/a.md",
          title: "A",
          token: "doc_a",
          url: "https://example.test/doc",
          remoteRevision: "rev-1",
          remoteModifiedTime: "1710000000",
          localHash: "hash-a"
        }
      },
      attachments: {
        "assets/a.png": {
          localPath: "assets/a.png",
          remoteToken: "img_a",
          remoteUrl: "https://example.test/img",
          hash: "hash-img"
        }
      },
      lastAppliedProposalId: "proposal-1"
    };

    await saveState(statePath, state);

    await expect(loadState(statePath, "fld_remote")).resolves.toEqual(state);
  });

  it("throws when the state file contains invalid JSON", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-state-"));
    const statePath = join(workspaceRoot, ".git-your-lark", "state.json");
    await mkdir(join(workspaceRoot, ".git-your-lark"), { recursive: true });
    await writeFile(statePath, "{not valid json", "utf8");

    await expect(loadState(statePath, "fld_remote")).rejects.toThrow();
  });

  it.each([
    ["empty object", {}],
    ["array", []],
    ["unsupported version", { version: 2, remoteFolderToken: "fld_remote", documents: {}, attachments: {} }],
    ["null documents", { version: 1, remoteFolderToken: "fld_remote", documents: null, attachments: {} }]
  ])("throws when the state file has invalid shape: %s", async (_name, value) => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-state-"));
    const statePath = join(workspaceRoot, ".git-your-lark", "state.json");
    await mkdir(join(workspaceRoot, ".git-your-lark"), { recursive: true });
    await writeFile(statePath, JSON.stringify(value), "utf8");

    await expect(loadState(statePath, "fld_remote")).rejects.toThrow(/Invalid git-your-lark state/);
  });
});
