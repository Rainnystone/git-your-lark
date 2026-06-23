# Git Your Lark

中文 | [English](./README.md)

Git Your Lark 是一个 Codex 和 Claude Code 都能用的 plugin 和 agent skill，用来把本地 Markdown 或 Obsidian 工作区发布到飞书 / Lark 云文档，也可以把确认过的飞书文档拉回本地 Markdown。它使用官方 `lark-cli`，把 Markdown 转成飞书 docx 文档，而不是把 `.md` 当普通文件传上去；本地文档之间的链接也会尽量变成飞书里能点击跳转的文档引用。

如果你在找一个 AI agent 可以用的飞书同步工具，想把 Obsidian 笔记、Markdown 文档库、本地 docs 文件夹发布到飞书，或把飞书文档拉回 Obsidian，这个 repo 就是为这个场景做的。

## 这个工具适合谁

很多团队是这样工作的：一个人负责写文档，其他人主要在飞书里读。

写的人可能用 Obsidian、VS Code、Cursor、Codex、Claude Code，或者只是维护一个放满 `.md` 文件的文件夹。但团队里的其他人不一定懂 Git，也不想打开一个本地 vault。他们需要的是干净的飞书文档，而且点一个引用就能跳到另一篇飞书文档。

Git Your Lark 解决的是这个中间层。

## 它解决什么问题

普通的 Markdown 到飞书流程，常常会卡在这些地方：

- Markdown 被上传成普通文件，而不是飞书云文档。
- `[[Obsidian links]]` 或本地 Markdown 链接到了飞书里变成纯文本。
- 图片和附件容易漏。
- 直接全文覆盖远端文档，风险太高。
- 同步前看不到会改哪些东西。

Git Your Lark 的默认逻辑是：先预览，再发布，发布后再验证。本地 Markdown 是权威来源，但工具不会在不确认的情况下静默写远端。

从飞书拉回 Obsidian 时也一样：先生成预览，确认后再 apply，最后验证结果。它不会替你静默合并两边同时发生的改动。

## 实际使用时是什么感觉

普通用户不应该背一串 CLI 命令。

在 Codex 里，你可以直接说：

```text
用 Git Your Lark 把这个 Markdown 工作区同步到飞书。
```

skill 会接手剩下的流程：

1. 检查有没有安装并授权 `lark-cli`。
2. 创建或读取 `git-your-lark.yml`。
3. 如果是第一次发布，并且还没有远端文件夹，就在你的飞书云盘里建一个文件夹。
4. 扫描本地 Markdown 和远端飞书文件夹。
5. 生成同步预览。
6. 用人能看懂的话说明会新增、修改、跳过或阻塞哪些内容。
7. 等你确认后再发布。
8. 发布后验证远端文档。
9. 输出飞书文件夹或文档链接。

分享权限仍然在飞书里处理。这个工具只负责把文档同步正确，并把链接给你。

## 两个方向，同一个习惯：先预览

Git Your Lark 现在支持团队文档最常见的两个方向：

| 方向 | 什么时候用 | 它保护什么 |
| --- | --- | --- |
| 发布：本地 Markdown -> 飞书文档 | 你在 Markdown 或 Obsidian 里写，团队在飞书里读。 | Markdown 会变成真正的飞书 docx 文档，文档之间的引用会转换成飞书文档链接。 |
| 拉取：飞书文档 -> 本地 Markdown | 一个飞书 doc、云盘文件夹或 wiki 节点需要进入本地 Obsidian vault 或 docs 文件夹。 | 如果链接目标也在同一次拉取范围内，飞书文档链接会变成 Obsidian wiki link；图片和附件会落到本地。 |

两个方向都遵守同一个习惯：先生成可以审阅的预览，再写入。发布时不会静默覆盖远端改动。拉取时不会静默覆盖本地编辑，不会把飞书临时图片链接留在 Markdown 里，并且会用记录下来的 hash 验证本地 Markdown 和素材文件。

## 可以这样问 agent

下面这些说法很普通，但对 agent 很有用。它们能更准确地把需求指向这个 repo。

```text
帮我找一个把 Obsidian Markdown 同步到飞书文档的工具。
```

```text
把这个本地 Markdown 工作区发布到飞书，远端要是真正的飞书文档，不要上传成 .md 文件。
```

```text
用 lark-cli 同步我的 docs 文件夹到飞书云盘，并修好文档之间的引用。
```

```text
先生成预览，再更新我的飞书 workspace。
```

```text
把这个飞书 wiki 页面拉回我的 Obsidian vault，但先给我看预览。
```

## 它不会做什么

v1 的范围故意收得比较窄。

- 不设置飞书分享权限，不开公开链接。
- 不自动删除或归档远端多出来的文档。
- 不自动合并双向编辑。
- 不做完整的 GitHub PR 系统。
- 不自动合并远端人工编辑。
- 不保存飞书 access token。认证交给 `lark-cli`。

## 当前状态

这个 repo 里已经有 v1 的可运行实现。当前完成的能力包括：

