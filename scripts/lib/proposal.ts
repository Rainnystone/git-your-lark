import { posix } from "node:path";
import type { LocalDocument, LocalManifest } from "./local-scan.js";
import type { RemoteEntry, RemoteManifest } from "./remote-scan.js";
import type { GitYourLarkState } from "./state.js";

export type ProposalAction =
  | {
      kind: "create-document";
      path: string;
      title: string;
      hash: string;
    }
  | {
      kind: "patch-document";
      path: string;
      title: string;
      token: string;
      hash: string;
      baseRemoteModifiedTime?: string;
    }
  | {
      kind: "upload-attachment";
      path: string;
      hash: string;
      owner: string;
    };

export interface SyncProposal {
  id: string;
  createdAt: string;
  baseRemoteFolderToken: string;
  actions: ProposalAction[];
  blockers: string[];
  warnings: string[];
}

export interface BuildProposalInput {
  local: LocalManifest;
  remote: RemoteManifest;
  state: GitYourLarkState;
  now?: Date;
}

export function buildProposal(input: BuildProposalInput): SyncProposal {
  const createdAt = (input.now ?? new Date()).toISOString();
  const localTargets = buildLocalTargetIndex(input.local.documents);
  const remoteDocuments = input.remote.entries.filter(isRemoteDocument);
  const remoteByToken = new Map(remoteDocuments.map((entry) => [entry.token, entry]));
  const remoteByName = new Map(remoteDocuments.map((entry) => [entry.name, entry]));
  const consumedRemoteTokens = new Set<string>();
  const actions: ProposalAction[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const document of input.local.documents) {
    for (const reference of document.references) {
      if (!resolvesLocalReference(reference, document.path, localTargets)) {
        blockers.push(`Unresolved reference in ${document.path}: ${reference.target}`);
      }
    }

    const documentState = input.state.documents[document.path];
    if (documentState) {
      const remoteEntry = remoteByToken.get(documentState.token);
      if (!remoteEntry) {
        blockers.push(`State token missing from remote scan for ${document.path}: ${documentState.token}`);
        continue;
      }
      consumedRemoteTokens.add(remoteEntry.token);
      if (documentState.localHash !== document.hash) {
        actions.push({
          kind: "patch-document",
          path: document.path,
          title: document.title,
          token: documentState.token,
          hash: document.hash,
          ...(remoteEntry.modifiedTime ?? documentState.remoteModifiedTime
            ? { baseRemoteModifiedTime: remoteEntry.modifiedTime ?? documentState.remoteModifiedTime }
            : {})
        });
      }
      continue;
    }

    const unboundRemoteEntry = findRemoteDocumentByLocalTitle(document, remoteByName);
    if (unboundRemoteEntry) {
      consumedRemoteTokens.add(unboundRemoteEntry.token);
      blockers.push(`Remote document with title exists but is not bound in state: ${document.path} -> ${document.title}`);
      continue;
    }

    actions.push({
      kind: "create-document",
      path: document.path,
      title: document.title,
      hash: document.hash
    });
  }

  for (const attachment of input.local.attachments) {
    if (attachment.hash === "missing") {
      blockers.push(`Missing attachment: ${attachment.path}`);
      continue;
    }

    const attachmentState = input.state.attachments[attachment.path];
    if (!attachmentState || attachmentState.hash !== attachment.hash) {
      actions.push({
        kind: "upload-attachment",
        path: attachment.path,
        hash: attachment.hash,
        owner: attachment.owner
      });
    }
  }

  const localDocumentPaths = new Set(input.local.documents.map((document) => document.path));
  for (const [path, documentState] of Object.entries(input.state.documents)) {
    if (!localDocumentPaths.has(path) && remoteByToken.has(documentState.token)) {
      consumedRemoteTokens.add(documentState.token);
      warnings.push(`Remote-only document left untouched: ${path}`);
    }
  }

  for (const remoteDocument of remoteDocuments) {
    if (!consumedRemoteTokens.has(remoteDocument.token)) {
      warnings.push(`Unmanaged remote document left untouched: ${remoteDocument.name}`);
    }
  }

  return {
    id: proposalId(createdAt),
    createdAt,
    baseRemoteFolderToken: input.remote.folderToken || input.state.remoteFolderToken,
    actions,
    blockers,
    warnings
  };
}

export function renderProposalMarkdown(proposal: SyncProposal): string {
  return [
    `# Sync Proposal ${proposal.id}`,
    "",
    `Created: ${proposal.createdAt}`,
    `Base remote folder token: ${proposal.baseRemoteFolderToken}`,
    "",
    "## Actions",
    renderList(proposal.actions.map(renderAction)),
    "",
    "## Blockers",
    renderList(proposal.blockers),
    "",
    "## Warnings",
    renderList(proposal.warnings),
    ""
  ].join("\n");
}

function buildLocalTargetIndex(documents: LocalDocument[]): Set<string> {
  const targets = new Set<string>();
  for (const document of documents) {
    targets.add(document.path);
    targets.add(document.stem);
    targets.add(stripMarkdownExtension(document.path));
    targets.add(stripMarkdownExtension(document.path.split("/").at(-1) ?? document.path));
  }
  return targets;
}

function findRemoteDocumentByLocalTitle(
  document: LocalDocument,
  remoteByName: Map<string, RemoteEntry>
): RemoteEntry | undefined {
  return remoteByName.get(document.title) ?? remoteByName.get(document.stem) ?? remoteByName.get(stripMarkdownExtension(document.path));
}

function resolvesLocalReference(
  reference: LocalDocument["references"][number],
  ownerPath: string,
  localTargets: Set<string>
): boolean {
  if (isMarkdownLinkReference(reference.raw)) {
    return resolvesMarkdownRelativeReference(reference.target, ownerPath, localTargets);
  }

  return resolvesLooseLocalReference(reference.target, ownerPath, localTargets);
}

function resolvesMarkdownRelativeReference(target: string, ownerPath: string, localTargets: Set<string>): boolean {
  const relativeTarget = normalizePath(posix.join(posix.dirname(ownerPath), target));
  return localTargets.has(relativeTarget) || localTargets.has(stripMarkdownExtension(relativeTarget));
}

function resolvesLooseLocalReference(target: string, ownerPath: string, localTargets: Set<string>): boolean {
  if (localTargets.has(target)) {
    return true;
  }
  const relativeTarget = normalizePath(posix.join(posix.dirname(ownerPath), target));
  return localTargets.has(relativeTarget) || localTargets.has(stripMarkdownExtension(relativeTarget));
}

function isMarkdownLinkReference(raw: string): boolean {
  return !raw.startsWith("[[");
}

function renderAction(action: ProposalAction): string {
  if (action.kind === "create-document") {
    return `create-document ${action.path}`;
  }
  if (action.kind === "patch-document") {
    return `patch-document ${action.path}`;
  }
  return `upload-attachment ${action.path}`;
}

function renderList(items: string[]): string {
  if (items.length === 0) {
    return "- None";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function stripMarkdownExtension(path: string): string {
  return path.endsWith(".md") ? path.slice(0, -3) : path;
}

function normalizePath(path: string): string {
  return posix.normalize(path).replace(/^\.\//, "");
}

function isRemoteDocument(entry: RemoteEntry): boolean {
  return entry.type === "docx";
}

function proposalId(createdAt: string): string {
  return `proposal-${createdAt.replace(/[:.]/g, "-")}`;
}
