import { posix } from "node:path";

export interface ReferenceTarget {
  token: string;
  url: string;
}

export interface RenderInput {
  markdown: string;
  sourcePath: string;
  referenceMap: Record<string, ReferenceTarget>;
  mode: "lark-doc-cite" | "url-link";
}

export interface RenderResult {
  content: string;
  unresolved: string[];
}

export function renderMarkdownForLark(input: RenderInput): RenderResult {
  const unresolved: string[] = [];
  const unresolvedSeen = new Set<string>();

  const addUnresolved = (target: string): void => {
    if (!unresolvedSeen.has(target)) {
      unresolvedSeen.add(target);
      unresolved.push(target);
    }
  };

  const renderReference = (target: ReferenceTarget, label: string): string => {
    if (input.mode === "lark-doc-cite") {
      return `<cite type="doc" doc-id="${escapeHtmlAttribute(target.token)}"></cite>`;
    }
    return `[${label}](${target.url})`;
  };

  const renderText = (source: string): string =>
    renderInlineCodeAware(source, (text) => renderReferenceText(text, input, renderReference, addUnresolved));

  let fence: Fence | undefined;
  let content = "";
  for (const line of splitLines(input.markdown)) {
    if (fence) {
      content += line;
      if (isClosingFence(line, fence)) {
        fence = undefined;
      }
      continue;
    }

    const openingFence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    if (openingFence) {
      const markerRun = openingFence[1];
      fence = { marker: markerRun[0] as "`" | "~", length: markerRun.length };
      content += line;
      continue;
    }

    if (/^(?: {4}|\t)/.test(line)) {
      content += line;
      continue;
    }

    content += renderText(line);
  }

  return { content, unresolved };
}

type RenderResolvedReference = (target: ReferenceTarget, label: string) => string;
type AddUnresolvedReference = (target: string) => void;

interface Fence {
  marker: "`" | "~";
  length: number;
}

interface WikiLink {
  target: string;
  label: string;
  raw: string;
}

interface MarkdownLink {
  image: boolean;
  label: string;
  destination: string;
  raw: string;
  end: number;
}

function renderReferenceText(
  source: string,
  input: RenderInput,
  renderResolvedReference: RenderResolvedReference,
  addUnresolved: AddUnresolvedReference
): string {
  let result = "";
  for (let index = 0; index < source.length; index += 1) {
    const wikiLink = parseWikiLinkAt(source, index);
    if (wikiLink) {
      const resolved = resolveWikiReference(wikiLink.target, input.sourcePath, input.referenceMap);
      if (resolved) {
        result += renderResolvedReference(resolved, wikiLink.label);
      } else {
        addUnresolved(wikiLink.target);
        result += wikiLink.raw;
      }
      index += wikiLink.raw.length - 1;
      continue;
    }

    const markdownLink = parseMarkdownLinkAt(source, index);
    if (markdownLink) {
      const markdownTarget = normalizeMarkdownTarget(markdownLink.destination);
      if (!markdownLink.image && markdownTarget?.toLowerCase().endsWith(".md")) {
        const normalizedTarget = normalizeMarkdownReferencePath(markdownTarget, input.sourcePath);
        const resolved = resolveMarkdownReference(normalizedTarget, input.referenceMap);
        if (resolved) {
          result += renderResolvedReference(resolved, markdownLink.label);
        } else {
          addUnresolved(normalizedTarget);
          result += markdownLink.raw;
        }
      } else {
        result += markdownLink.raw;
      }
      index = markdownLink.end;
      continue;
    }

    result += source[index];
  }
  return result;
}

function parseWikiLinkAt(source: string, index: number): WikiLink | undefined {
  if (source[index] !== "[" || source[index + 1] !== "[" || source[index - 1] === "!") {
    return undefined;
  }

  const end = source.indexOf("]]", index + 2);
  if (end === -1) {
    return undefined;
  }

  const value = source.slice(index + 2, end);
  if (value.includes("\n")) {
    return undefined;
  }

  const separator = value.indexOf("|");
  const targetWithAnchor = (separator === -1 ? value : value.slice(0, separator)).trim();
  const target = targetWithAnchor.split("#", 1)[0].trim();
  if (!target) {
    return undefined;
  }

  const alias = separator === -1 ? undefined : value.slice(separator + 1).trim();
  return {
    target,
    label: isSimpleMarkdownLabel(alias) ? alias : target,
    raw: source.slice(index, end + 2)
  };
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

function resolveWikiReference(
  target: string,
  sourcePath: string,
  referenceMap: Record<string, ReferenceTarget>
): ReferenceTarget | undefined {
  return firstMappedReference(wikiReferenceCandidates(target, sourcePath), referenceMap);
}

function resolveMarkdownReference(
  resolvedPath: string,
  referenceMap: Record<string, ReferenceTarget>
): ReferenceTarget | undefined {
  return firstMappedReference([resolvedPath, stripMarkdownExtension(resolvedPath)], referenceMap);
}

function normalizeMarkdownReferencePath(target: string, sourcePath: string): string {
  if (target.startsWith("/")) {
    return normalizePath(target.slice(1));
  }
  return normalizePath(posix.join(posix.dirname(sourcePath), target));
}

function wikiReferenceCandidates(target: string, sourcePath: string): string[] {
  const relativeTarget = normalizePath(posix.join(posix.dirname(sourcePath), target));
  return unique([
    target,
    stripMarkdownExtension(target),
    relativeTarget,
    stripMarkdownExtension(relativeTarget),
    stripMarkdownExtension(target.split("/").at(-1) ?? target)
  ]);
}

function firstMappedReference(
  candidates: string[],
  referenceMap: Record<string, ReferenceTarget>
): ReferenceTarget | undefined {
  for (const candidate of candidates) {
    const target = referenceMap[candidate];
    if (target) {
      return target;
    }
  }
  return undefined;
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

function normalizeMarkdownTarget(value: string): string | undefined {
  const trimmed = value.trim();
  const withoutTitle = trimmed.startsWith("<") && trimmed.includes(">") ? trimmed.slice(1, trimmed.indexOf(">")) : trimmed;
  const target = stripMarkdownTitle(withoutTitle).split("#", 1)[0].trim();
  return isLocalTarget(target) ? target : undefined;
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

function isLocalTarget(target: string): boolean {
  return Boolean(target) && !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("#");
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

function isClosingFence(line: string, fence: Fence): boolean {
  const marker = fence.marker === "`" ? "`" : "~";
  return new RegExp(`^[ \\t]{0,3}${marker}{${fence.length},}[ \\t]*(?:\\n)?$`).test(line);
}

function splitLines(markdown: string): string[] {
  const lines = markdown.match(/[^\n]*(?:\n|$)/g) ?? [];
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function findBacktickRunEnd(source: string, start: number): number {
  let index = start;
  while (source[index] === "`") {
    index += 1;
  }
  return index;
}

function isSimpleMarkdownLabel(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  return !/[\n\[\]]/.test(value);
}

function stripMarkdownExtension(path: string): string {
  return path.toLowerCase().endsWith(".md") ? path.slice(0, -3) : path;
}

function normalizePath(path: string): string {
  return posix.normalize(path).replace(/^\.\//, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
