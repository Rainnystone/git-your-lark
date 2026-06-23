import { describe, expect, it } from "vitest";
import {
  buildPullLinkIndex,
  buildPullProposal,
  planPullPaths,
  proposalId,
  renderPullProposalMarkdown
} from "../../scripts/lib/pull-proposal.js";
import type { PullFetchedDocument } from "../../scripts/lib/pull-fetch.js";
import type { PullScanResult } from "../../scripts/lib/pull-types.js";
import type { GitYourLarkRootState, PullAssetState, PullDocumentState } from "../../scripts/lib/state.js";

describe("planPullPaths", () => {
  it("plans one index and two documents for a wiki node source", () => {
    const proposal = buildPullProposal({
      scan: wikiScan(),
      fetchedDocuments: fetchedDocuments([
        fetchedDocument({ docToken: "doc_theory", title: "故事块理论文献" }),
        fetchedDocument({ docToken: "doc_mask", title: "EN《玫瑰面具》中的对话表现力" })
      ]),
      pull: { outputDir: ".", namingRules: [] },
      state: rootState(),
      now: new Date("2026-06-22T00:00:00.000Z")
    });

    expect(proposal.files.map((file) => file.localPath)).toEqual([
      "参考资料/参考资料.md",
      "参考资料/故事块理论文献.md",
      "参考资料/EN《玫瑰面具》中的对话表现力.md"
    ]);
  });

  it("preserves scanned index child document tokens in planned index files", () => {
    const proposal = buildPullProposal({
      scan: {
        source: { type: "wiki_node", tokenOrUrl: "wiki_parent", title: "参考资料" },
        indexes: [
          {
            title: "参考资料",
            docToken: "doc_parent",
            wikiNodeToken: "wiki_parent",
            remotePath: "参考资料",
            childDocTokens: ["doc_direct"]
          }
        ],
        documents: [
          remoteDocument({
            title: "直接文档",
            docToken: "doc_direct",
            wikiNodeToken: "wiki_direct",
            remotePath: "参考资料/直接文档"
          }),
          remoteDocument({
            title: "嵌套文档",
            docToken: "doc_nested",
            wikiNodeToken: "wiki_nested",
            remotePath: "参考资料/子目录/嵌套文档"
          })
        ],
        warnings: []
      },
      fetchedDocuments: fetchedDocuments([
        fetchedDocument({ docToken: "doc_direct", title: "直接文档" }),
        fetchedDocument({ docToken: "doc_nested", title: "嵌套文档" })
      ]),
      pull: { outputDir: ".", namingRules: [] },
      state: rootState(),
      now: new Date("2026-06-22T00:00:00.000Z")
    });

    expect(proposal.files[0]).toMatchObject({
      kind: "index",
      childDocTokens: ["doc_direct"]
    });
  });

  it("creates collection roots from the selected source title under outputDir", () => {
    const paths = planPullPaths({
      scan: wikiScan(),
      outputDir: "拉取",
      namingRules: []
    });

    expect(paths.map((file) => file.localPath)).toEqual([
      "拉取/参考资料/参考资料.md",
      "拉取/参考资料/故事块理论文献.md",
      "拉取/参考资料/EN《玫瑰面具》中的对话表现力.md"
    ]);
  });

  it("uses a stable collection root for a bare folder token without source title", () => {
    const paths = planPullPaths({
      scan: {
        source: { type: "folder", tokenOrUrl: "fld_root" },
        indexes: [],
        documents: [
          remoteDocument({ title: "B", docToken: "doc_b", remotePath: "B" }),
          remoteDocument({ title: "A", docToken: "doc_a", remotePath: "A" })
        ],
        warnings: []
      },
      outputDir: "拉取",
      namingRules: []
    });

    expect(paths.map((file) => file.localPath)).toEqual([
      "拉取/folder-fld_root/B.md",
      "拉取/folder-fld_root/A.md"
    ]);
  });

  it("maps title, token, and wikiNodeToken naming rules to custom local paths", () => {
    const paths = planPullPaths({
      scan: {
        source: { type: "wiki_node", tokenOrUrl: "wiki_parent", title: "参考资料" },
        indexes: [],
        documents: [
          remoteDocument({ title: "按标题", docToken: "doc_title", wikiNodeToken: "wiki_title" }),
          remoteDocument({ title: "按 token", docToken: "doc_token", wikiNodeToken: "wiki_token_original" }),
          remoteDocument({ title: "按 wiki", docToken: "doc_wiki", wikiNodeToken: "wiki_match" })
        ],
        warnings: []
      },
      outputDir: "拉取",
      namingRules: [
        { match: { title: "按标题" }, localPath: "自定义/标题.md" },
        { match: { token: "doc_token" }, localPath: "自定义/token.md" },
        { match: { wikiNodeToken: "wiki_match" }, localPath: "自定义/wiki.md" }
      ]
    });

    expect(paths.map((file) => file.localPath)).toEqual([
      "拉取/自定义/标题.md",
      "拉取/自定义/token.md",
      "拉取/自定义/wiki.md"
    ]);
  });

  it("rejects outputDir absolute paths", () => {
    expect(() => planPullPaths({ scan: wikiScan(), outputDir: "/abs", namingRules: [] })).toThrow(/workspace root|escapes/);
  });

  it("rejects outputDir Windows drive absolute paths with forward slashes", () => {
    expect(() => planPullPaths({ scan: wikiScan(), outputDir: "C:/tmp", namingRules: [] })).toThrow(/workspace root|escapes/);
  });

  it("rejects outputDir Windows drive absolute paths with backslashes", () => {
    expect(() => planPullPaths({ scan: wikiScan(), outputDir: "C:\\tmp", namingRules: [] })).toThrow(/workspace root|escapes/);
  });

  it("rejects outputDir Windows drive-relative paths", () => {
    expect(() => planPullPaths({ scan: wikiScan(), outputDir: "C:tmp", namingRules: [] })).toThrow(/workspace root|escapes/);
  });

  it("rejects outputDir traversal outside the workspace root", () => {
    expect(() => planPullPaths({ scan: wikiScan(), outputDir: "../outside", namingRules: [] })).toThrow(/workspace root|escapes/);
  });

  it("rejects naming rule traversal outside the workspace root", () => {
    expect(() =>
      planPullPaths({
        scan: docScan({ title: "远程文档", docToken: "doc_remote" }),
        outputDir: "拉取",
        namingRules: [{ match: { token: "doc_remote" }, localPath: "../outside.md" }]
      })
    ).toThrow(/workspace root|escapes/);
  });

  it("rejects naming rule backslash traversal outside the workspace root", () => {
    expect(() =>
      planPullPaths({
        scan: docScan({ title: "远程文档", docToken: "doc_remote" }),
        outputDir: "拉取",
        namingRules: [{ match: { token: "doc_remote" }, localPath: "..\\outside.md" }]
      })
    ).toThrow(/workspace root|escapes/);
  });

  it("rejects naming rule Windows drive absolute paths", () => {
    expect(() =>
      planPullPaths({
        scan: docScan({ title: "远程文档", docToken: "doc_remote" }),
        outputDir: "拉取",
        namingRules: [{ match: { token: "doc_remote" }, localPath: "C:/outside.md" }]
      })
    ).toThrow(/workspace root|escapes/);
  });

  it("rejects naming rule Windows drive-relative paths", () => {
    expect(() =>
      planPullPaths({
        scan: docScan({ title: "远程文档", docToken: "doc_remote" }),
        outputDir: "拉取",
        namingRules: [{ match: { token: "doc_remote" }, localPath: "C:outside.md" }]
      })
    ).toThrow(/workspace root|escapes/);
  });
});

