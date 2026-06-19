import type { LocalAttachment, LocalDocument, LocalManifest } from "./local-scan.js";
import type { RemoteEntry, RemoteManifest } from "./remote-scan.js";
import type { GitYourLarkState, RemoteDocumentState } from "./state.js";

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
  const remoteByToken = new Map(input.remote.entries.map((entry) => [entry.token, entry]));
  const remoteByName = new Map(input.remote.entries.map((entry) => [entry.name, entry]));
  const actions: ProposalAction[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const document of input.local.documents) {
    for (const reference of document.references) {
      if (!localTargets.has(reference.target)) {
        blockers.push(`Unresolved reference in ${document.path}: ${reference.target}`);
      }
    }

    const documentState = input.state.documents[document.path];
    const remoteEntry = findRemoteDocument(document, documentState, remoteByToken, remoteByName);

    if (!remoteEntry) {
      actions.push({
        kind: "create-document",
        path: document.path,
        title: document.title,
        hash: document.hash
      });
      continue;
    }

    if (documentState && documentState.localHash !== document.hash) {
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
      warnings.push(`Remote-only document left untouched: ${path}`);
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
  }
  return targets;
}

function findRemoteDocument(
  document: LocalDocument,
  documentState: RemoteDocumentState | undefined,
  remoteByToken: Map<string, RemoteEntry>,
  remoteByName: Map<string, RemoteEntry>
): RemoteEntry | undefined {
  if (documentState) {
    return remoteByToken.get(documentState.token);
  }
  return remoteByName.get(document.title) ?? remoteByName.get(document.stem) ?? remoteByName.get(stripMarkdownExtension(document.path));
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

function proposalId(createdAt: string): string {
  return `proposal-${createdAt.replace(/[:.]/g, "-")}`;
}
