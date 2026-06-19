import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import fg from "fast-glob";
import { sha256Buffer, sha256Text } from "./hash.js";
import { parseMarkdownAttachments, parseMarkdownReferences, type MarkdownReference } from "./markdown-links.js";

export interface LocalScanInput {
  workspaceRoot: string;
  include: string[];
  exclude: string[];
}

export interface LocalDocument {
  path: string;
  title: string;
  hash: string;
  references: MarkdownReference[];
}

export interface LocalAttachment {
  path: string;
  hash: string;
  owner: string;
}

export interface LocalManifest {
  workspaceRoot: string;
  documents: LocalDocument[];
  attachments: LocalAttachment[];
}

export async function scanLocalWorkspace(input: LocalScanInput): Promise<LocalManifest> {
  const workspaceRoot = resolve(input.workspaceRoot);
  const documentPaths = await fg(input.include, {
    cwd: workspaceRoot,
    ignore: input.exclude,
    onlyFiles: true,
    dot: true
  });
  documentPaths.sort();

  const documents: LocalDocument[] = [];
  const attachments = new Map<string, LocalAttachment>();

  for (const documentPath of documentPaths) {
    const normalizedDocumentPath = normalizePath(documentPath);
    const absoluteDocumentPath = join(workspaceRoot, normalizedDocumentPath);
    const content = await readFile(absoluteDocumentPath, "utf8");
    const references = parseMarkdownReferences(content);

    documents.push({
      path: normalizedDocumentPath,
      title: stem(normalizedDocumentPath),
      hash: sha256Text(content),
      references
    });

    for (const attachment of parseMarkdownAttachments(content)) {
      const attachmentPath = normalizePath(relative(workspaceRoot, resolve(dirname(absoluteDocumentPath), attachment.target)));
      if (!attachments.has(attachmentPath)) {
        attachments.set(attachmentPath, {
          path: attachmentPath,
          hash: await hashAttachment(join(workspaceRoot, attachmentPath)),
          owner: normalizedDocumentPath
        });
      }
    }
  }

  return {
    workspaceRoot,
    documents,
    attachments: [...attachments.values()]
  };
}

async function hashAttachment(path: string): Promise<string> {
  try {
    return sha256Buffer(await readFile(path));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "missing";
    }
    throw error;
  }
}

function stem(path: string): string {
  const filename = path.split("/").at(-1) ?? path;
  return filename.replace(/\.[^.]+$/, "");
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}
