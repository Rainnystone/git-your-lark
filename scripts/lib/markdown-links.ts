export interface MarkdownReference {
  target: string;
  raw: string;
}

export interface MarkdownAttachment {
  target: string;
  raw: string;
}

export function stripCodeForParsing(markdown: string): string {
  return markdown
    .replace(/(^|\n)(`{3,}|~{3,})[\s\S]*?(?:\n\2[^\n]*(?=\n|$)|$)/g, (match) => " ".repeat(match.length))
    .replace(/`[^`\n]*`/g, (match) => " ".repeat(match.length));
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

  for (const match of source.matchAll(/(?<!!)\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const target = normalizeMarkdownTarget(match[1]);
    if (target?.toLowerCase().endsWith(".md")) {
      references.push({ target, raw: match[0] });
    }
  }

  return references;
}

export function parseMarkdownAttachments(markdown: string): MarkdownAttachment[] {
  const source = stripCodeForParsing(markdown);
  const attachments: MarkdownAttachment[] = [];

  for (const match of source.matchAll(/!\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const target = normalizeMarkdownTarget(match[1]);
    if (target && isLocalTarget(target)) {
      attachments.push({ target, raw: match[0] });
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
  const withoutTitle = trimmed.startsWith("<") ? trimmed.slice(1, trimmed.indexOf(">")) : trimmed.split(/\s+/, 1)[0];
  const target = withoutTitle.split("#", 1)[0].trim();
  return isLocalTarget(target) ? target : undefined;
}

function isLocalTarget(target: string): boolean {
  return Boolean(target) && !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("#");
}
