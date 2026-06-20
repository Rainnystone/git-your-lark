# Git Your Lark

Git Your Lark is a Codex plugin for publishing local Markdown workspaces to Lark/Feishu documents through the official `lark-cli`.

It is preview-first: scan local and remote state, generate a reviewable sync preview, then publish it only if the remote base has not changed.

## Requirements

- Node.js 20+
- `lark-cli` from [larksuite/cli](https://github.com/larksuite/cli)
- A Lark/Feishu account authorized through `lark-cli auth login`

## Normal Usage

Most users should use the Codex skill included in this plugin. The CLI exists for the skill, CI, and debugging.

In the skill-first workflow, ask Codex to sync a local workspace to Lark. The skill checks the `lark-cli` dependency and auth state, creates the first-publish Lark Drive folder when needed, generates a preview proposal, asks for confirmation, publishes the approved proposal, and verifies the remote documents after sync.

On first publish, the skill can create a dedicated folder in the current user's Lark Drive root, then store that folder token in `git-your-lark.yml`. You can also start from the basic example config in [`docs/examples/basic/git-your-lark.yml`](docs/examples/basic/git-your-lark.yml) and replace the folder token and URL.

After publishing, share the resulting Lark folder from Lark itself. Git Your Lark v1 does not manage Lark sharing permissions; use the folder or document URL reported by the tool, or the available folder or document token, to open Lark and configure sharing in the Lark UI.

## CLI Debugging

Use the CLI when debugging the skill workflow or validating a workspace manually.

```bash
gyl doctor
```

For first publish, create a remote Lark Drive folder and write `git-your-lark.yml`:

```bash
gyl init --create-remote-folder --folder-name "Project Notes"
```

Or bind the config to an existing Lark Drive folder:

```bash
gyl init --remote-folder-token fld_existing
```

Generate a reviewable proposal:

```bash
gyl proposal -c git-your-lark.yml
```

Publish only after reviewing the proposal and confirming it has no blockers:

```bash
gyl publish .git-your-lark/proposals/<proposal-id>.json -c git-your-lark.yml
```

Verify local Markdown titles against remote Lark docx state after publishing:

```bash
gyl verify -c git-your-lark.yml
```

`apply` and `merge` are advanced aliases for publishing a reviewed sync proposal. They are not GitHub pull request merge commands and do not create or merge GitHub PRs.

## Safety Model

Git Your Lark is preview-first. A proposal with blockers must not be published; regenerate or fix the workspace until the proposal is clear.

The default conflict policy is `stop`. If remote documents change after preview generation, publish stops and reports the conflict before writing. Git Your Lark does not silently overwrite remote edits.

## V1 Scope

- Local Markdown to Lark docx publishing
- First-publish folder creation in the user's Lark Drive
- Lark document references for local cross-document links
- Local image and attachment handling
- Reviewable sync preview files
- Publish with conflict checks
- Verification after sync

V1 does not implement a full GitHub pull request platform, bidirectional sync, MCP server, automatic three-way merge, or Lark sharing/permission management.
