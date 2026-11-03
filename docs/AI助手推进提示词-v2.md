# 工作室 AI 助手 · 推进提示词 v2（2026-11-02 19:45）

> **这份文件是什么**：它是驱动每一轮自动化推进的**任务提示词**，不是产品文案、不是人设。
> **它要解决什么**：让 sight-folio 内置的「工作室 AI 助手」变成一个**真的能陪创作者写完一本书**的助手——
> 能力更强、说话更像人、界面跟我们自己的设置系统不打架。
> **它不是什么**：不是一份"顺手统一一下样式"的清理清单。任何一轮如果只做了样式没做能力，就是取刀取偏了。

---

## 第 0 节 · 先说清楚这个提示词的目的（每一轮开工先读这 6 行）

1. **服务对象**：用 sight-folio 写长篇网文的创作者。他的一天是：构思 → 立设定 → 排大纲 → 写正文 → 润色 → 审校 → 复盘。
2. **助手的角色**：不是"聊天机器人"，是**坐在旁边的责任编辑 + 代笔**。他要能读懂整本书、知道自己看到了什么、不知道就承认、给的结论能落到具体章节和具体句子。
3. **衡量"更强大"的唯一标准**：用户问一句，助手能不能**直接产出可用结果**（可用的正文段、可用的设定卡、可定位的问题清单），而不是回一段正确的废话。
4. **衡量"更人性"的唯一标准**：流式输出的过程**看着像在写字**，不是在一块会抽搐的面板上等日志刷完。
5. **衡量"界面没坏"的唯一标准**：把设置里**每一档**（字体大小 5 档 × 圆角风格 5 档 × 明暗 2 档）都切一遍，AI 助手面板**没有任何一个元素错位、溢出、看不见光标**。
6. **一句话原则**：**设置里能调的东西，界面里就不许有它调不动的地方；界面里定的几何，就不许在极端档位下自相矛盾。**

---

## 第 1 节 · 本轮已取证的界面真伤（这是新加的一刀，优先级最高）

### 1.1 现象（李先生实机看到）
「设置 → 圆角风格」切到**大圆角 / 圆角**后，AI 助手的输入框**光标跑到边框外面**，输入框和左侧会话栏整体位置偏移。

### 1.2 真因（已按 file:line 复验，不是猜）
圆角档位真源 `appearanceScales.ts:51-57`：`none 0 / small 2 / medium 6 / large 12 / round 20`。
`AppTheme.tsx:89-91` 把它喂给 `theme.shape.borderRadius`。而 AI 助手界面里的圆角全部写成 **MUI 乘数**（`borderRadius: 1.5 / 2 / 3`），乘数是**线性**放大的，**跟控件高度毫无关系**：

| 位置 | 写法 | medium 档 | large 档 | round 档 | 控件实际高度 | 后果 |
|---|---|---|---|---|---|---|
| `workbenchComponents.tsx:918` AI 输入框 | `borderRadius: 2` | 12px | 24px | **40px** | minRows=5 的多行框，`pl:'6px'`、`py:0.25`（首行离上边框只有 2px） | **首行光标落在 40px 圆弧之外**＝用户看到的"光标跑到边框外面" |
| `AiAgentPage.tsx:1622` `/ai` 页输入框 | `borderRadius: 2` | 12px | 24px | 40px | `minRows={1}` 单行 | 两端圆角吃掉文字，光标贴边出框 |
| `AiAgentPage.tsx:394 / :477` 左侧会话栏按钮/条目 | `borderRadius: 2` | 12px | 24px | 40px | 36~40px | 条目糊成药丸，文字左右被弧挤掉 |
| `AiAgentPage.tsx:440` 搜索框 | `borderRadius: 1.5` | 9px | 18px | 30px | ~32px | 同上 |
| `workbenchComponents.tsx:473` 小徽章 | `borderRadius: 3` | 18px | 36px | **60px** | `height: 14` | 半径 = 高度 4 倍，形状彻底失真 |
| `WorkbenchAiPanel.tsx:1782 / :1848` 消息气泡 | `borderRadius: 1.5` | 9px | 18px | 30px | 自适应 | 短消息被圆角吞成椭圆 |

> **同一条坑在 31~33 轮已经踩过一次**：第 32 轮为了修"切直角没反应"，把这些位置从写死 `'12px'` 改成乘数 `2`。
> 改对了"直角档归零"，改错了"大圆角档没有上限"。**乘数只解决了跟随，没解决适配。**

### 1.3 一刀收口的设计口径（写进提示词，之后所有界面都按这个来）

新增一个真源函数（放 `appearanceScales.ts`，跟档位定义同一个文件）：

```ts
/**
 * 控件圆角：档位基准 × 乘数，再按控件高度钳制。
 * 半径永远不得超过半高 —— 超过就等于把文字/光标挤出边框。
 */
export function controlRadius(basePx: number, m: number, heightPx: number): number {
  return Math.min(basePx * m, heightPx / 2);
}
```

四条硬性口径（每一条都要有测试锁）：