describe("buildPullProposal", () => {
  it("creates a blocker when two documents map to the same local path", () => {
    const proposal = buildPullProposal({
      scan: {
        source: { type: "folder", tokenOrUrl: "fld_root", title: "参考资料" },
        indexes: [],
        documents: [
          remoteDocument({ title: "A", docToken: "doc_a" }),
          remoteDocument({ title: "B", docToken: "doc_b" })
        ],
        warnings: []
      },
      fetchedDocuments: fetchedDocuments([
        fetchedDocument({ docToken: "doc_a", title: "A" }),
        fetchedDocument({ docToken: "doc_b", title: "B" })
      ]),
      pull: {
        outputDir: ".",
        namingRules: [
          { match: { token: "doc_a" }, localPath: "冲突.md" },
          { match: { token: "doc_b" }, localPath: "冲突.md" }
        ]
      },
      state: rootState()
    });

    expect(proposal.blockers).toEqual(["Multiple remote documents map to the same local path: 冲突.md"]);
  });

  it("creates a blocker when an existing local file is not owned by pull state", () => {
    const proposal = buildPullProposal({
      scan: docScan({ title: "远程文档", docToken: "doc_remote" }),
      fetchedDocuments: fetchedDocuments([fetchedDocument({ docToken: "doc_remote", title: "远程文档" })]),
      pull: { outputDir: "拉取", namingRules: [] },
      state: rootState(),
      existingLocalFiles: new Map([["拉取/远程文档.md", "local-hash"]])
    });

    expect(proposal.blockers).toEqual(["Existing local file is not owned by pull state: 拉取/远程文档.md"]);
  });

  it("creates a blocker when pull document state is keyed by local path but stores a different local path", () => {
    const proposal = buildPullProposal({
      scan: docScan({ title: "远程文档", docToken: "doc_remote" }),
      fetchedDocuments: fetchedDocuments([fetchedDocument({ docToken: "doc_remote", title: "远程文档" })]),
      pull: { outputDir: "拉取", namingRules: [] },
      state: rootState({
        documents: {
          "拉取/远程文档.md": pullDocumentState({
            docToken: "doc_remote",
            localPath: "别处/远程文档.md",
            localHash: "owned-local-hash"
          })
        }
      }),
      existingLocalFiles: new Map([["拉取/远程文档.md", "owned-local-hash"]])
    });

    expect(proposal.blockers).toEqual(["Existing local file is not owned by pull state: 拉取/远程文档.md"]);
    expect(proposal.files[0]?.expectedLocalHash).toBeUndefined();
  });

  it("plans an update when an existing local file is pull-owned and matches state hash", () => {
    const proposal = buildPullProposal({
      scan: docScan({ title: "远程文档", docToken: "doc_remote" }),
      fetchedDocuments: fetchedDocuments([
        fetchedDocument({ docToken: "doc_remote", title: "远程文档", revisionId: "rev_2", markdown: "# 远程文档\n\n新版" })
      ]),
      pull: { outputDir: "拉取", namingRules: [] },
      state: rootState({
        documents: {
          "拉取/远程文档.md": pullDocumentState({
            docToken: "doc_remote",
            remoteTitle: "远程文档",
            localPath: "拉取/远程文档.md",
            localHash: "owned-local-hash",
            remoteRevision: "rev_1"
          })
        }
      }),
      existingLocalFiles: new Map([["拉取/远程文档.md", "owned-local-hash"]])
    });

    expect(proposal.blockers).toEqual([]);
    expect(proposal.files).toHaveLength(1);
    expect(proposal.files[0]).toMatchObject({
      kind: "document",
      docToken: "doc_remote",
      localPath: "拉取/远程文档.md",
      expectedRevisionId: "rev_2",
      expectedLocalHash: "owned-local-hash"
    });
    expect(proposal.files[0]?.contentHash).toEqual(expect.any(String));
  });

  it("plans a recreate when a pull-owned local file is currently missing", () => {
    const proposal = buildPullProposal({
      scan: docScan({ title: "远程文档", docToken: "doc_remote" }),
      fetchedDocuments: fetchedDocuments([fetchedDocument({ docToken: "doc_remote", title: "远程文档" })]),
      pull: { outputDir: "拉取", namingRules: [] },
      state: rootState({
        documents: {
          "拉取/远程文档.md": pullDocumentState({
            docToken: "doc_remote",
            remoteTitle: "远程文档",
            localPath: "拉取/远程文档.md",
            localHash: "owned-local-hash"
          })
        }
      })
    });

    expect(proposal.blockers).toEqual([]);
    expect(proposal.files[0]).toMatchObject({
      docToken: "doc_remote",
      localPath: "拉取/远程文档.md"
    });
    expect(proposal.files[0]?.expectedLocalHash).toBeUndefined();
  });

  it("plans media downloads under assets/<doc-stem>/ beside the planned document", () => {
    const proposal = buildPullProposal({
      scan: docScan({ title: "图文文档", docToken: "doc_media" }),
      fetchedDocuments: fetchedDocuments([
        fetchedDocument({
          docToken: "doc_media",
          title: "图文文档",
          media: [
            {
              kind: "image",
              token: "img_token",
              href: "https://stream/image",
              name: "diagram.png",
              alt: "Diagram"
            },
            {
              kind: "file",
              token: "file_token",
              href: "https://stream/file",
              name: "source.pdf",
              alt: ""
            }
          ]
        })
      ]),
      pull: { outputDir: "拉取", namingRules: [] },
      state: rootState()
    });

    expect(proposal.assets).toEqual([
      {
        ownerDocToken: "doc_media",
        kind: "image",
        name: "diagram.png",
        sourceToken: "img_token",
        sourceHref: "https://stream/image",
        localPath: "拉取/assets/图文文档/diagram.png"
      },
      {
        ownerDocToken: "doc_media",
        kind: "file",
        name: "source.pdf",
        sourceToken: "file_token",
        sourceHref: "https://stream/file",
        localPath: "拉取/assets/图文文档/source.pdf"
      }
    ]);
  });

  it("creates a blocker when multiple remote assets map to the same local path", () => {
    const proposal = buildPullProposal({
      scan: {
        source: { type: "folder", tokenOrUrl: "fld_root", title: "参考资料" },
        indexes: [],
        documents: [
          remoteDocument({ title: "A", docToken: "doc_a" }),
          remoteDocument({ title: "B", docToken: "doc_b" })
        ],
        warnings: []
      },
      fetchedDocuments: fetchedDocuments([
        fetchedDocument({
          docToken: "doc_a",
          title: "A",
          media: [{ kind: "image", token: "img_a", href: "https://stream/a", name: "diagram.png", alt: "" }]
        }),
        fetchedDocument({
          docToken: "doc_b",
          title: "B",
          media: [{ kind: "image", token: "img_b", href: "https://stream/b", name: "diagram.png", alt: "" }]
        })
      ]),
      pull: {
        outputDir: "拉取",
        namingRules: [
          { match: { token: "doc_a" }, localPath: "A.md" },
          { match: { token: "doc_b" }, localPath: "A" }
        ]
      },
      state: rootState()
    });

    expect(proposal.blockers).toContain("Multiple remote assets map to the same local path: 拉取/assets/A/diagram.png");
  });

  it("creates a blocker when an existing local asset is not owned by matching pull state", () => {
    const proposal = buildPullProposal({
      scan: docScan({ title: "图文文档", docToken: "doc_media" }),
      fetchedDocuments: fetchedDocuments([
        fetchedDocument({
          docToken: "doc_media",
          title: "图文文档",
          media: [{ kind: "image", token: "img_token", href: "https://stream/image", name: "diagram.png", alt: "" }]
        })
      ]),
      pull: { outputDir: "拉取", namingRules: [] },
      state: rootState(),
      existingLocalFiles: new Map([["拉取/assets/图文文档/diagram.png", "local-hash"]])
    });

    expect(proposal.blockers).toEqual(["Existing local asset is not owned by pull state: 拉取/assets/图文文档/diagram.png"]);
  });

  it("does not let asset state with a different owner authorize overwrite", () => {
    const proposal = buildPullProposal({
      scan: docScan({ title: "图文文档", docToken: "doc_media" }),
      fetchedDocuments: fetchedDocuments([
        fetchedDocument({
          docToken: "doc_media",
          title: "图文文档",
          media: [{ kind: "image", token: "img_token", href: "https://stream/image", name: "diagram.png", alt: "" }]
        })
      ]),
      pull: { outputDir: "拉取", namingRules: [] },
      state: rootState({
        assets: {
          "拉取/assets/图文文档/diagram.png": pullAssetState({
            localPath: "拉取/assets/图文文档/diagram.png",
            ownerDocToken: "doc_other",
            hash: "asset-hash"
          })
        }
      }),
      existingLocalFiles: new Map([["拉取/assets/图文文档/diagram.png", "asset-hash"]])
    });

    expect(proposal.blockers).toEqual(["Existing local asset is not owned by pull state: 拉取/assets/图文文档/diagram.png"]);
  });

  it("does not let asset state keyed by planned path authorize a different local path", () => {
    const proposal = buildPullProposal({
      scan: docScan({ title: "图文文档", docToken: "doc_media" }),
      fetchedDocuments: fetchedDocuments([
        fetchedDocument({
          docToken: "doc_media",
          title: "图文文档",
          media: [{ kind: "image", token: "img_token", href: "https://stream/image", name: "diagram.png", alt: "" }]
        })
      ]),
      pull: { outputDir: "拉取", namingRules: [] },
      state: rootState({
        assets: {
          "拉取/assets/图文文档/diagram.png": pullAssetState({
            localPath: "拉取/assets/旧文档/diagram.png",
            ownerDocToken: "doc_media",
            hash: "asset-hash"
          })
        }
      }),
      existingLocalFiles: new Map([["拉取/assets/图文文档/diagram.png", "asset-hash"]])
    });

    expect(proposal.blockers).toEqual(["Existing local asset is not owned by pull state: 拉取/assets/图文文档/diagram.png"]);
  });

  it("creates a blocker when an existing pull-owned asset has local changes", () => {
    const proposal = buildPullProposal({
      scan: docScan({ title: "图文文档", docToken: "doc_media" }),
      fetchedDocuments: fetchedDocuments([
        fetchedDocument({
          docToken: "doc_media",
          title: "图文文档",
          media: [{ kind: "image", token: "img_token", href: "https://stream/image", name: "diagram.png", alt: "" }]
        })
      ]),
      pull: { outputDir: "拉取", namingRules: [] },
      state: rootState({
        assets: {
          "拉取/assets/图文文档/diagram.png": pullAssetState({
            localPath: "拉取/assets/图文文档/diagram.png",
            ownerDocToken: "doc_media",
            hash: "asset-hash"
          })
        }
      }),
      existingLocalFiles: new Map([["拉取/assets/图文文档/diagram.png", "changed-hash"]])
    });

    expect(proposal.blockers).toEqual(["Existing pull-owned asset has local changes since last pull: 拉取/assets/图文文档/diagram.png"]);
  });

  it("plans an asset update with expected local hash when pull-owned asset matches state hash", () => {
    const proposal = buildPullProposal({
      scan: docScan({ title: "图文文档", docToken: "doc_media" }),
      fetchedDocuments: fetchedDocuments([
        fetchedDocument({
          docToken: "doc_media",
          title: "图文文档",
          media: [{ kind: "image", token: "img_token", href: "https://stream/image", name: "diagram.png", alt: "" }]
        })
      ]),
      pull: { outputDir: "拉取", namingRules: [] },
      state: rootState({
        assets: {
          "拉取/assets/图文文档/diagram.png": pullAssetState({
            localPath: "拉取/assets/图文文档/diagram.png",
            ownerDocToken: "doc_media",
            hash: "asset-hash"
          })
        }
      }),
      existingLocalFiles: new Map([["拉取/assets/图文文档/diagram.png", "asset-hash"]])
    });

    expect(proposal.blockers).toEqual([]);
    expect(proposal.assets[0]).toMatchObject({
      ownerDocToken: "doc_media",
      localPath: "拉取/assets/图文文档/diagram.png",
      expectedLocalHash: "asset-hash"
    });
  });

  it("plans a missing pull-owned asset without expected local hash", () => {
    const proposal = buildPullProposal({
      scan: docScan({ title: "图文文档", docToken: "doc_media" }),
      fetchedDocuments: fetchedDocuments([
        fetchedDocument({
          docToken: "doc_media",
          title: "图文文档",
          media: [{ kind: "image", token: "img_token", href: "https://stream/image", name: "diagram.png", alt: "" }]
        })
      ]),
      pull: { outputDir: "拉取", namingRules: [] },
      state: rootState({
        assets: {
          "拉取/assets/图文文档/diagram.png": pullAssetState({
            localPath: "拉取/assets/图文文档/diagram.png",
            ownerDocToken: "doc_media",
            hash: "asset-hash"
          })
        }
      })
    });

    expect(proposal.blockers).toEqual([]);
    expect(proposal.assets[0]).toMatchObject({
      ownerDocToken: "doc_media",
      localPath: "拉取/assets/图文文档/diagram.png"
    });
    expect(proposal.assets[0]?.expectedLocalHash).toBeUndefined();
  });

  it("rejects asset policy directory traversal outside the workspace root", () => {
    expect(() =>
      buildPullProposal({
        scan: docScan({ title: "图文文档", docToken: "doc_media" }),
        fetchedDocuments: fetchedDocuments([
          fetchedDocument({
            docToken: "doc_media",
            title: "图文文档",
            media: [{ kind: "image", token: "img_token", href: "https://stream/image", name: "diagram.png", alt: "" }]
          })
        ]),
        pull: { outputDir: "拉取", assetPolicy: { directoryName: "../outside" } },
        state: rootState()
      })
    ).toThrow(/workspace root|escapes/);
  });

  it("rejects asset policy absolute directories", () => {
    expect(() =>
      buildPullProposal({
        scan: docScan({ title: "图文文档", docToken: "doc_media" }),
        fetchedDocuments: fetchedDocuments([
          fetchedDocument({
            docToken: "doc_media",
            title: "图文文档",
            media: [{ kind: "image", token: "img_token", href: "https://stream/image", name: "diagram.png", alt: "" }]
          })
        ]),
        pull: { outputDir: "拉取", assetPolicy: { directoryName: "/abs" } },
        state: rootState()
      })
    ).toThrow(/workspace root|escapes/);
  });

  it("rejects asset policy Windows drive absolute directories", () => {
    expect(() =>
      buildPullProposal({
        scan: docScan({ title: "图文文档", docToken: "doc_media" }),
        fetchedDocuments: fetchedDocuments([
          fetchedDocument({
            docToken: "doc_media",
            title: "图文文档",
            media: [{ kind: "image", token: "img_token", href: "https://stream/image", name: "diagram.png", alt: "" }]
          })
        ]),
        pull: { outputDir: "拉取", assetPolicy: { directoryName: "C:/assets" } },
        state: rootState()
      })
    ).toThrow(/workspace root|escapes/);
  });

  it("rejects asset policy Windows drive-relative directories", () => {
    expect(() =>
      buildPullProposal({
        scan: docScan({ title: "图文文档", docToken: "doc_media" }),
        fetchedDocuments: fetchedDocuments([
          fetchedDocument({
            docToken: "doc_media",
            title: "图文文档",
            media: [{ kind: "image", token: "img_token", href: "https://stream/image", name: "diagram.png", alt: "" }]
          })
        ]),
        pull: { outputDir: "拉取", assetPolicy: { directoryName: "C:assets" } },
        state: rootState()
      })
    ).toThrow(/workspace root|escapes/);
  });

  it("rejects existing local file Windows drive absolute paths", () => {
    expect(() =>
      buildPullProposal({
        scan: docScan({ title: "远程文档", docToken: "doc_remote" }),
        fetchedDocuments: fetchedDocuments([fetchedDocument({ docToken: "doc_remote", title: "远程文档" })]),
        pull: { outputDir: "拉取", namingRules: [] },
        state: rootState(),
        existingLocalFiles: new Map([["C:/tmp/file.md", "local-hash"]])
      })
    ).toThrow(/workspace root|escapes/);
  });

  it("rejects existing local file Windows drive-relative paths", () => {
    expect(() =>
      buildPullProposal({
        scan: docScan({ title: "远程文档", docToken: "doc_remote" }),
        fetchedDocuments: fetchedDocuments([fetchedDocument({ docToken: "doc_remote", title: "远程文档" })]),
        pull: { outputDir: "拉取", namingRules: [] },
        state: rootState(),
        existingLocalFiles: new Map([["C:tmp/file.md", "local-hash"]])
      })
    ).toThrow(/workspace root|escapes/);
  });

  it("carries scan warnings into proposal warnings", () => {
    const proposal = buildPullProposal({
      scan: {
        ...docScan({ title: "远程文档", docToken: "doc_remote" }),
        warnings: [{ message: "Skipping non-document item: 素材表" }]
      },
      fetchedDocuments: fetchedDocuments([fetchedDocument({ docToken: "doc_remote", title: "远程文档" })]),
      pull: { outputDir: "拉取", namingRules: [] },
      state: rootState()
    });

    expect(proposal.warnings).toEqual(["Skipping non-document item: 素材表"]);
  });
});

