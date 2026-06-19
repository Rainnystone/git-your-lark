export interface MarkdownReference {
  target: string;
  raw: string;
}

export interface MarkdownAttachment {
  target: string;
  raw: string;
}

export function stripCodeForParsing(markdown: string): string {
  return stripInlineCode(stripFencedCode(stripIndentedCode(markdown)));
}

export function parseMarkdownReferences(markdown: string): MarkdownReference[] {
  const source = stripCodeForParsing(markdown);
  const references: MarkdownReference[] = [];

  for (const match of source.matchAll(/(?<!!)\[\[([^\]\n]+)\]\]/g)) {
    const target = normalizeWikiTarget(match[1]);
    if (target) {
      references.push({ target, raw: match[0] });
    }
  }

  for (const link of scanInlineLinks(source)) {
    if (link.image) {
      continue;
    }
    const target = normalizeMarkdownTarget(link.destination);
    if (target?.toLowerCase().endsWith(".md")) {
      references.push({ target, raw: link.raw });
    }
  }

  return references;
}

export function parseMarkdownAttachments(markdown: string): MarkdownAttachment[] {
  const source = stripCodeForParsing(markdown);
  const attachments: MarkdownAttachment[] = [];

  for (const link of scanInlineLinks(source)) {
    if (!link.image) {
      continue;
    }
    const target = normalizeMarkdownTarget(link.destination);
    if (target && isLocalTarget(target)) {
      attachments.push({ target, raw: link.raw });
    }
  }

  for (const match of source.matchAll(/!\[\[([^\]\n]+)\]\]/g)) {
    const target = normalizeWikiTarget(match[1]);
    if (target && isLocalTarget(target)) {
      attachments.push({ target, raw: match[0] });
    }
  }

  return attachments;
}

function normalizeWikiTarget(value: string): string {
  return value.split("|", 1)[0].split("#", 1)[0].trim();
}

function normalizeMarkdownTarget(value: string): string | undefined {
  const trimmed = value.trim();
  const withoutTitle = trimmed.startsWith("<") && trimmed.includes(">") ? trimmed.slice(1, trimmed.indexOf(">")) : trimmed;
  const target = stripMarkdownTitle(withoutTitle).split("#", 1)[0].trim();
  return isLocalTarget(target) ? target : undefined;
}

function isLocalTarget(target: string): boolean {
  return Boolean(target) && !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("#");
}

function stripFencedCode(markdown: string): string {
  const lines = markdown.match(/[^\n]*(?:\n|$)/g) ?? [];
  let fence: { marker: "`" | "~"; length: number } | undefined;
  let result = "";

  for (const line of lines) {
    if (line === "") {
      continue;
    }

    if (fence) {
      result += " ".repeat(line.length);
      if (isClosingFence(line, fence)) {
        fence = undefined;
      }
      continue;
    }

    const openingFence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    if (openingFence) {
      const markerRun = openingFence[1];
      fence = { marker: markerRun[0] as "`" | "~", length: markerRun.length };
      result += " ".repeat(line.length);
      continue;
    }

    result += line;
  }

  return result;
}

function isClosingFence(line: string, fence: { marker: "`" | "~"; length: number }): boolean {
  const escapedMarker = fence.marker === "`" ? "`" : "~";
  const match = line.match(new RegExp(`^[ \\t]{0,3}(${escapedMarker}{${fence.length},})[ \\t]*(?:\\n|$)`));
  return Boolean(match);
}

function stripInlineCode(markdown: string): string {
  return markdown.replace(/`[^`\n]*`/g, (match) => " ".repeat(match.length));
}

function stripIndentedCode(markdown: string): string {
  return markdown.replace(/^(?: {4}|\t).*(?:\n|$)/gm, (match) => " ".repeat(match.length));
}

function stripMarkdownTitle(destination: string): string {
  const quotedTitle = destination.match(/^(.+\.[^\s.]+)\s+(?:"[^"]*"|'[^']*')\s*$/);
  if (quotedTitle) {
    return quotedTitle[1];
  }

  const parenthesizedTitle = destination.match(/^(.+\.[^\s.]+)\s+\([^()]*\)\s*$/);
  if (parenthesizedTitle) {
    return parenthesizedTitle[1];
  }

  return destination;
}

interface InlineLink {
  image: boolean;
  destination: string;
  raw: string;
}

function scanInlineLinks(source: string): InlineLink[] {
  const links: InlineLink[] = [];

  for (let index = 0; index < source.length; index += 1) {
    const image = source[index] === "!" && source[index + 1] === "[";
    const link = source[index] === "[";
    if (!image && !link) {
      continue;
    }

    const labelStart = image ? index + 1 : index;
    const labelEnd = source.indexOf("]", labelStart + 1);
    if (labelEnd === -1 || source[labelEnd + 1] !== "(") {
      continue;
    }

    const destinationStart = labelEnd + 2;
    const destinationEnd = findDestinationEnd(source, destinationStart);
    if (destinationEnd === -1) {
      continue;
    }

    links.push({
      image,
      destination: source.slice(destinationStart, destinationEnd),
      raw: source.slice(index, destinationEnd + 1)
    });
    index = destinationEnd;
  }

  return links;
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
