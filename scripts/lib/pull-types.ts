export type PullSourceType = "doc" | "folder" | "wiki_node";
export type PullDocumentSourceKind = "doc" | "folder" | "wiki_node";

export interface PullRemoteDocument {
  sourceKind: PullDocumentSourceKind;
  title: string;
  docToken: string;
  wikiNodeToken?: string;
  sourceUrl?: string;
  remotePath: string;
  modifiedTime?: string;
}

export interface PullRemoteIndex {
  title: string;
  docToken: string;
  wikiNodeToken?: string;
  sourceUrl?: string;
  remotePath: string;
  childDocTokens: string[];
}

export interface PullScanWarning {
  message: string;
  title?: string;
  type?: string;
  token?: string;
  url?: string;
  remotePath?: string;
}

export interface PullScanResult {
  source: {
    type: PullSourceType;
    tokenOrUrl: string;
    title?: string;
  };
  documents: PullRemoteDocument[];
  indexes: PullRemoteIndex[];
  warnings: PullScanWarning[];
}