describe("buildPullLinkIndex", () => {
  it("indexes planned files by doc token and wiki node token", () => {
    const files = planPullPaths({ scan: wikiScan(), outputDir: ".", namingRules: [] });

    const index = buildPullLinkIndex(files);

    expect(index.get("doc_theory")).toEqual({
      stem: "故事块理论文献",
      localPath: "参考资料/故事块理论文献.md"
    });
    expect(index.get("wiki_mask")).toEqual({
      stem: "EN《玫瑰面具》中的对话表现力",
      localPath: "参考资料/EN《玫瑰面具》中的对话表现力.md"
    });
  });

  it("marks duplicate stems with path targets for unambiguous Obsidian links", () => {
    const index = buildPullLinkIndex([
      {
        kind: "document",
        title: "同名",
        docToken: "doc_a",
        remotePath: "参考资料/A/同名",
        localPath: "参考资料/A/同名.md"
      },
      {
        kind: "document",
        title: "同名",
        docToken: "doc_b",
        remotePath: "参考资料/B/同名",
        localPath: "参考资料/B/同名.md"
      }
    ]);

    expect(index.get("doc_a")).toEqual({
      stem: "同名",
      localPath: "参考资料/A/同名.md",
      wikiTarget: "参考资料/A/同名"
    });
    expect(index.get("doc_b")).toEqual({
      stem: "同名",
      localPath: "参考资料/B/同名.md",
      wikiTarget: "参考资料/B/同名"
    });
  });
});

