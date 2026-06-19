import { extractJson, runCommand, type CommandResult } from "./lark-cli.js";

export interface RemoteEntry {
  name: string;
  token: string;
  type: string;
  url?: string;
  modifiedTime?: string;
}

export interface RemoteManifest {
  folderToken: string;
  entries: RemoteEntry[];
}

type CommandRunner = (command: string, args: string[], cwd?: string) => Promise<CommandResult>;

interface LarkListPage {
  files?: unknown[];
  items?: unknown[];
  has_more?: boolean;
  next_page_token?: string;
}

export async function scanRemoteFolder(folderToken: string, run: CommandRunner = runCommand): Promise<RemoteManifest> {
  const entries: RemoteEntry[] = [];
  let pageToken: string | undefined;

  do {
    const params = {
      folder_token: folderToken,
      page_size: 200,
      ...(pageToken ? { page_token: pageToken } : {})
    };
    const result = await run("lark-cli", [
      "drive",
      "files",
      "list",
      "--as",
      "user",
      "--params",
      JSON.stringify(params),
      "--format",
      "json"
    ]);

    if (result.code !== 0) {
      throw new Error(`lark-cli remote scan failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }

    const page = extractListPage(extractJson(result.stdout));
    entries.push(...(page.files ?? page.items ?? []).map(toRemoteEntry));
    if (page.has_more) {
      if (!page.next_page_token?.trim()) {
        throw new Error("lark-cli remote scan failed: missing next_page_token while has_more is true.");
      }
      pageToken = page.next_page_token;
    } else {
      pageToken = undefined;
    }
  } while (pageToken);

  return {
    folderToken,
    entries
  };
}

function extractListPage(value: unknown): LarkListPage {
  const root = value as Record<string, unknown>;
  return (root.data ?? root) as LarkListPage;
}

function toRemoteEntry(value: unknown): RemoteEntry {
  const item = value as Record<string, unknown>;
  return {
    name: String(item.name ?? ""),
    token: String(item.token ?? ""),
    type: String(item.type ?? ""),
    ...(item.url ? { url: String(item.url) } : {}),
    ...(item.modified_time ? { modifiedTime: String(item.modified_time) } : {})
  };
}
