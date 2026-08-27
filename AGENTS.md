# Repository Guidelines

## 项目结构与模块组织

- `entrypoints/` 存放 WXT 扩展入口：`background.ts`、YouTube 页面脚本 `content.ts`，以及 `sidepanel/` 下的 Preact 侧边栏。
- `src/services/` 包含字幕、翻译、LLM、AI 和导出逻辑；可脱离浏览器运行的业务逻辑优先放在这里。
- `src/adapters/` 隔离 YouTube、timedtext 和 Supadata 集成；`src/messaging/` 定义消息协议与后台路由。
- `src/storage/` 负责 IndexedDB 与扩展设置；共享领域类型在 `src/types.ts`，小型通用函数在 `src/utils/`。
- 测试与源文件相邻，命名为 `*.test.ts` 或 `*.test.tsx`；产品决策和手动验收文档位于 `docs/`。

## 构建、测试与开发命令

- `npm run dev`：启动 WXT 开发模式，用于本地加载和调试扩展。
- `npm run build`：生成生产构建，产物位于 `dist/`。
- `npm run compile`：仅执行 TypeScript 类型检查，不生成文件。
- `npm test`：单次运行完整 Vitest 测试套件。提交 PR 前应运行 `npm test` 和 `npm run compile`。

## 代码风格与命名约定

使用 TypeScript 与 Preact，保持两空格缩进、单引号、分号，以及现有简洁的行内注释风格。优先使用具名导出，单个模块只承担一项清晰职责。变量和函数用 `camelCase`，组件和类型用 `PascalCase`，文件名使用 kebab-case，例如 `llm-translate.ts`。新增消息时，先扩展 `src/messaging/protocol.ts` 的 `Msg` 联合类型，再接入 router 和 UI。

项目当前未配置格式化或 lint 工具；请遵循相邻代码格式，并依靠 `npm run compile` 与测试验证。

## 测试指南

测试框架为 Vitest；UI 测试使用 `@testing-library/preact`，存储测试使用 `fake-indexeddb`。测试文件应与源文件对应，如 `translate.test.ts`、`NotesView.test.tsx`。覆盖成功、异常和状态转换场景，尤其是消息路由与字幕持久化变更。更新快照时应审查其 diff 是否符合预期。

## 提交与 Pull Request 规范

沿用现有 Conventional Commit 格式：`feat: ...`、`fix: ...`、`docs: ...`；当前提交说明以简洁中文为主。一次提交应聚焦单一改动。PR 需说明用户可见行为、已运行的测试，以及迁移或配置影响；侧边栏 UI 变更应附截图或短录屏，并在可用时关联 issue 或设计文档章节。

## 安全与配置

严禁硬编码、提交、记录日志或通过命令行明文传递 LLM/Supadata key。设置和字幕均视为用户数据处理。新增功能时，只申请必要的扩展权限与 host access。