describe("renderPullProposalMarkdown", () => {
  it("lists actions, blockers, warnings, source type, planned files, and planned assets", () => {
    const proposal = buildPullProposal({
      scan: {
        ...docScan({ title: "图文文档", docToken: "doc_media" }),
        warnings: [{ message: "Skipping non-document item: 素材表" }]
      },
      fetchedDocuments: fetchedDocuments([
        fetchedDocument({
          docToken: "doc_media",
          title: "图文文档",
          media: [{ kind: "image", token: "img_token", href: "https://stream/image", name: "diagram.png", alt: "" }]
        })
      ]),
      pull: { outputDir: "拉取", namingRules: [] },
      state: rootState(),
      existingLocalFiles: new Map([["拉取/图文文档.md", "unowned"]]),
      now: new Date("2026-06-22T00:00:00.000Z")
    });

    const markdown = renderPullProposalMarkdown(proposal);

    expect(proposal.id).toBe(proposalId("2026-06-22T00:00:00.000Z"));
    expect(markdown).toContain("## Source");
    expect(markdown).toContain("- Type: doc");
    expect(markdown).toContain("## Actions");
    expect(markdown).toContain("- write document 拉取/图文文档.md");
    expect(markdown).toContain("## Blockers");
    expect(markdown).toContain("- Existing local file is not owned by pull state: 拉取/图文文档.md");
    expect(markdown).toContain("## Warnings");
    expect(markdown).toContain("- Skipping non-document item: 素材表");
    expect(markdown).toContain("## Planned Files");
    expect(markdown).toContain("- document 图文文档 -> 拉取/图文文档.md");
    expect(markdown).toContain("## Planned Assets");
    expect(markdown).toContain("- image diagram.png -> 拉取/assets/图文文档/diagram.png");
  });
});

