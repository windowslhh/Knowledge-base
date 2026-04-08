# GBrain — LLM Knowledge Base

## 项目概述

基于 "LLM Wiki" 方法论的知识库系统。LLM 负责维护持续积累的 Markdown Wiki，人类通过 Obsidian 浏览和编辑。

## 架构

- **运行时**: Bun + `bun:sqlite`
- **数据层**: SQLite (brain.db) + FTS5 全文搜索 + 向量嵌入
- **人类界面**: Obsidian（打开 `wiki/` 目录作为 Vault）
- **LLM 界面**: CLI (`gbrain`) + MCP Server（9 个工具）
- **同步**: SQLite 是 source of truth，每次写入自动导出到 `wiki/`

## 双轨知识模型

每个页面包含两部分：
1. **Compiled Truth** — 当前最佳理解（持续更新覆盖）
2. **Timeline** — 时间线条目（只追加，记录何时从哪个来源获取了什么）

## 关键约定

### Slug 命名
- 使用 `category/name` 格式，如 `people/jensen-huang`
- 小写、连字符分隔
- Slug 映射文件路径：`wiki/{slug}.md`

### 标签
- 中文或英文均可
- 用于结构化分类和搜索过滤

### Wiki 链接
- 使用 Obsidian `[[slug]]` 或 `[[slug|显示文本]]` 格式
- 链接会自动解析并存入 links 表

### Markdown 格式
```markdown
---
slug: category/name
title: 页面标题
tags: [tag1, tag2]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

正文内容（Compiled Truth）...

---

## Timeline

- **YYYY-MM-DD** | source — 摘要
```

## MCP 工具

| 工具 | 说明 |
|------|------|
| `search` | 混合搜索 |
| `read` | 读取页面 |
| `write` | 创建/更新页面 |
| `ingest` | 存储原始数据 |
| `query` | 面向问答的搜索 |
| `list` | 列出页面 |
| `backlinks` | 反向链接 |
| `tags` | 标签管理 |
| `sync` | wiki/ ↔ SQLite 同步 |

## 工作流

1. **摄入**: 读取源文档 → 提取知识 → `write` 到相关页面 → 自动同步到 wiki/
2. **查询**: `search`/`query` → 返回相关页面 → 合成回答
3. **维护**: 定期 `sync` 确保 Obsidian 编辑同步回数据库
4. **丰富**: 交叉引用、添加 `[[wiki-link]]`、补充标签

## 开发命令

```bash
bun run dev -- <command>     # 运行 CLI
bun run serve                # 启动 MCP 服务器
bun run test                 # 运行测试
bun run build                # 编译为二进制
```