- **R1 半高封顶**：任何**定高**控件的圆角 ≤ 高度/2。`sx` 里一律走 `controlRadius(theme.shape.borderRadius, m, h)`，不许裸乘数。
- **R2 多行输入框的几何下限**：首行**左边内缩 ≥ 生效半径**，且**上下内缩 ≥ 生效半径 × 0.35**。即输入框的 `pl/pt` 必须跟着圆角一起长，圆角变大而 padding 不动 = 光标出框。这条就是本轮病灶的直接解。
- **R3 极矮控件（高度 ≤ 24px）** 只有两种合法形态：胶囊（半径 = 高度/2，写成与档位无关的字面量并登记例外，沿用第 32 轮 12 枚 pill 的做法）或直角。**禁止**给它挂 ≥1.5 的乘数。
- **R4 五档 × 明暗双档实测**：AI 助手的三个面（工作室面板 / `/ai` 页 / ⌘I 内联）各写一条渲染探针，遍历 `none/small/medium/large/round`，断言「输入框生效半径 ≤ 半高」且「首行文字内缩 ≥ 生效半径」。断言写在 DOM 计算值上，别只扫源码字符串。

---

## 第 2 节 · 阶段与批次序（一轮取一刀，按序往下走）

### 阶段 A · 设置域收尾（**尚未落地，本轮 19:42 实测**：`customizations.ts` 仍是 8 处裸数字圆角 + 4 处裸 px 字号）
按 `docs/设置生效链路审计-2026-11-02-1922.md` §3/§4 逐字执行，取证已齐不要重扫。
**本轮新增的三条落地情报**（19:40 实测，能省一整轮）：

1. 删除 `themePrimitives.ts` 三份死副本时，**精确行段**：`getDesignTokens 127–266`、`colorSchemes 268–383`、`shape 458–460`。
   **必须保留**：`3–28`（`declare module` 类型增强，`themePresets.ts:358` 的 `baseShadow` 靠它）、`34–125`（brand/gray/green/orange/red/blue/indigo，themePresets 在用）、`384–395`（`UI_FONT_STACK_SYSTEM`）、`396–456`（**活口 `typography`**，AppTheme 在用）、`462–468`（`shadows`）。
2. **删完会连带三处悬空符号，直接撞 eslint 的 0 warning 门禁**（`no-unused-vars` 本仓配的是 `warn`，见 `eslint.config.js:51`）：
   - `alpha`（只在 181/192/193/195/196 + 310/320/321/367/377/378 用，全在待删块内）→ 从第 1 行 import 里摘掉；
   - `PaletteMode`（只在 127 的签名用）→ 摘掉；
   - `const customShadows`（第 32 行，只有 128/264 两个消费者，都在待删块内）→ 一起删；
   - `createTheme`/`defaultTheme`/`Shadows` **留着**（`typography` 与 `shadows` 还在用）。
3. **为什么这 8 处能活过 26~36 轮**：第 32 轮那把圆角扫描锁 `settingsRound32.test.ts:77` 明确 `if (rel.startsWith('theme/')) continue;`，且它的判据只抓**字符串字面量** `borderRadius: '12px'`，抓不到 `borderRadius: 10` 这种数字。
   ⇒ 新的两把锁必须**自己覆盖 `src/theme/**` 的数字形态**，并与第 32 轮那把**判据分家**（它管全仓字符串，新锁管主题目录数字），别互相以为对方管了。

### 阶段 B · 工作室 AI 助手（每轮一刀）

- **B0（新插队，就是第 1 节那刀）**：`controlRadius()` + R1~R4，收 AI 助手三个面的圆角/输入框几何。**这一刀做完，用户投诉的"光标出框"才算真修掉。**
- **B1 接线三刀（零拍板）**：① `writingContextProvider.ts:346`、`requirementsSpecProvider.ts:82` 给 `packWithinBudget` 传真预算（不传第二参会原样返回，正确写法抄 `scanContextProvider.ts:543`）；② `writingCorpus.ts:643-644` 当前章全文无上限注入，加长度闸并复用 `writingAssistant.ts:68` 的 `TAIL_CHARS`；③ `workbenchPanelHooks.ts:500-507` 兜底追问补「本视图无正文」判据。
- **B2 `max_tokens` 打通**：`AgentEngine::new` 签名补该参、构造不再写死 4096（`engine.rs:379-394`，调用点 `commands/agent.rs:651-657`），传 `model.max_tokens`。**动 Rust 必跑 `cargo test --lib`**。
- **B3 对话风格（人性化，含流式）**：
  - `WritingAiChatDialog.tsx:343,350` 纯 Typography → 换 `aiMarkdown.MarkdownView`（这个入口现在**完全不跑 Markdown**）；
  - **流式观感**：现状只有 `CircularProgress + 「AI 正在思考」`（`WorkbenchAiPanel.tsx:1853-1860`），**首个 token 之后正文末尾没有任何光标/书写指示**，尾部靠 `repairStreamingTailInline` 补标记（机制已具备，缺的是"正在写"的存在感）。要加的是：流式末尾**闪烁书写光标**、稳定段与尾部的**字体一致不跳行高**、工具步骤折叠不引起正文回流、`useSmartScrollToBottom` 在用户上翻时**不抢滚动**。
  - 约 115 处裸 px 字号走 `uiFontSize()`；深色档 3 处（`InlineChat.tsx:364` 浮窗底写死 rgba、`workbenchComponents.tsx:352` 橙底无 dark 分支、`aiToolSteps.tsx:190-213` 9px + `text.disabled`）。