function wikiScan(): PullScanResult {
  return {
    source: { type: "wiki_node", tokenOrUrl: "wiki_parent", title: "参考资料" },
    indexes: [
      {
        title: "参考资料",
        docToken: "doc_parent",
        wikiNodeToken: "wiki_parent",
        remotePath: "参考资料",
        childDocTokens: ["doc_theory", "doc_mask"]
      }
    ],
    documents: [
      remoteDocument({
        title: "故事块理论文献",
        docToken: "doc_theory",
        wikiNodeToken: "wiki_theory",
        remotePath: "参考资料/故事块理论文献"
      }),
      remoteDocument({
        title: "EN《玫瑰面具》中的对话表现力",
        docToken: "doc_mask",
        wikiNodeToken: "wiki_mask",
        remotePath: "参考资料/EN《玫瑰面具》中的对话表现力"
      })
    ],
    warnings: []
  };
}

function docScan(input: { title: string; docToken: string }): PullScanResult {
  return {
    source: { type: "doc", tokenOrUrl: input.docToken, title: input.title },
    indexes: [],
    documents: [remoteDocument({ title: input.title, docToken: input.docToken, remotePath: input.title })],
    warnings: []
  };
}

function remoteDocument(overrides: Partial<PullScanResult["documents"][number]> = {}): PullScanResult["documents"][number] {
  return {
    sourceKind: "wiki_node",
    title: "远程文档",
    docToken: "doc_remote",
    wikiNodeToken: "wiki_remote",
    sourceUrl: "https://example.feishu.cn/wiki/wiki_remote",
    remotePath: "参考资料/远程文档",
    ...overrides
  };
}

