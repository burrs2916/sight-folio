# Sight Folio

**面向长篇创作的桌面创作平台** —— 写作台、语料库、AI 写作助手与场景画布一体化，基于 Tauri 2 构建。

Sight Folio 聚焦「写作 + 语料 + AI 上下文」主线：在统一的本地创作空间里完成**构思 → 写作 → 语料检索 → AI 辅助修改 → 导出发布**的完整闭环。作品以 SQLite 本地存储，天然离线可用。

> 当前版本 v0.1.0（开发中）。产品规划详见 [`docs/创作平台蓝图.md`](docs/创作平台蓝图.md)。

## 功能全景

| 支柱                    | 能力                                                                                                                                                                        | 状态                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **写作台**（主线）      | TipTap 富文本编辑器、章节目录/多章节管理、写作目标（字数/进度）、章节快照与崩溃恢复、查找替换、内置校对（错别字/敏感词）、批注与标注、导入外部文稿（md/txt/html/epub/docx） | ✅ 自建，最成熟             |
| **语料库**（主线）      | 导入语料（epub/mobi/docx/txt 等）、指纹查重去重、切分与分类标签、短句检索、导入期过滤                                                                                       | ✅ 自建                     |
| **AI 写作助手**（主线） | 续写/润色/内联 AI（正文页）、全书上下文注入、AI 审阅与洞察、可配置扫描预置                                                                                                  | ✅ 自建                     |
| **场景画布**            | 多视图画布（全书总览/分镜/人物关系/封面）、实体拖拽编排、树形图层、插画与图片、撤销重做                                                                                     | 🚧 迭代中（F 系列批次推进） |
| **代码分析工作台**      | AST 级源码分析（tree-sitter）、复杂度/依赖/热点画像、集成终端、远程/数据源连接                                                                                              | 🔶 fork 继承资产            |
| **数据源集成**          | PostgreSQL / MySQL / Redis / MongoDB 连接与数据查看                                                                                                                         | 🔶 fork 继承资产            |

写作域四大重逻辑（章节快照、导出、语料管线、AI 上下文）集中在 Rust 服务层实现，前端保持声明式调用。

## 架构

```
sight-folio
├── src/                    前端（React 18 + TypeScript + Vite）
│   ├── pages/              页面级视图（写作台、语料库、AI、工作台等）
│   ├── editor/             编辑器内核、场景画布（SceneEditor）、面板组件
│   ├── ai/                 AI 助手：providers、上下文构建、写作助手逻辑
│   ├── services/           Tauri 命令的 TS 封装（writing/corpus/fs/agent 等）
│   ├── store/              状态管理（Zustand）：editor/writing/corpus 等域
│   ├── utils/              领域工具（写作 schema、语料、格式化、崩溃恢复）
│   ├── components/         共享 UI 组件
│   └── theme/ i18n/        主题与国际化
├── src-tauri/              Rust 后端（Tauri 2）
│   └── src/
│       ├── commands/       Tauri command 层（薄，只做参数校验与转发）
│       ├── application/    应用服务（写作导出 docx/pdf/epub、用例编排）
│       ├── domain/         领域层（writing/corpus 的模型、管线、指纹、schema）
│       ├── infrastructure/ 基础设施（rusqlite 数据库、仓储、迁移、数据源连接）
│       └── plugins/        Tauri 插件（ai_agent 工具集等）
├── docs/                   产品蓝图、语料库设计、归档分析产物
├── data/                   运行时数据（SQLite：config.db / corpus.db，不入库）
├── logs/                   运行日志（不入库）
└── start.sh                开发启动脚本
```

技术栈：**Tauri 2**（Rust）· React 18 · TypeScript 5 · Vite 6 · MUI 9 · Zustand 5 · TipTap 3（富文本）· Konva/react-konva（画布）· ECharts / Three.js（可视化）。

Rust 侧关键依赖：`rusqlite`（本地存储）、`tree-sitter`（AST 解析）、`rayon`（并行分析）、`zip/quick-xml/mobi`（语料与 DOCX/EPUB 解析）、`lopdf + ttf-parser`（离线 PDF 导出）、`tokio`（异步）等。

## 开发

### 环境要求

- Node.js ≥ 20，npm ≥ 10
- Rust 稳定版工具链（`rustup`）
- Tauri 2 平台依赖：macOS 需 Xcode Command Line Tools；Linux 需 `webkit2gtk-4.1` 等（见 [Tauri 官方文档](https://tauri.app/start/prerequisites/)）；Windows 需 WebView2

### 启动

```bash
# 1. 安装依赖
npm install

# 2. 开发模式（前端 + Tauri 壳，热更新）
npm run tauri dev

# 或仅启动前端（不依赖 Rust 壳）
npm run dev           # http://localhost:23010
```

> 调试模式下数据库落在 `data/`（如 `config.db`、`corpus.db`），日志在 `logs/`；二者已在 `.gitignore` 中排除。

### 常用命令

| 命令                                   | 说明                             |
| -------------------------------------- | -------------------------------- |
| `npm run dev`                          | 仅启动 Vite 前端                 |
| `npm run tauri dev`                    | Tauri 开发模式（含 Rust 编译）   |
| `npm test`                             | 前端测试（Vitest）               |
| `npm run lint` / `npm run lint:strict` | ESLint 检查 / 零告警严格模式     |
| `npm run format` / `format:check`      | Prettier 格式化 / 校验           |
| `npm run build`                        | 前端产物构建（tsc + vite build） |
| `npm run tauri build`                  | 完整桌面应用构建打包             |

Rust 侧校验：

```bash
cd src-tauri
cargo check --all-features   # 编译检查
cargo test                   # Rust 单元测试
```

## 测试

- 前端：Vitest + Testing Library，覆盖写作 schema/树、语料查重与切分、导出链路、崩溃恢复、编辑器工具等关键路径（114 个测试文件 / 1400+ 用例）。
- Rust：领域层与基础设施单测（数据库迁移、仓储、指纹管线等）。

## 构建与发布

```bash
npm run tauri build   # 产出安装包（DMG/NSIS 等，取决于目标平台）
```

当前 `tauri.conf.json` 的 macOS 签名使用 ad-hoc（`signingIdentity: "-"`）。正式对外分发前需完成：

1. 申请 **Apple Developer ID Application 证书**（macOS 分发签名）与 notarization 凭证
2. 在 `tauri.conf.json` 中配置真实签名身份，并保留 `Entitlements.plist` 的最小权限
3. Windows 侧配置代码签名证书（EV 或 OV）
4. 核对 CI 流水线中构建 → 测试 → 打包 → 签名 → 产物上传全链路

发布前安全核验清单（重点）：

- [ ] `write_file` 等高危命令的最小 scope 复核
- [ ] asset protocol scope 收缩到必要目录
- [ ] 数据目录干净（无 `.bak` 冗余、无旧日志入库）
- [ ] CSP 保持最小化且无通配放宽

## 仓库卫生约定

- `data/`、`logs/`、`.dumate/`（AI 助手会话）、`.tmp/` 均不入库
- 分析类产物统一归档至 `docs/archive/`
- 文档类设计稿（蓝图、语料库设计）纳入 `docs/` 版本管理

## License

见 [LICENSE](LICENSE)。