- **B4 组件收敛**：`ChatMarkdown.tsx` 改成 `aiMarkdown.tsx` 的 fontSize 变体（同 `parseBlocks`/流式修复/8 条缓存，只差 14 vs 11.5px）。**工具卡两套语义不同，别合。**
- **B5 会话功能**：工作室会话删不掉（`deleteConversation` 只在 `AiAgentPage.tsx:357,516` 被用，`WorkbenchAiPanel.tsx:1092-1183` 历史菜单无入口）；单条消息删除（现在只有 `agentStore.ts:394` 隐式截断）；`contextPersist.ts` 加容量上限与清理入口；会话走 SQLite 跨窗口不同步。
- **B6 左侧导航栏（新插）**：`AiAgentPage.tsx:361-400+` 那条 280px 定宽会话栏——**没有最大宽度自适应、没有分组、没有重命名/批量清理入口、长标题只 `slice(0,80)`**。要按「结构 → 状态 → 操作」三步做完，并与 B0 的档位口径一起验。
- **B7 需李先生拍板（不拍不做、不做半套）**：提示词重构（角色/输出格式契约/盲区声明提到 system 层并配置化、补 few-shot、语言指令 5 份副本收成 1 份、温度与迭代次数分档）。**先出文案草案给人看，不许直接改人设落盘。**

---

## 第 3 节 · 提示词质量本身的验收标准（B7 之前先把"什么叫好"写死）

评价助手输出的口径，四条都能拿去当测试或评审清单：

1. **有依据**：结论必须能指到具体章节/设定卡/正文片段；指不到就写"依据不足"，**禁止编剧情**。
2. **知道边界**：本轮没读进上下文的书稿，明说"我没看到"，不许根据书名猜内容。
3. **可执行**：给建议的同时给**可直接粘贴的成品**（改好的段落、可用的设定字段、可点的清单），不要只给方向。
4. **像编辑不像客服**：不客套、不复述用户问题、不写"作为 AI"；先结论后理由；长回答用分节而不是碎列表。

---

## 第 4 节 · 门禁、红线、工具陷阱（沿用历轮实测，一条不能少）

**四条门禁全绿才许说完成，读数写实测值**：`npx tsc --noEmit` 0 error / `npx vitest run` 全绿（写文件数+用例数）/ `npm run build` exit 0 / 触及文件 eslint **0 error · 0 warning** + prettier 合规；i18n 双包差集为空；动 `src-tauri` 另跑 `cargo test --lib`。
**基线（第 36 轮 19:21 独占实测）**：tsc 0 / vitest 237 files · 2737 tests 全绿 / `git status` ~182 行。**19:45 复采**：tsc 0、i18n 双包 6219 叶子键差集为空、`git status` 185 行、`customizations.ts`+`themePrimitives.ts` prettier 合规。

**红线**：不许 `git commit`/`git push`；不许改本定时任务本体；B7 与"强调色是否跟随主题"未拍板不做；`sx`/`styled` 里**已是乘数的圆角不许改成写死值**（本轮要改的是**加钳制**，不是回退成字面量，否则又把"切直角没反应"的坑挖回来）；`src/editor/renderers/**`（画布零 Emotion + 自有 zoom）与 Monaco/xterm（走 `codeFontSize`）是既定例外；新增设置域一次交齐 7 件套（落库 scope / init 读回 / 跨窗口 hydrate / 抽屉入口 / **真实消费点** / 进备份键 / 恢复默认）。

**工具陷阱**：① 本仓 `rg` 跳过 `__tests__/`，清零判据用 `grep -r`；② zsh 不对未加引号变量分词，门禁一律内联文件清单；③ `eslint -f unix` 本仓不可用，用默认 formatter；④ 一轮只开一个全量门禁；⑤ macOS 无 `timeout`；⑥ 否定式结论（"零消费/死文件"）必须 **import 级**取证。

---

## 第 5 节 · 收工必做（下一轮的起跑线）

1. 推进记录末追加「第 N 轮」节（≤8 条：触发/根因/落地/门禁读数/下一步）；阶段 B 首轮请新建 `docs/AI助手推进记录.md`，把本文件第 2 节批次序抄成当轮待办。
2. 认领牌 `status` 改 `released` + `lastRoundSummary` + `nextRoundMustRead`。
3. 诚实记账：没跑过的不写"可用"，自伤的记自伤。
4. **界面类改动必须附"五档圆角 × 明暗"的实测结论**，没验就不算收口。