function fetchedDocuments(documents: PullFetchedDocument[]): Map<string, PullFetchedDocument> {
  return new Map(documents.map((document) => [document.docToken, document]));
}

function fetchedDocument(overrides: Partial<PullFetchedDocument> = {}): PullFetchedDocument {
  return {
    docToken: "doc_remote",
    title: "远程文档",
    markdown: "# 远程文档\n\n正文",
    xml: "<document><title>远程文档</title></document>",
    revisionId: "rev_1",
    media: [],
    ...overrides
  };
}

function rootState(input: { documents?: Record<string, PullDocumentState>; assets?: Record<string, PullAssetState> } = {}): GitYourLarkRootState {
  return {
    version: 2,
    publish: {
      version: 1,
      remoteFolderToken: "fld_publish",
      documents: {},
      attachments: {}
    },
    pull: {
      sources: {},
      documents: input.documents ?? {},
      assets: input.assets ?? {}
    }
  };
}

function pullDocumentState(overrides: Partial<PullDocumentState> = {}): PullDocumentState {
  return {
    docToken: "doc_remote",
    remoteTitle: "远程文档",
    remotePath: "远程文档",
    localPath: "拉取/远程文档.md",
    remoteRevision: "rev_1",
    localHash: "owned-local-hash",
    assetPaths: [],
    ...overrides
  };
}

function pullAssetState(overrides: Partial<PullAssetState> = {}): PullAssetState {
  return {
    localPath: "拉取/assets/图文文档/diagram.png",
    ownerDocToken: "doc_media",
    hash: "asset-hash",
    ...overrides
  };
}
