import { describe, expect, it } from "vitest";
import { scanPullSource } from "../../scripts/lib/pull-source.js";
import type { CommandResult } from "../../scripts/lib/lark-cli.js";

describe("scanPullSource", () => {
  it("returns one document from drive inspect when a doc URL is supplied", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const run = async (command: string, args: string[]): Promise<CommandResult> => {
      calls.push({ command, args });
      return {
        code: 0,
        stdout: JSON.stringify({
          data: {
            name: "城寨故事方案",
            token: "doc_123",
            type: "docx",
            url: "https://example.feishu.cn/docx/doc_123",
            modified_time: "1710000000"
          }
        }),
        stderr: ""
      };
    };

    const result = await scanPullSource({ type: "doc", tokenOrUrl: "https://example.feishu.cn/docx/doc_123" }, run);

    expect(calls).toEqual([
      {
        command: "lark-cli",
        args: [
          "drive",
          "+inspect",
          "--as",
          "user",
          "--url",
          "https://example.feishu.cn/docx/doc_123",
          "--format",
          "json"
        ]
      }
    ]);
    expect(result).toEqual({
      source: {
        type: "doc",
        tokenOrUrl: "https://example.feishu.cn/docx/doc_123",
        title: "城寨故事方案"
      },
      documents: [
        {
          sourceKind: "doc",
          title: "城寨故事方案",
          docToken: "doc_123",
          remotePath: "城寨故事方案",
          sourceUrl: "https://example.feishu.cn/docx/doc_123",
          modifiedTime: "1710000000"
        }
      ],
      indexes: [],
      warnings: []
    });
  });

  it("inspects bare doc tokens as docx first and falls back to doc", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const run = async (command: string, args: string[]): Promise<CommandResult> => {
      calls.push({ command, args });

      if (args.includes("--type") && args[args.indexOf("--type") + 1] === "docx") {
        return {
          code: 1,
          stdout: "",
          stderr: "docx not found"
        };
      }

      return {
        code: 0,
        stdout: JSON.stringify({
          data: {
            name: "旧版文档",
            token: "doc_bare",
            type: "doc",
            url: "https://example.feishu.cn/doc/doc_bare"
          }
        }),
        stderr: ""
      };
    };

    const result = await scanPullSource({ type: "doc", tokenOrUrl: "doc_bare" }, run);

    expect(calls).toEqual([
      {
        command: "lark-cli",
        args: [
          "drive",
          "+inspect",
          "--as",
          "user",
          "--url",
          "doc_bare",
          "--type",
          "docx",
          "--format",
          "json"
        ]
      },
      {
        command: "lark-cli",
        args: [
          "drive",
          "+inspect",
          "--as",
          "user",
          "--url",
          "doc_bare",
          "--type",
          "doc",
          "--format",
          "json"
        ]
      }
    ]);
    expect(result.documents).toEqual([
      {
        sourceKind: "doc",
        title: "旧版文档",
        docToken: "doc_bare",
        remotePath: "旧版文档",
        sourceUrl: "https://example.feishu.cn/doc/doc_bare"
      }
    ]);
  });

  it("recursively scans folders, includes doc and docx files, and warns for non-doc files", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const run = async (command: string, args: string[]): Promise<CommandResult> => {
      calls.push({ command, args });

      if (args[0] === "drive" && args[1] === "+inspect") {
        return {
          code: 0,
          stdout: JSON.stringify({
            data: {
              name: "参考资料",
              token: "fld_root",
              type: "folder",
              url: "https://example.feishu.cn/drive/folder/fld_root"
            }
          }),
          stderr: ""
        };
      }

      const params = JSON.parse(args[args.indexOf("--params") + 1] ?? "{}") as { folder_token: string };
      if (params.folder_token === "fld_root") {
        return {
          code: 0,
          stdout: JSON.stringify({
            data: {
              files: [
                {
                  name: "世界观补丁",
                  token: "docx_world",
                  type: "docx",
                  url: "https://example.feishu.cn/docx/docx_world",
                  modified_time: "1710000100"
                },
                {
                  name: "子目录",
                  token: "fld_child",
                  type: "folder"
                },
                {
                  name: "预算表",
                  token: "sheet_budget",
                  type: "sheet",
                  url: "https://example.feishu.cn/sheets/sheet_budget"
                }
              ],
              has_more: false
            }
          }),
          stderr: ""
        };
      }

      return {
        code: 0,
        stdout: JSON.stringify({
          data: {
            files: [
              {
                name: "旧版故事",
                token: "doc_legacy",
                type: "doc",
                url: "https://example.feishu.cn/doc/doc_legacy"
              },
              {
                name: "示意图.png",
                token: "file_diagram",
                type: "file"
              }
            ],
            has_more: false
          }
        }),
        stderr: ""
      };
    };

    const result = await scanPullSource({ type: "folder", tokenOrUrl: "https://example.feishu.cn/drive/folder/fld_root" }, run);

    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({
      command: "lark-cli",
      args: [
        "drive",
        "+inspect",
        "--as",
        "user",
        "--url",
        "https://example.feishu.cn/drive/folder/fld_root",
        "--format",
        "json"
      ]
    });
    expect(calls[1]?.command).toBe("lark-cli");
    expect(calls[1]?.args).toEqual([
      "drive",
      "files",
      "list",
      "--as",
      "user",
      "--params",
      JSON.stringify({ folder_token: "fld_root", page_size: 200 }),
      "--format",
      "json"
    ]);
    expect(calls[2]?.command).toBe("lark-cli");
    expect(JSON.parse(calls[2]?.args[calls[2]?.args.indexOf("--params") + 1] ?? "{}")).toEqual({
      folder_token: "fld_child",
      page_size: 200
    });
    expect(result.documents).toEqual([
      {
        sourceKind: "folder",
        title: "世界观补丁",
        docToken: "docx_world",
        remotePath: "参考资料/世界观补丁",
        sourceUrl: "https://example.feishu.cn/docx/docx_world",
        modifiedTime: "1710000100"
      },
      {
        sourceKind: "folder",
        title: "旧版故事",
        docToken: "doc_legacy",
        remotePath: "参考资料/子目录/旧版故事",
        sourceUrl: "https://example.feishu.cn/doc/doc_legacy"
      }
    ]);
    expect(result.indexes).toEqual([]);
    expect(result.warnings).toEqual([
      {
        message: "Skipping non-document item: 预算表",
        title: "预算表",
        type: "sheet",
        token: "sheet_budget",
        url: "https://example.feishu.cn/sheets/sheet_budget"
      },
      {
        message: "Skipping non-document item: 示意图.png",
        title: "示意图.png",
        type: "file",
        token: "file_diagram"
      }
    ]);
  });

  it("warns when folder documents duplicate remote paths or doc tokens", async () => {
    const run = async (command: string, args: string[]): Promise<CommandResult> => {
      if (args[0] === "drive" && args[1] === "+inspect") {
        return {
          code: 0,
          stdout: JSON.stringify({
            data: {
              name: "参考资料",
              token: "fld_root",
              type: "folder"
            }
          }),
          stderr: ""
        };
      }

      return {
        code: 0,
        stdout: JSON.stringify({
          data: {
            files: [
              {
                name: "重复文档",
                token: "doc_a",
                type: "docx"
              },
              {
                name: "重复文档",
                token: "doc_b",
                type: "docx"
              },
              {
                name: "别名一",
                token: "doc_same",
                type: "docx"
              },
              {
                name: "别名二",
                token: "doc_same",
                type: "docx"
              }
            ],
            has_more: false
          }
        }),
        stderr: ""
      };
    };

    const result = await scanPullSource({ type: "folder", tokenOrUrl: "https://example.feishu.cn/drive/folder/fld_root" }, run);

    expect(result.documents).toHaveLength(4);
    expect(result.warnings).toEqual([
      {
        message: "Duplicate remote path: 参考资料/重复文档",
        title: "重复文档",
        type: "docx",
        token: "doc_b",
        remotePath: "参考资料/重复文档"
      },
      {
        message: "Duplicate document token: doc_same",
        title: "别名二",
        type: "docx",
        token: "doc_same",
        remotePath: "参考资料/别名二"
      }
    ]);
  });

  it("unwraps wiki URLs using nested wiki_node token from drive inspect", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const run = async (command: string, args: string[]): Promise<CommandResult> => {
      calls.push({ command, args });

      if (args[0] === "drive" && args[1] === "+inspect") {
        return {
          code: 0,
          stdout: JSON.stringify({
            data: {
              title: "参考资料",
              token: "doc_parent",
              type: "docx",
              url: "https://example.feishu.cn/docx/doc_parent",
              wiki_node: {
                title: "参考资料",
                node_token: "wiki_parent",
                obj_token: "doc_parent",
                obj_type: "docx",
                node_type: "origin",
                has_child: true,
                space_id: "space_1",
                url: "https://example.feishu.cn/wiki/wiki_parent"
              }
            }
          }),
          stderr: ""
        };
      }

      if (args[0] === "wiki" && args[1] === "+node-get") {
        return {
          code: 0,
          stdout: JSON.stringify({
            data: {
              node: {
                title: "参考资料",
                node_token: "wiki_parent",
                obj_token: "doc_parent",
                obj_type: "docx",
                node_type: "origin",
                has_child: false,
                space_id: "space_1"
              }
            }
          }),
          stderr: ""
        };
      }

      return {
        code: 0,
        stdout: JSON.stringify({ data: { items: [] } }),
        stderr: ""
      };
    };

    await scanPullSource({ type: "wiki_node", tokenOrUrl: "https://example.feishu.cn/wiki/wiki_parent" }, run);

    expect(calls[1]).toEqual({
      command: "lark-cli",
      args: ["wiki", "+node-get", "--as", "user", "--node-token", "wiki_parent", "--format", "json"]
    });
  });

  it("recursively scans wiki nodes, includes doc children, and creates an index plan for the selected parent node", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const run = async (command: string, args: string[]): Promise<CommandResult> => {
      calls.push({ command, args });

      if (args[0] === "wiki" && args[1] === "+node-get") {
        return {
          code: 0,
          stdout: JSON.stringify({
            data: {
              node: {
                title: "参考资料",
                node_token: "wiki_parent",
                obj_token: "doc_parent",
                obj_type: "docx",
                node_type: "origin",
                has_child: true,
                space_id: "space_1",
                url: "https://example.feishu.cn/wiki/wiki_parent"
              }
            }
          }),
          stderr: ""
        };
      }

      return {
        code: 0,
        stdout: JSON.stringify({
          data: {
            items: [
              {
                title: "故事块理论文献",
                node_token: "wiki_child",
                obj_token: "doc_child",
                obj_type: "docx",
                node_type: "origin",
                has_child: false,
                space_id: "space_1",
                url: "https://example.feishu.cn/wiki/wiki_child"
              },
              {
                title: "素材表",
                node_token: "wiki_sheet",
                obj_token: "sheet_1",
                obj_type: "sheet",
                node_type: "origin",
                has_child: false,
                space_id: "space_1",
                url: "https://example.feishu.cn/wiki/wiki_sheet"
              }
            ]
          }
        }),
        stderr: ""
      };
    };

    const result = await scanPullSource({ type: "wiki_node", tokenOrUrl: "wiki_parent" }, run);

    expect(calls).toEqual([
      {
        command: "lark-cli",
        args: ["wiki", "+node-get", "--as", "user", "--node-token", "wiki_parent", "--format", "json"]
      },
      {
        command: "lark-cli",
        args: [
          "wiki",
          "+node-list",
          "--as",
          "user",
          "--space-id",
          "space_1",
          "--parent-node-token",
          "wiki_parent",
          "--page-all",
          "--page-limit",
          "0",
          "--format",
          "json"
        ]
      }
    ]);
    expect(result.indexes).toEqual([
      {
        title: "参考资料",
        docToken: "doc_parent",
        wikiNodeToken: "wiki_parent",
        remotePath: "参考资料",
        childDocTokens: ["doc_child"]
      }
    ]);
    expect(result.documents).toEqual([
      {
        sourceKind: "wiki_node",
        title: "故事块理论文献",
        docToken: "doc_child",
        wikiNodeToken: "wiki_child",
        remotePath: "参考资料/故事块理论文献",
        sourceUrl: "https://example.feishu.cn/wiki/wiki_child"
      }
    ]);
    expect(result.warnings).toEqual([
      {
        message: "Skipping non-document item: 素材表",
        title: "素材表",
        type: "sheet",
        token: "sheet_1",
        url: "https://example.feishu.cn/wiki/wiki_sheet"
      }
    ]);
  });

  it("uses non-document wiki parents as path containers without creating indexes", async () => {
    const run = async (_command: string, args: string[]): Promise<CommandResult> => {
      if (args[0] === "wiki" && args[1] === "+node-get") {
        return {
          code: 0,
          stdout: JSON.stringify({
            data: {
              node: {
                title: "数据容器",
                node_token: "wiki_parent",
                obj_token: "sheet_parent",
                obj_type: "sheet",
                node_type: "origin",
                has_child: true,
                space_id: "space_1",
                url: "https://example.feishu.cn/wiki/wiki_parent"
              }
            }
          }),
          stderr: ""
        };
      }

      return {
        code: 0,
        stdout: JSON.stringify({
          data: {
            items: [
              {
                title: "有效文档",
                node_token: "wiki_child",
                obj_token: "doc_child",
                obj_type: "docx",
                node_type: "origin",
                has_child: false,
                space_id: "space_1"
              }
            ]
          }
        }),
        stderr: ""
      };
    };

    const result = await scanPullSource({ type: "wiki_node", tokenOrUrl: "wiki_parent" }, run);

    expect(result.documents).toEqual([
      {
        sourceKind: "wiki_node",
        title: "有效文档",
        docToken: "doc_child",
        wikiNodeToken: "wiki_child",
        remotePath: "数据容器/有效文档"
      }
    ]);
    expect(result.indexes).toEqual([]);
    expect(result.warnings).toEqual([
      {
        message: "Skipping non-document item: 数据容器",
        title: "数据容器",
        type: "sheet",
        token: "sheet_parent",
        url: "https://example.feishu.cn/wiki/wiki_parent",
        remotePath: "数据容器"
      }
    ]);
  });
});
