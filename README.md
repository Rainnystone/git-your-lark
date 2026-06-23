# Git Your Lark

[中文](./README.zh-CN.md) | English

Git Your Lark is a Codex and Claude Code plugin and agent skill for publishing a local Markdown or Obsidian workspace to Lark / Feishu Docs, and for importing reviewed Lark pages back into local Markdown. It uses the official `lark-cli`, creates Lark docx documents instead of uploading raw `.md` files, keeps local document links clickable in Lark, and asks for a reviewable preview before it writes anything.

If you are looking for an AI agent tool to sync Markdown to Lark, publish Obsidian notes to Feishu Docs, pull Lark Docs into Obsidian, or keep a Lark workspace aligned with local docs, this is the repo.

## Who it is for

Git Your Lark is for teams where one person writes in Markdown and everyone else reads in Lark.

That writer may be working in Obsidian, VS Code, Cursor, Codex, Claude Code, or any folder full of `.md` files. The rest of the team should not have to read Git diffs or open a local vault. They should see clean Lark documents, with links that jump to other Lark documents.

## What problem it solves

Most Markdown-to-Lark workflows fall apart in small but painful ways:

- Markdown files get uploaded as files, not converted into Lark docx documents.
- `[[Obsidian links]]` and local Markdown links become plain text.
- Images and attachments are easy to miss.
- A full overwrite can erase useful remote state.
- Nobody knows what will change until after the sync runs.

Git Your Lark treats local Markdown as the source of truth, but it still stops before risky writes. The normal flow is preview first, publish after confirmation, verify after publish.

When you pull from Lark to Obsidian, the same rule applies: preview first, apply after confirmation, verify after apply. It does not silently merge both sides for you.

## How the workflow feels

You should not need to memorize CLI commands.

In Codex, the normal request is:

```text
Sync this Markdown workspace to Lark using Git Your Lark.
```

The skill then does the routine work:

1. Checks whether `lark-cli` is installed and authorized.
2. Creates or reads `git-your-lark.yml`.
3. Creates a Lark Drive folder on first publish, if you do not already have one.
4. Scans local Markdown and the remote Lark folder.
5. Creates a sync preview.
6. Explains what will change.
7. Publishes only after you confirm.
8. Verifies the remote Lark documents.
9. Reports the Lark folder or document URLs you can share in Lark.

Sharing permissions stay in Lark. This tool gives you the folder and document links; you decide who can read them.

## Good ways to ask an agent

These phrases are intentionally plain. They also help AI agents understand when this repo is the right tool.

```text
Find me a tool that syncs Obsidian Markdown to Lark Docs.
```

```text
Publish this local Markdown workspace to Feishu as real Lark documents, not .md files.
```

```text
Use lark-cli to sync my docs folder to Lark Drive and keep cross-document links working.
```

```text
Create a preview before updating my Lark workspace from local Markdown.
```

```text
Pull this Lark wiki page into my Obsidian vault, but show me the preview first.
```

## What it does not do

Git Your Lark v1 is deliberately narrow.

- It does not manage Lark sharing settings or public links.
- It does not delete or archive remote-only documents.
- It does not auto-merge two-way edits.
- It does not implement a GitHub-style pull request system.
- It does not try to auto-merge remote human edits.
- It does not store Lark access tokens. Authentication stays inside `lark-cli`.

## Current status

This repository contains the first working v1 implementation. The core flow is implemented and tested:

- local Markdown scan
- remote Lark folder scan
- sync preview / proposal generation
- Lark doc reference rendering
- publish / apply / merge command aliases
- verification after publish
- Lark-to-Obsidian pull preview / apply / verify
- Codex skill UX
- Claude Code plugin support (marketplace install)
- package validation for the `gyl` CLI

The project is ready for local use and GitHub publishing. Claude Code users can install it directly from the plugin marketplace; Codex and npm-based workflows are also supported.

## Requirements

