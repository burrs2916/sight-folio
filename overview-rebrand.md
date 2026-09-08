# Sight Folio 主题与 Logo 重新设计

> 目标：从原 `Project Sight`（代码分析器）视觉体系中剥离，建立 **Sight Folio**（本地优先小说 / 长文创作编辑器）的独立身份。

## 1. 视觉体系

| 角色 | 旧（Project Sight） | 新（Sight Folio） |
|------|--------------------|-------------------|
| 主色 primary | 海军蓝 `#2a5688` | **墨紫 `#4A338F`**（brand[700]） |
| 暖色点缀 accent | 琥珀 `#f59e0b` | **金 `#E0A93B`**（orange[500]，warning 语义沿用） |
| 应用背景 bg | 冷灰 `#f5f7fa` | **暖纸 `#FBF7EF`** |
| Logo | 眼睛 + `</>` 代码符 | **翻开的书 + 灵感星火（金色四角星）** |

主题实现：MUI v9 `createTheme` 的 `brand` 梯度整体改为紫色；`background.default` 浅色改 `#FBF7EF`；`orange` 梯度改为金色（app 的暖色 accent）。深色模式背景保持 `gray[900]`。默认主题（preset="default"）现即墨紫。

## 2. 改动文件清单

**主题**
- `src/theme/themePrimitives.ts` — brand(紫) / orange(金) 梯度、background.default 浅色
- `src/theme/AppTheme.tsx` — purple 预设对齐 brand、浅色 bg

**Logo（源真值）**
- `src-tauri/icons/logo-master.svg` — 重绘书+星火
- `assets/logo/sight-folio-logo.svg` — 新增（旧 `project-sight-logo.svg` 已删除）
- `assets/logo/dwg-ai-viewer-logo.svg` — 删除（DWG 查看器项目的遗留 logo，在 sight-folio 中无引用，非 Sight Folio 品牌）
- `src/components/layout/SideMenu.tsx` — 导入改名 `sightFolioLogo` + tooltip/alt/副标题

**可见品牌串**
- `src-tauri/tauri.conf.json` — productName / identifier(`com.sight.folio`) / window title
- `index.html` — `<title>` + favicon（内联 SVG 改紫底金星）
- `start.sh` — APP_NAME
- `src-tauri/src/lib.rs` — 两个窗口标题
- `src-tauri/Cargo.toml` — description
- `src/components/layout/AppNavbar.tsx` — 顶部项目名
- `src/components/monitors/AlertMonitor.tsx` — 完成提示文案
- `src/i18n/{en-US,zh-CN}.json` — `app.title / tagline / taglineFull / nav.productName / footer.desc / report.generatedBy`

## 3. 刻意未改（后续单独处理）
- `package.json` / `Cargo.toml` 的 crate / package 名仍为 `project-sight`（改名影响构建，需单独评估）
- 源码注释 `// project-sight:`、localStorage 键 `project-sight-locale`、report 格式键 `project-sight-analysis-report`
- 领域文案（如 `report.title` = "Project Code Analysis Report"、AI system prompt 的能力描述）——属内容/模块迁移范畴，待需求文档 §8 的产品决策落地

## 4. 待你在本地执行的一步
SVG 与内联 favicon 已统一为书+星火；`assets/logo` 下仅保留 `sight-folio-logo.svg`（`dwg-ai-viewer-logo.svg` 遗留 logo 已删除）。平台栅格图标（png / icns / ico / android / ios）目前仍是旧的眼睛 logo——已通过读取 `src-tauri/icons/icon.png` 确认。这些文件全部是由 `logo-master.svg` 生成的产物，本环境无 `tauri` CLI / ImageMagick / rsvg，无法栅格化。请在本机：

```bash
cd /Users/liwenchao/GithubProSpace/sight-folio
npm install          # 先装依赖（迁移时排除了 node_modules）
npx tauri icon src-tauri/icons/logo-master.svg   # 从新 master 重新生成全部平台图标
```

## 5. 验证状态
- JSON（tauri.conf / i18n）与 SVG 已通过格式校验。
- 五关（cargo check → cargo test --lib → tsc --noEmit → vitest → vite build）**未在本会话运行**：迁移时排除了 `node_modules`/`target`，且本机无网络与栅格化工具。请 `npm install` 后自测。
- AI 未自动提交，改动保持未提交，待你 review。
