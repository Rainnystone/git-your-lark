import type { PullRemoteDocument, PullRemoteIndex } from "./pull-types.js";
import { splitMarkdownLines } from "./fs-utils.js";

export interface PullLinkTarget {
  stem: string;
  localPath: string;
  wikiTarget?: string;
}

export interface PullMediaPlan {
  kind: "image" | "file";
  name: string;
  alt: string;
  sourceToken?: string;
  sourceHref?: string;
  localPath: string;
}

export interface RenderPullMarkdownInput {
  markdown: string;
  remote: PullRemoteDocument;
  plannedPath: string;
  index: Map<string, PullLinkTarget>;
  mediaPlans: PullMediaPlan[];
  pulledAt?: string | Date;
}

export interface RenderPullMarkdownResult {
  markdown: string;
}

export interface RenderPullIndexMarkdownInput {
  remote: PullRemoteIndex;
  plannedPath: string;
  index: Map<string, PullLinkTarget>;
  pulledAt?: string | Date;
}

interface Fence {
  marker: "`" | "~";
  length: number;
}

interface MarkdownLink {
  image: boolean;
  label: string;
  destination: string;
  raw: string;
  end: number;
}

export function renderPullMarkdown(input: RenderPullMarkdownInput): RenderPullMarkdownResult {
  const body = ensureTitleHeading(
    transformMarkdownOutsideCode(convertTitleTag(input.markdown), (text) =>
      convertLarkReferences(rewriteMediaReferences(text, input.mediaPlans), input.index)
    ).trimEnd(),
    input.remote.title
  );

  return {
    markdown: `${renderFrontmatter(input.remote, input.pulledAt)}\n\n${body}\n`
  };
}

export function renderPullIndexMarkdown(input: RenderPullIndexMarkdownInput): string {
  const childLinks = input.remote.childDocTokens
    .map((token) => input.index.get(token))
    .filter((target): target is PullLinkTarget => Boolean(target))
    .map((target) => `- ${toWikiLink(target)}`);
  const body = [`# ${input.remote.title}`, "", ...childLinks].join("\n").trimEnd();

  return `${renderFrontmatter(input.remote, input.pulledAt)}\n\n${body}\n`;
}

