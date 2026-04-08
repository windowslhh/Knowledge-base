# 摄入工作流 (Ingest)

## 前置条件
- 用户提供了源文档（文件路径或粘贴内容）

## 步骤

### 1. 理解现有知识
```
read wiki/index.md
```
了解当前知识库结构，确定新内容应归入哪些页面。

### 2. 分析源文档
从文档中提取：
- **实体**：人物、公司、概念、项目等
- **事实**：关键数据点、观点、决策
- **时间信息**：日期、时间线事件
- **关系**：实体之间的关联

### 3. 更新页面
对每个实体，使用 `write` 工具：

```json
{
  "slug": "category/entity-name",
  "title": "Entity Name",
  "compiled_truth": "合并后的最新理解...",
  "tags": ["tag1", "tag2"],
  "timeline_entry": {
    "date": "YYYY-MM-DD",
    "source": "source-file.pdf",
    "summary": "从此来源获取的关键信息摘要"
  }
}
```

### 4. 建立链接
在内容中使用 `[[slug]]` 格式引用相关页面。系统会自动解析并存储链接关系。

### 5. 存储原始数据
```json
{
  "tool": "ingest",
  "source_path": "sources/document.pdf",
  "content": "原始内容...",
  "page_slug": "category/entity-name"
}
```

## 规则
- 优先更新现有页面，而非创建新页面
- Compiled Truth 应合并新旧信息，保持最新状态
- Timeline 只追加，不修改历史条目
- 每个来源都记录在 timeline 中
