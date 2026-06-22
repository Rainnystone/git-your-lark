import { extractJson, runCommand, type CommandResult } from "./lark-cli.js";

type CommandRunner = (command: string, args: string[], cwd?: string) => Promise<CommandResult>;

export interface PullFetchedDocument {
  docToken: string;
  title: string;
  markdown: string;
  xml: string;
  revisionId?: string;
  media: PullFetchedMedia[];
}

export interface PullFetchedMedia {
  kind: "image" | "file";
  token?: string;
  href?: string;
  name: string;
  alt: string;
}

interface FetchedContent {
  content: string;
  revisionId?: string;
}

export async function fetchPullDocument(
  docToken: string,
  run: CommandRunner = runCommand
): Promise<PullFetchedDocument> {
  const markdown = await fetchDocumentContent(docToken, "markdown", run);
  const xml = await fetchDocumentContent(docToken, "xml", run);

  return {
    docToken,
    title: parseTitleFromFetchedContent(markdown.content, xml.content, docToken),
    markdown: markdown.content,
    xml: xml.content,
    ...(xml.revisionId || markdown.revisionId ? { revisionId: xml.revisionId ?? markdown.revisionId } : {}),
    media: parsePullMediaFromXml(xml.content)
  };
}

export function parsePullMediaFromXml(xml: string): PullFetchedMedia[] {
  const media: PullFetchedMedia[] = [];

  for (const tag of xml.matchAll(/<(?:img|image)\b[^>]*>/gi)) {
    const attributes = parseAttributes(tag[0]);
    const token = firstAttribute(attributes, mediaTokenAttributeNames);
    const href = firstAttribute(attributes, mediaUrlAttributeNames);
    media.push({
      kind: "image",
      ...(token ? { token } : {}),
      ...(href ? { href } : {}),
      name: attributes.name || token || href || "image",
      alt: attributes.alt || ""
    });
  }

  for (const tag of xml.matchAll(/<source\b[^>]*>/gi)) {
    const attributes = parseAttributes(tag[0]);
    const token = firstAttribute(attributes, mediaTokenAttributeNames);
    const href = firstAttribute(attributes, mediaUrlAttributeNames);
    media.push({
      kind: "file",
      ...(token ? { token } : {}),
      ...(href ? { href } : {}),
      name: attributes.name || token || href || "attachment",
      alt: attributes.alt || ""
    });
  }

  return media;
}

const mediaTokenAttributeNames = ["token", "src", "image_token", "file_token", "media_token"];
const mediaUrlAttributeNames = ["url", "href", "image_url", "file_url", "media_url"];

export function parseTitleFromFetchedContent(markdown: string, xml: string, fallback: string): string {
  const xmlTitle = xml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (xmlTitle?.trim()) {
    return decodeXmlText(stripTags(xmlTitle).trim());
  }

  const markdownHeading = markdown.match(/^\s*#\s+(.+?)\s*#*\s*$/m)?.[1];
  if (markdownHeading?.trim()) {
    return markdownHeading.trim();
  }

  return fallback;
}

async function fetchDocumentContent(
  docToken: string,
  docFormat: "markdown" | "xml",
  run: CommandRunner
): Promise<FetchedContent> {
  const args = [
    "docs",
    "+fetch",
    "--api-version",
    "v2",
    "--doc",
    docToken,
    "--doc-format",
    docFormat,
    ...(docFormat === "xml" ? ["--detail", "full"] : []),
    "--as",
    "user",
    "--format",
    "json"
  ];
  const result = await run("lark-cli", args);
  if (result.code !== 0) {
    throw new Error(`lark-cli docs fetch failed for ${docToken} (${docFormat})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  return toFetchedContent(extractJson(result.stdout));
}

function toFetchedContent(value: unknown): FetchedContent {
  const root = value as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;
  const document = (data.document ?? data) as Record<string, unknown>;
  return {
    content: stringValue(document.content),
    ...(document.revision_id || document.revisionId
      ? { revisionId: stringValue(document.revision_id ?? document.revisionId) }
      : {})
  };
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1]] = decodeXmlText(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function firstAttribute(attributes: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    if (attributes[name]) {
      return attributes[name];
    }
  }
  return undefined;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_match, codepoint: string) => String.fromCodePoint(Number.parseInt(codepoint, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, codepoint: string) => String.fromCodePoint(Number.parseInt(codepoint, 16)));
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}