export function cleanMarkdownFilename(title: string): string {
  const cleaned = title.replace(/[\/\\:*?"<>|]/g, "_").trim().replace(/[. ]+$/g, "");
  return cleaned || "untitled";
}

function renderFrontmatter(
  remote: Pick<PullRemoteDocument, "docToken" | "title" | "wikiNodeToken" | "sourceUrl">,
  pulledAt: string | Date | undefined
): string {
  return [
    "---",
    "gyl:",
    "  source: lark",
    `  token: ${yamlValue(remote.docToken)}`,
    ...(remote.wikiNodeToken ? [`  wiki_node_token: ${yamlValue(remote.wikiNodeToken)}`] : []),
    ...(remote.sourceUrl ? [`  url: ${yamlValue(remote.sourceUrl)}`] : []),
    `  title: ${yamlValue(remote.title)}`,
    `  pulled_at: ${yamlValue(toIsoString(pulledAt))}`,
    "---"
  ].join("\n");
}

function convertTitleTag(markdown: string): string {
  return markdown.replace(/^\s*<title\b[^>]*>([\s\S]*?)<\/title>\s*/i, (_match, title: string) => {
    return `# ${decodeXmlText(stripTags(title).trim())}\n\n`;
  });
}

function rewriteMediaReferences(source: string, mediaPlans: PullMediaPlan[]): string {
  let result = replaceSourceTags(source, mediaPlans);
  result = replaceMarkdownImages(result, mediaPlans);
  return result;
}

function replaceSourceTags(source: string, mediaPlans: PullMediaPlan[]): string {
  return source.replace(/<figure>\s*(<source\b[^>]*>)\s*<\/figure>|<source\b[^>]*>/gi, (match, nestedSource: string | undefined) => {
    const sourceTag = nestedSource || match;
    const attributes = parseAttributes(sourceTag);
    const plan = findMediaPlan(mediaPlans, {
      kind: "file",
      token: firstAttribute(attributes, mediaTokenAttributeNames),
      href: firstAttribute(attributes, mediaUrlAttributeNames),
      name: attributes.name
    });
    if (plan) {
      return `[附件](${plan.localPath})`;
    }
    return `[附件未下载: ${attributes.name || "attachment"}]`;
  });
}

function replaceMarkdownImages(source: string, mediaPlans: PullMediaPlan[]): string {
  let result = "";
  for (let index = 0; index < source.length; index += 1) {
    const link = parseMarkdownLinkAt(source, index);
    if (!link) {
      result += source[index];
      continue;
    }

    if (!link.image) {
      result += link.raw;
      index = link.end;
      continue;
    }

    const href = stripMarkdownDestinationTitle(link.destination);
    const plan = findMediaPlan(mediaPlans, {
      kind: "image",
      token: tokenFromUrl(href),
      href,
      name: undefined
    });
    result += plan ? `![${link.label}](${plan.localPath})` : link.raw;
    index = link.end;
  }
  return result;
}

function convertLarkReferences(source: string, targets: Map<string, PullLinkTarget>): string {
  let result = replaceCiteTags(source, targets);
  result = replaceLarkMarkdownLinks(result, targets);
  return result;
}

function replaceCiteTags(source: string, targets: Map<string, PullLinkTarget>): string {
  return source.replace(/<cite\b[^>]*(?:\/>|\s*>\s*<\/cite>)/gi, (match) => {
    const attributes = parseAttributes(match);
    const docId = attributes["doc-id"] || attributes.docId;
    const target = attributes.type === "doc" && docId ? targets.get(docId) : undefined;
    return target ? toWikiLink(target) : match;
  });
}

function replaceLarkMarkdownLinks(source: string, targets: Map<string, PullLinkTarget>): string {
  let result = "";
  let plainText = "";
  for (let index = 0; index < source.length; index += 1) {
    const link = parseMarkdownLinkAt(source, index);
    if (!link) {
      plainText += source[index];
      continue;
    }

    result += replaceBareLarkUrls(plainText, targets);
    plainText = "";

    if (link.image) {
      result += link.raw;
      index = link.end;
      continue;
    }

    const token = larkTokenFromMarkdownDestination(link.destination);
    const target = token ? targets.get(token) : undefined;
    result += target ? toWikiLink(target) : link.raw;
    index = link.end;
  }
  result += replaceBareLarkUrls(plainText, targets);
  return result;
}

function replaceBareLarkUrls(source: string, targets: Map<string, PullLinkTarget>): string {
  return source.replace(/https?:\/\/[^\s<>()\[\]]+/g, (rawUrl) => {
    const { url, suffix } = splitTrailingUrlPunctuation(rawUrl);
    const token = isLarkDocumentUrl(url) ? tokenFromUrl(url) : undefined;
    const target = token ? targets.get(token) : undefined;
    return target ? `${toWikiLink(target)}${suffix}` : rawUrl;
  });
}

function splitTrailingUrlPunctuation(rawUrl: string): { url: string; suffix: string } {
  const url = rawUrl.replace(/[.,;:!?]+$/g, "");
  return { url, suffix: rawUrl.slice(url.length) };
}

function transformMarkdownOutsideCode(markdown: string, transformText: (text: string) => string): string {
  let fence: Fence | undefined;
  let result = "";

  for (const line of splitMarkdownLines(markdown)) {
    if (fence) {
      result += line;
      if (isClosingFence(line, fence)) {
        fence = undefined;
      }
      continue;
    }

    const openingFence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    if (openingFence) {
      const markerRun = openingFence[1];
      fence = { marker: markerRun[0] as "`" | "~", length: markerRun.length };
      result += line;
      continue;
    }

    if (/^(?: {4}|\t)/.test(line)) {
      result += line;
      continue;
    }

    result += renderInlineCodeAware(line, transformText);
  }

  return result;
}

function renderInlineCodeAware(source: string, renderText: (text: string) => string): string {
  let result = "";
  let index = 0;

  while (index < source.length) {
    const codeStart = source.indexOf("`", index);
    if (codeStart === -1) {
      result += renderText(source.slice(index));
      break;
    }

    result += renderText(source.slice(index, codeStart));
    const markerEnd = findBacktickRunEnd(source, codeStart);
    const marker = source.slice(codeStart, markerEnd);
    const codeEnd = source.indexOf(marker, markerEnd);
    if (codeEnd === -1) {
      result += renderText(source.slice(codeStart));
      break;
    }

    result += source.slice(codeStart, codeEnd + marker.length);
    index = codeEnd + marker.length;
  }

  return result;
}

function ensureTitleHeading(markdown: string, title: string): string {
  const firstLine = markdown.split(/\r?\n/).find((line) => line.trim() !== "");
  if (firstLine?.match(/^#\s+\S/)) {
    return markdown;
  }
  return [`# ${title}`, "", markdown].join("\n").trimEnd();
}

function findMediaPlan(
  plans: PullMediaPlan[],
  source: { kind: PullMediaPlan["kind"]; token?: string; href?: string; name?: string }
): PullMediaPlan | undefined {
  return (
    plans.find((plan) => plan.kind === source.kind && Boolean(source.token) && plan.sourceToken === source.token) ??
    plans.find((plan) => plan.kind === source.kind && Boolean(source.href) && plan.sourceHref === source.href) ??
    plans.find((plan) => plan.kind === source.kind && Boolean(source.name) && plan.name === source.name)
  );
}

function parseMarkdownLinkAt(source: string, index: number): MarkdownLink | undefined {
  const image = source[index] === "!" && source[index + 1] === "[";
  const link = source[index] === "[";
  if (!image && !link) {
    return undefined;
  }

  const labelStart = image ? index + 1 : index;
  const labelEnd = findClosingBracket(source, labelStart + 1);
  if (labelEnd === -1 || source[labelEnd + 1] !== "(") {
    return undefined;
  }

  const destinationStart = labelEnd + 2;
  const destinationEnd = findDestinationEnd(source, destinationStart);
  if (destinationEnd === -1) {
    return undefined;
  }

  return {
    image,
    label: source.slice(labelStart + 1, labelEnd),
    destination: source.slice(destinationStart, destinationEnd),
    raw: source.slice(index, destinationEnd + 1),
    end: destinationEnd
  };
}

function larkTokenFromMarkdownDestination(destination: string): string | undefined {
  const href = stripMarkdownDestinationTitle(destination);
  if (!/^https?:\/\//i.test(href) || !isLarkDocumentUrl(href)) {
    return undefined;
  }
  return tokenFromUrl(href);
}

function isLarkDocumentUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return hostname.endsWith(".feishu.cn") || hostname.endsWith(".larksuite.com");
  } catch {
    return false;
  }
}

function tokenFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const tokenQuery = url.searchParams.get("token");
    if (tokenQuery) {
      return tokenQuery;
    }
    return url.pathname.split("/").filter(Boolean).at(-1);
  } catch {
    return undefined;
  }
}

