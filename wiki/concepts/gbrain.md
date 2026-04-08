---
slug: concepts/gbrain
title: GBrain 知识库系统
tags:
  - 工具
  - 知识管理
  - 项目
created: '2026-04-08'
updated: '2026-04-08'
---
基于 "LLM Wiki" 方法论的知识库管理系统。

## 核心理念
- LLM 负责维护持续积累的 Markdown Wiki
- 人类通过 [[tools/obsidian]] 浏览和编辑
- SQLite 是数据源，wiki/ 目录是 Obsidian 可读的镜像

## 双轨知识模型
1. **Compiled Truth** — 当前最佳理解（持续更新覆盖）
2. **Timeline** — 时间线条目（只追加，记录来源）

## 技术栈
- 运行时：Bun + bun:sqlite
- 搜索：FTS5 双索引（trigram + unicode61）+ 向量嵌入
- 接口：CLI（16 命令）+ MCP Server（9 工具）

***

## Timeline

- **2026-04-08** | initial-setup — 系统完成开发，通过全场景测试