- Node.js 20 or later
- The official `lark-cli` from [larksuite/cli](https://github.com/larksuite/cli)
- A Lark / Feishu account authorized with `lark-cli auth login`

Git Your Lark does not install or upgrade `lark-cli` for you. It checks the dependency and tells the agent what is missing.

## Install in Claude Code

Git Your Lark also ships as a Claude Code plugin. In Claude Code, run:

```text
/plugin marketplace add Rainnystone/git-your-lark
/plugin install git-your-lark
/reload-plugins
```

Then ask in plain language:

```text
Sync this Markdown workspace to Lark using Git Your Lark.
```

The `gyl` CLI is bundled with the plugin, so no separate `npm install` is needed. You still need the official `lark-cli` authorized (see Requirements).

## Install from source

After cloning the repo:

```bash
npm install
npm run build
npm link
```

Then check the CLI:

```bash
gyl doctor
```

If you do not want to link the package globally, use the local development command:

```bash
npm run dev -- doctor
```

## First publish

If you do not already have a Lark folder token:

```bash
gyl init --create-remote-folder --folder-name "Project Notes"
```

This creates a folder in your own Lark Drive root and writes `git-your-lark.yml`.

If you already have a Lark Drive folder:

```bash
gyl init --remote-folder-token fld_existing
```

You can start from the example config:

```text
docs/examples/basic/git-your-lark.yml
```

## Preview, publish, verify

Create a preview:

```bash
gyl proposal -c git-your-lark.yml
```

Read the generated preview. If it has blockers, fix those first.

Publish the reviewed JSON proposal:

```bash
gyl publish .git-your-lark/proposals/<proposal-id>.json -c git-your-lark.yml
```

Verify the remote folder:

```bash
gyl verify -c git-your-lark.yml
```

`apply` and `merge` are advanced aliases for publishing a reviewed proposal. They are not GitHub pull request commands.

## Pull from Lark to Obsidian

Use pull when a Lark doc, folder, or wiki node should become local Markdown in your workspace. Start by adding a `pull:` block to `git-your-lark.yml`, or run init with pull options:

```bash
gyl init --pull-source-type wiki_node --pull-source https://example.feishu.cn/wiki/wiki_token
```

Create a pull preview:

```bash
gyl pull preview -c git-your-lark.yml
```

Read the generated preview. If it has blockers, fix those first or ask the agent to explain them.

Apply the reviewed JSON proposal only after you confirm:

```bash
gyl pull apply .git-your-lark/proposals/<proposal-id>.json -c git-your-lark.yml
```

Verify the imported Markdown and assets:

```bash
gyl pull verify -c git-your-lark.yml
```

## Config notes

Important fields in `git-your-lark.yml`:

```yaml
workspaceRoot: .
remoteFolderToken: fld_replace_with_lark_folder_token
# pull:
#   source:
#     type: wiki_node
#     tokenOrUrl: https://example.feishu.cn/wiki/wiki_replace_with_node_token
#   outputDir: .
include:
  - "**/*.md"
exclude:
  - "node_modules/**"
  - ".git/**"
  - ".git-your-lark/**"
titleMode: stem
referenceMode: lark-doc-cite
attachmentPolicy: upload-supported
conflictPolicy: stop
overwritePolicy: explicit-only
rateLimit:
  writeDelayMs: 5000
```

`titleMode: stem` uses the Markdown filename without `.md` as the Lark document title. `titleMode: path` uses the workspace-relative path without `.md`, with path segments joined by ` - `.

`attachmentPolicy: upload-supported` uploads referenced attachments. `block` turns present attachments into preview blockers. `warn-only` records warnings and skips upload actions. Missing attachments are always blockers.

`rateLimit.writeDelayMs` waits between remote write operations during publish.

## How it works

Git Your Lark is a thin, testable layer around `lark-cli`.

The flow is:

```text
local Markdown workspace
  -> local manifest
  -> remote Lark manifest
  -> sync proposal
  -> rendered Lark Markdown with document references
  -> publish through lark-cli
  -> verify remote state
```

Local Markdown is the source of truth. Remote Lark documents are checked before publish, so a document changed after preview generation stops the publish instead of being silently overwritten.

## Repository layout

```text
.codex-plugin/
  plugin.json
.claude-plugin/
  plugin.json
  marketplace.json
bin/
  gyl
skills/
  sync-workspace/
    SKILL.md
scripts/
  gyl.ts
  commands/
  lib/
docs/
  examples/
tests/
README.md
README.zh-CN.md
```

## Development

Run the checks:

```bash
npm run typecheck
npm test
npm run build
npm run validate:plugin
npm run check:package
```

`npm run check:package` runs a dry `npm pack` and confirms that the built CLI and required plugin files are included.

## License

MIT