function stripMarkdownDestinationTitle(destination: string): string {
  const trimmed = destination.trim();
  const withoutAngle = trimmed.startsWith("<") && trimmed.includes(">") ? trimmed.slice(1, trimmed.indexOf(">")) : trimmed;
  const quotedTitle = withoutAngle.match(/^(.+?)\s+(?:"[^"]*"|'[^']*')\s*$/);
  if (quotedTitle) {
    return quotedTitle[1];
  }
  const parenthesizedTitle = withoutAngle.match(/^(.+?)\s+\([^()]*\)\s*$/);
  if (parenthesizedTitle) {
    return parenthesizedTitle[1];
  }
  return withoutAngle;
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1]] = decodeXmlText(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

const mediaTokenAttributeNames = ["token", "src", "image_token", "file_token", "media_token"];
const mediaUrlAttributeNames = ["url", "href", "image_url", "file_url", "media_url"];

function firstAttribute(attributes: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    if (attributes[name]) {
      return attributes[name];
    }
  }
  return undefined;
}

function isClosingFence(line: string, fence: Fence): boolean {
  const marker = fence.marker === "`" ? "`" : "~";
  return new RegExp(`^[ \\t]{0,3}${marker}{${fence.length},}[ \\t]*(?:\\n)?$`).test(line);
}

function findClosingBracket(source: string, start: number): number {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "\n") {
      return -1;
    }
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === "]") {
      return index;
    }
  }
  return -1;
}

function findDestinationEnd(source: string, start: number): number {
  let depth = 0;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\n") {
      return -1;
    }
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      if (depth === 0) {
        return index;
      }
      depth -= 1;
    }
  }

  return -1;
}

function findBacktickRunEnd(source: string, start: number): number {
  let index = start;
  while (source[index] === "`") {
    index += 1;
  }
  return index;
}

function toWikiLink(target: PullLinkTarget): string {
  if (target.wikiTarget && target.wikiTarget !== target.stem) {
    return `[[${target.wikiTarget}|${target.stem}]]`;
  }
  return `[[${target.stem}]]`;
}

function toIsoString(value: string | Date | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date().toISOString();
}

function yamlValue(value: string): string {
  return JSON.stringify(value);
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
