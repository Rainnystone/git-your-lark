import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import fg from "fast-glob";
import { sha256Buffer, sha256Text } from "./hash.js";
import { parseMarkdownAttachments, parseMarkdownReferences, type MarkdownReference } from "./markdown-links.js";
import { WorkspacePaths } from "./workspace-paths.js";

export interface LocalScanInput {
  workspaceRoot: string;
  include: string[];
  exclude: string[];
  titleMode?: "stem" | "path";
}

export interface LocalDocument {
  path: string;
  title: string;
  stem: string;
  hash: string;
  references: MarkdownReference[];
  attachments: LocalAttachment[];
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
  const paths = await WorkspacePaths.create(workspaceRoot);
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
    const documentAttachments: LocalAttachment[] = [];

    for (const attachment of parseMarkdownAttachments(content)) {
      const absoluteAttachmentPath = resolve(dirname(absoluteDocumentPath), attachment.target);
      const attachmentPath = normalizePath(relative(workspaceRoot, absoluteAttachmentPath));
      const safeAttachment = await paths.safeWorkspacePathIfExists(attachmentPath);
      const attachmentHash = safeAttachment ? await hashAttachment(safeAttachment.absolutePath) : "missing";
      const localAttachment = {
        path: attachmentPath,
        hash: attachmentHash,
        owner: normalizedDocumentPath
      };
      documentAttachments.push(localAttachment);
      if (!attachments.has(attachmentPath)) {
        attachments.set(attachmentPath, localAttachment);
      }
    }

    const documentStem = stem(normalizedDocumentPath);
    documents.push({
      path: normalizedDocumentPath,
      title: titleForPath(normalizedDocumentPath, input.titleMode ?? "stem"),
      stem: documentStem,
      hash: sha256Text(content),
      references,
      attachments: documentAttachments
    });
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

function titleForPath(path: string, titleMode: NonNullable<LocalScanInput["titleMode"]>): string {
  if (titleMode === "path") {
    return stripExtension(path).split("/").join(" - ");
  }
  return stem(path);
}

function stripExtension(path: string): string {
  return path.replace(/\.[^.]+$/, "");
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}
