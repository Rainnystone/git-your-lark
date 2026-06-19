# Git Your Lark

Git Your Lark is a Codex plugin for publishing local Markdown workspaces to Lark/Feishu documents through the official `lark-cli`.

It is preview-first: scan local and remote state, generate a reviewable sync preview, then publish it only if the remote base has not changed.

## Requirements

- Node.js 20+
- `lark-cli` from [larksuite/cli](https://github.com/larksuite/cli)
- A Lark/Feishu account authorized through `lark-cli auth login`

## Normal Usage

Most users should use the Codex skill included in this plugin. The CLI exists for the skill, CI, and debugging.

On first publish, the skill can create a dedicated folder in the current user's Lark Drive root, then store that folder token in `git-your-lark.yml`. After publishing, share the resulting Lark folder from Lark itself; Git Your Lark does not change sharing permissions in v1.

## V1 Scope

- Local Markdown to Lark docx publishing
- First-publish folder creation in the user's Lark Drive
- Lark document references for local cross-document links
- Local image and attachment handling
- Reviewable sync preview files
- Publish with conflict checks
- Verification after sync

V1 does not implement a full GitHub pull request platform, bidirectional sync, MCP server, automatic three-way merge, or Lark sharing/permission management.
