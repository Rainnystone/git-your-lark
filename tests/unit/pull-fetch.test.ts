import { describe, expect, it } from "vitest";
import {
  fetchPullDocument,
  parsePullMediaFromXml,
  parseTitleFromFetchedContent
} from "../../scripts/lib/pull-fetch.js";
import type { CommandResult } from "../../scripts/lib/lark-cli.js";

describe("fetchPullDocument", () => {
  it("fetches markdown and full-detail XML, then returns parsed document content", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const xml = [
      "<document>",
      "<title>Remote</title>",
      '<img name="A.png" alt="A" href="https://stream/image" src="img_token"/>',
      '<figure><source name="source.md" href="https://stream/file" token="file_token"/></figure>',
      "</document>"
    ].join("");
    const run = async (command: string, args: string[]): Promise<CommandResult> => {
      calls.push({ command, args });

      if (args.includes("markdown")) {
        return {
          code: 0,
          stdout: JSON.stringify({ data: { document: { content: "# Remote\n\nBody", revision_id: "rev_1" } } }),
          stderr: ""
        };
      }

      return {
        code: 0,
        stdout: JSON.stringify({ data: { document: { content: xml, revision_id: "rev_1" } } }),
        stderr: ""
      };
    };

    const result = await fetchPullDocument("doc_token", run);

    expect(calls).toEqual([
      {
        command: "lark-cli",
        args: [
          "docs",
          "+fetch",
          "--api-version",
          "v2",
          "--doc",
          "doc_token",
          "--doc-format",
          "markdown",
          "--as",
          "user",
          "--format",
          "json"
        ]
      },
      {
        command: "lark-cli",
        args: [
          "docs",
          "+fetch",
          "--api-version",
          "v2",
          "--doc",
          "doc_token",
          "--doc-format",
          "xml",
          "--detail",
          "full",
          "--as",
          "user",
          "--format",
          "json"
        ]
      }
    ]);
    expect(result).toEqual({
      docToken: "doc_token",
      title: "Remote",
      markdown: "# Remote\n\nBody",
      xml,
      revisionId: "rev_1",
      media: [
        {
          kind: "image",
          token: "img_token",
          href: "https://stream/image",
          name: "A.png",
          alt: "A"
        },
        {
          kind: "file",
          token: "file_token",
          href: "https://stream/file",
          name: "source.md",
          alt: ""
        }
      ]
    });
  });
});

describe("parsePullMediaFromXml", () => {
  it("parses image and source assets from fetched XML", () => {
    const media = parsePullMediaFromXml(
      [
        '<img name="A.png" alt="A" href="https://stream/image" src="img_token"/>',
        '<source name="source.md" href="https://stream/file" token="file_token"/>'
      ].join("")
    );

    expect(media).toEqual([
      {
        kind: "image",
        token: "img_token",
        href: "https://stream/image",
        name: "A.png",
        alt: "A"
      },
      {
        kind: "file",
        token: "file_token",
        href: "https://stream/file",
        name: "source.md",
        alt: ""
      }
    ]);
  });

  it("parses lark token/url aliases from image and source XML", () => {
    const media = parsePullMediaFromXml(
      [
        '<img token="img_token" url="https://stream/image" name="A.png" alt="A"/>',
        '<image token="image_token" url="https://stream/image-2" name="B.png" alt="B"/>',
        '<source token="file_token" url="https://stream/file" name="source.md"/>'
      ].join("")
    );

    expect(media).toEqual([
      {
        kind: "image",
        token: "img_token",
        href: "https://stream/image",
        name: "A.png",
        alt: "A"
      },
      {
        kind: "image",
        token: "image_token",
        href: "https://stream/image-2",
        name: "B.png",
        alt: "B"
      },
      {
        kind: "file",
        token: "file_token",
        href: "https://stream/file",
        name: "source.md",
        alt: ""
      }
    ]);
  });

  it("parses future media token and URL aliases from fetched XML", () => {
    const media = parsePullMediaFromXml(
      [
        '<img image_token="img_token" image_url="https://stream/image" name="A.png" alt="A"/>',
        '<source file_token="file_token" file_url="https://stream/file" name="source.md"/>'
      ].join("")
    );

    expect(media).toEqual([
      {
        kind: "image",
        token: "img_token",
        href: "https://stream/image",
        name: "A.png",
        alt: "A"
      },
      {
        kind: "file",
        token: "file_token",
        href: "https://stream/file",
        name: "source.md",
        alt: ""
      }
    ]);
  });
});

describe("parseTitleFromFetchedContent", () => {
  it("prefers XML title, then markdown heading, then fallback token", () => {
    expect(parseTitleFromFetchedContent("# Markdown", "<document><title>Remote</title></document>", "doc_token")).toBe(
      "Remote"
    );
    expect(parseTitleFromFetchedContent("# Markdown", "<document><title>A &#35; B</title></document>", "doc_token")).toBe(
      "A # B"
    );
    expect(parseTitleFromFetchedContent("# Markdown", "<document></document>", "doc_token")).toBe("Markdown");
    expect(parseTitleFromFetchedContent("Body only", "", "doc_token")).toBe("doc_token");
  });
});
