import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emptyState,
  loadPublishState,
  loadRootState,
  loadState,
  savePublishState,
  saveState,
  type GitYourLarkRootState,
  type GitYourLarkState
} from "../../scripts/lib/state.js";

describe("state persistence", () => {
  function nonEmptyPullState(): GitYourLarkRootState["pull"] {
    return {
      sources: {
        "wiki_node:wiki_1": {
          type: "wiki_node",
          tokenOrUrl: "wiki_1",
          sourceUrl: "https://example.test/wiki_1",
          remoteTitle: "Root wiki"
        }
      },
      documents: {
        "doc_1": {
          docToken: "doc_1",
          wikiNodeToken: "wiki_1",
          sourceUrl: "https://example.test/doc_1",
          remoteTitle: "Doc 1",
          remotePath: "Root wiki/Doc 1",
          localPath: "Doc 1.md",
          remoteRevision: "rev-1",
          remoteModifiedTime: "1710000000",
          localHash: "hash-doc-1",
          assetPaths: ["Doc 1/assets/img.png"]
        }
      },
      assets: {
        "Doc 1/assets/img.png": {
          sourceToken: "img_1",
          sourceUrl: "https://example.test/img_1",
          localPath: "Doc 1/assets/img.png",
          ownerDocToken: "doc_1",
          hash: "hash-img-1"
        }
      }
    };
  }

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

  it("migrates v1 publish state into v2 root state", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-state-migrate-"));
    const statePath = join(workspaceRoot, ".git-your-lark", "state.json");
    await mkdir(join(workspaceRoot, ".git-your-lark"), { recursive: true });
    await writeFile(statePath, JSON.stringify({
      version: 1,
      remoteFolderToken: "fld_remote",
      documents: {
        "000_index.md": {
          path: "000_index.md",
          title: "000_index",
          token: "doc_index",
          url: "https://example.test/doc_index",
          localHash: "hash-index"
        }
      },
      attachments: {}
    }), "utf8");

    await expect(loadRootState(statePath, "fld_remote")).resolves.toMatchObject({
      version: 2,
      publish: {
        remoteFolderToken: "fld_remote",
        documents: {
          "000_index.md": {
            token: "doc_index"
          }
        },
        attachments: {}
      },
      pull: {
        sources: {},
        documents: {},
        assets: {}
      }
    });
  });

  it("loadPublishState returns the legacy publish view for existing apply code", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-state-publish-view-"));
    const state = await loadPublishState(join(workspaceRoot, ".git-your-lark", "state.json"), "fld_remote");

    expect(state).toEqual(emptyState("fld_remote"));
  });

  it("initializes an empty v2 publish namespace from the caller token", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-state-pull-first-"));
    const statePath = join(workspaceRoot, ".git-your-lark", "state.json");
    await mkdir(join(workspaceRoot, ".git-your-lark"), { recursive: true });
    await writeFile(statePath, JSON.stringify({
      version: 2,
      publish: emptyState(""),
      pull: nonEmptyPullState()
    }), "utf8");

    await expect(loadPublishState(statePath, "fld_remote")).resolves.toEqual(emptyState("fld_remote"));
  });

  it("preserves pull state when saving the publish compatibility view", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-state-save-publish-view-"));
    const statePath = join(workspaceRoot, ".git-your-lark", "state.json");
    const pull = nonEmptyPullState();
    await mkdir(join(workspaceRoot, ".git-your-lark"), { recursive: true });
    await writeFile(statePath, JSON.stringify({
      version: 2,
      publish: emptyState(""),
      pull
    }), "utf8");

    await savePublishState(statePath, emptyState("fld_remote"));

    await expect(loadRootState(statePath)).resolves.toMatchObject({
      version: 2,
      publish: {
        remoteFolderToken: "fld_remote",
        documents: {},
        attachments: {}
      },
      pull
    });
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
