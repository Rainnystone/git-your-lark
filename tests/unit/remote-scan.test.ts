import { describe, expect, it } from "vitest";
import { scanRemoteFolder } from "../../scripts/lib/remote-scan.js";
import type { CommandResult } from "../../scripts/lib/lark-cli.js";

describe("scanRemoteFolder", () => {
  it("scans all remote pages and maps Lark modified_time", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const run = async (command: string, args: string[]): Promise<CommandResult> => {
      calls.push({ command, args });
      const params = JSON.parse(args[args.indexOf("--params") + 1]) as { page_token?: string };

      if (!params.page_token) {
        return {
          code: 0,
          stdout: JSON.stringify({
            data: {
              files: [
                {
                  name: "001_doc",
                  token: "doc_1",
                  type: "docx",
                  url: "https://example.test/doc_1",
                  modified_time: "1710000000"
                }
              ],
              has_more: true,
              next_page_token: "next-page"
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
                name: "diagram.png",
                token: "img_1",
                type: "file",
                modified_time: "1710000100"
              }
            ],
            has_more: false
          }
        }),
        stderr: ""
      };
    };

    const manifest = await scanRemoteFolder("fld_remote", run);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.command).toBe("lark-cli");
    expect(calls[0]?.args).toEqual([
      "drive",
      "files",
      "list",
      "--as",
      "user",
      "--params",
      JSON.stringify({ folder_token: "fld_remote", page_size: 200 }),
      "--format",
      "json"
    ]);
    expect(calls[1]?.command).toBe("lark-cli");
    const secondArgs = calls[1]?.args ?? [];
    expect(secondArgs.slice(0, 6)).toEqual(["drive", "files", "list", "--as", "user", "--params"]);
    expect(JSON.parse(secondArgs[secondArgs.indexOf("--params") + 1] ?? "{}")).toMatchObject({
      folder_token: "fld_remote",
      page_size: 200,
      page_token: "next-page"
    });
    expect(manifest).toEqual({
      folderToken: "fld_remote",
      entries: [
        {
          name: "001_doc",
          token: "doc_1",
          type: "docx",
          url: "https://example.test/doc_1",
          modifiedTime: "1710000000"
        },
        {
          name: "diagram.png",
          token: "img_1",
          type: "file",
          modifiedTime: "1710000100"
        }
      ]
    });
  });

  it("rejects with stdout and stderr when lark-cli exits nonzero", async () => {
    const run = async (): Promise<CommandResult> => ({
      code: 2,
      stdout: "partial output",
      stderr: "permission denied"
    });

    await expect(scanRemoteFolder("fld_remote", run)).rejects.toThrow(
      /lark-cli remote scan failed.*partial output.*permission denied/s
    );
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["blank", "   "]
  ])("rejects when has_more is true but next_page_token is %s", async (_name, nextPageToken) => {
    let calls = 0;
    const run = async (): Promise<CommandResult> => ({
      code: 0,
      stdout: JSON.stringify({
        data: {
          files: [
            {
              name: "001_doc",
              token: "doc_1",
              type: "docx"
            }
          ],
          has_more: calls++ === 0,
          ...(calls === 1 && nextPageToken !== undefined ? { next_page_token: nextPageToken } : {})
        }
      }),
      stderr: ""
    });

    await expect(scanRemoteFolder("fld_remote", run)).rejects.toThrow(/missing next_page_token/i);
  });
});
