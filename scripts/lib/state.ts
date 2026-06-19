export interface RemoteDocumentState {
  path: string;
  title: string;
  token: string;
  url: string;
  remoteRevision?: string;
  remoteModifiedTime?: string;
  localHash: string;
}

export interface AttachmentState {
  localPath: string;
  remoteToken: string;
  remoteUrl?: string;
  hash: string;
}

export interface GitYourLarkState {
  version: 1;
  remoteFolderToken: string;
  remoteFolderUrl?: string;
  documents: Record<string, RemoteDocumentState>;
  attachments: Record<string, AttachmentState>;
  lastAppliedProposalId?: string;
}

export function emptyState(remoteFolderToken: string, remoteFolderUrl?: string): GitYourLarkState {
  return {
    version: 1,
    remoteFolderToken,
    ...(remoteFolderUrl ? { remoteFolderUrl } : {}),
    documents: {},
    attachments: {}
  };
}