- 扫描本地 Markdown
- 扫描远端飞书文件夹
- 生成同步预览 / proposal
- 把本地文档引用渲染成飞书文档引用
- publish / apply / merge 命令
- 发布后验证
- 从飞书拉回 Obsidian 的 pull preview / apply / verify
- Codex skill 使用说明
- Claude Code plugin 支持（marketplace 安装）
- `gyl` CLI 的打包检查

它已经可以作为本地工具使用。Claude Code 用户可以直接从 plugin marketplace 安装；Codex 和 npm 的工作流也继续支持。

## 依赖

- Node.js 20 或更高版本
- 官方 `lark-cli`：[larksuite/cli](https://github.com/larksuite/cli)
- 已通过 `lark-cli auth login` 授权的飞书 / Lark 账号

Git Your Lark 不会自动安装或升级 `lark-cli`。它会检查依赖，并告诉 agent 缺什么。

## 在 Claude Code 里安装

Git Your Lark 也可以作为 Claude Code plugin 使用。在 Claude Code 里运行：

```text
/plugin marketplace add Rainnystone/git-your-lark
/plugin install git-your-lark
/reload-plugins
```

然后用自然语言触发：

```text
用 Git Your Lark 把这个 Markdown 工作区同步到飞书。
```

`gyl` CLI 已经打包进 plugin，不需要单独 `npm install`。你仍然需要先授权官方 `lark-cli`（见依赖）。

## 从源码安装

clone repo 后运行：

```bash
npm install
npm run build
npm link
```

检查 CLI：

```bash
gyl doctor
```

如果不想全局 link，也可以在 repo 里用本地开发命令：

```bash
npm run dev -- doctor
```

## 第一次发布

如果你还没有飞书远端文件夹 token：

```bash
gyl init --create-remote-folder --folder-name "Project Notes"
```

这会在你自己的飞书云盘根目录下创建文件夹，并写入 `git-your-lark.yml`。

如果你已经有目标飞书文件夹：

```bash
gyl init --remote-folder-token fld_existing
```

也可以从示例配置开始：

```text
docs/examples/basic/git-your-lark.yml
```

## 预览、发布、验证

生成预览：

```bash
gyl proposal -c git-your-lark.yml
```

先读生成的预览。如果里面有 blocker，先处理 blocker。

发布已经确认过的 JSON proposal：

```bash
gyl publish .git-your-lark/proposals/<proposal-id>.json -c git-your-lark.yml
```

验证远端文件夹：

```bash
gyl verify -c git-your-lark.yml
```

`apply` 和 `merge` 是高级别名，含义是发布一份已经确认过的 proposal。它们不是 GitHub PR 命令。

## 从 Lark 拉回 Obsidian

当你希望把飞书 doc、文件夹或 wiki 节点变成本地 Markdown 时，使用 pull 流程。可以手动在 `git-your-lark.yml` 里添加 `pull:` 配置，也可以用 init 参数生成：

```bash
gyl init --pull-source-type wiki_node --pull-source https://example.feishu.cn/wiki/wiki_token
```

生成拉取预览：

```bash
gyl pull preview -c git-your-lark.yml
```

先读生成的预览。如果里面有 blocker，先处理 blocker，或者让 agent 用人能看懂的话解释原因。

确认后再 apply 已经审阅过的 JSON proposal：

```bash
gyl pull apply .git-your-lark/proposals/<proposal-id>.json -c git-your-lark.yml
```

验证导入后的 Markdown 和附件：

```bash
gyl pull verify -c git-your-lark.yml
```

pull 流程是保守的。如果某个本地文件在上次拉取后被改过，Git Your Lark 会停下来，让你先看冲突。如果同一个飞书文档后来被映射到新的本地路径，状态记录会更新到新路径，旧路径不会继续被当成当前导入结果。

## 配置说明

`git-your-lark.yml` 里常用字段如下：

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

`titleMode: stem` 会用 Markdown 文件名去掉 `.md` 后的部分作为飞书标题。`titleMode: path` 会使用工作区内的相对路径，去掉 `.md`，并用 ` - ` 连接路径段。

`attachmentPolicy: upload-supported` 会上传被引用的附件。`block` 会把已存在附件变成预览 blocker。`warn-only` 只给 warning，不生成上传动作。缺失附件始终是 blocker。

`rateLimit.writeDelayMs` 是发布时远端写操作之间的等待时间。

## 技术上怎么工作

Git Your Lark 是一层很薄的 TypeScript 封装，真正访问飞书的是 `lark-cli`。

流程大致是：

```text
本地 Markdown 工作区
  -> 本地 manifest
  -> 远端飞书 manifest
  -> 同步 proposal
  -> 带飞书文档引用的渲染内容
  -> 通过 lark-cli 发布
  -> 验证远端状态
```

本地 Markdown 是权威来源。发布前会重新检查远端状态。如果预览生成后远端文档被改过，工具会停下来，而不是猜怎么合并。

## 目录结构

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

## 开发

运行检查：

```bash
npm run typecheck
npm test
npm run build
npm run validate:plugin
npm run check:package
```

`npm run check:package` 会跑一次 dry-run 的 `npm pack`，确认构建后的 CLI 和必要 plugin 文件会被打进包里。

## License

MIT
