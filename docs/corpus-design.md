# 语料生产规约（corpus-design.md）

> 适用范围：Sight Folio「书场景」AI 上下文语料的全部生产路径。
> 本文档固化语料的**四层模型**、**扩展五步流程**、**字段传导路径**、**新增消费端最小动作集**与**维护铁律**，
> 是新增题材语料 / 新增消费端时必须遵守的唯一约定（同一口径不允许出现第二份实现）。

---

## 1. 语料四层模型

语料（corpus）指注入 AI 上下文的、从作品真实数据派生的**结构化文本片段**。
全程分四层，职责单向向下，**禁止跨层反向依赖**：

```text
L1 数据口径层   services/tauri 类型 + store 状态（唯一数据真源）
     │
L2 纯函数生产层 src/utils/writingCorpus.ts、writingAiCorpus.ts、writingCorpusBudget.ts
     │            （类型/纯函数，无 React/store/renderer 依赖，单测直跑）
     │
L3 组装调度层   src/ai/providers/writingContextProvider.ts、workbenchPanelHooks.ts、
     │            WritingPage.tsx（按端/场景把 L2 产物组装成可注入片段）
     │
L4 消费端       AI 分析运行器、聊天首轮注入、工作台右栏 AI 面板
```

### L1 数据口径层

- 唯一数据真源：`useWritingStore`（章节/设定/剧情线/伏笔/大纲/时间线事件）与 `services/tauri` 类型定义。
- 语料 builder **不重算第二份数据**：全部从传入的真实记录派生，字段来源只认 L1。
- 涉及 bookId 的位置一律做守卫（provider / WorkbenchChat / WritingPage 三处过滤口径一致），防多书串语料。

### L2 纯函数生产层

| 文件                               | 职责                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/writingCorpus.ts`       | 主题材语料 builder（世界观/时间线/伏笔/灵感/校对/统计/正文/一致性审查）+ 共享字段位模板 + `resolveRefs`/`buildRefIndex`/`buildChapterIndexCorpus` |
| `src/utils/writingAiCorpus.ts`     | 补充题材（人物卡/大纲骨架/聚焦设定）                                                                                                              |
| `src/utils/writingCorpusBudget.ts` | **预算单一真源**：截断上限常量 + 端 profile                                                                                                       |

- 所有 builder 都是**纯函数**，输入输出确定、零依赖（只依赖 tauri 类型与其它 utils），可单测直跑。
- 输出形态：`{ zh: string; en: string }`（多行文本）；`corpusLines()` 在 L3 按 UI 语言拆成行数组交给 `makeSection`。
- `buildChapterIndexCorpus` 输出 `{ zh: string[]; en: string[] }`（md 表格行数组），自含渲染、不依赖 ai 层 `mdTable`。

### L3 组装调度层

- **provider（AI 上下文协议侧）**：`writingContextProvider.buildPack` 按 section 清单组装（overview / active-chapter / characters / worldbuilding / timeline-storylines / foreshadowing / inspirations / proofread），统一走 `makeSection`（token 估算、digest、updatedAt 单一计算点）+ `packWithinBudget` 预算裁剪。
- **工作台右栏（UI 面板侧）**：`workbenchPanelHooks` 按题材分支调用同一批 builder（口径零第二份）。
- **写作台聊天首轮注入（WritingPage）**：复用 person/world/catalog builder，`CHAT_CONTEXT_PROFILE` 控制 token。

### L4 消费端

- AI 分析运行器（analysisRunner）、聊天面板首轮注入、工作台 AI 面板。
- 消费端**只读** L3 产出的 sections / 文本，不直接触达 L1/L2。

---

## 2. 扩展五步流程（新增一个题材语料时的标准动作）

```text
① 定口径 → ② 落 builder → ③ 补预算 → ④ 接入组装 → ⑤ 补测试并全量回归
```

### ① 定口径

- 明确：数据来源（哪些 L1 记录）、双语输出形态、截断上限（先查 `writingCorpusBudget.ts` 是否存在可复用常量）、输出与既有题材重叠处该复用哪个 builder。
- **复用优先**：人物档案用 `buildCharactersCorpus`、世界观用 `buildWorldBibleCorpus`、大纲骨架用 `buildCatalogCorpus`、章节结构用 `buildChapterIndexCorpus`——已有题材不另写第二份实现。

### ② 落 builder

- 放 `writingCorpus.ts`（主题材）或 `writingAiCorpus.ts`（补充题材），纯函数、`{ zh; en }` 输出。
- 需要引用其它实体时：关系位用 `#targetId` 形态（`expandRelations`）、正文引用用 `#id` 形态（`resolveRefs`），由调用方决定是否启用关系化解析。

### ③ 补预算

- 需要截断上限时，**先在 `writingCorpusBudget.ts` 加命名常量并复用**，禁止在 builder 内写裸数字。
- 端特有参数（如写作台聊天注入）收进端 profile（`CHAT_CONTEXT_PROFILE`）。

### ④ 接入组装

- 按消费端需求在 L3 接入：provider 加 section；工作台加题材分支；写作台加注入段。
- provider 接入链路：`buildPack` → `makeSection(key, title, priority, summary, lines, facts?)` → `packWithinBudget`。
- 接入前确认 budget 预算：新 section 的 priority/summary 是否会被预算裁剪吞掉，必要时调整。

### ⑤ 补测试并全量回归

- 单测放 `src/utils/__tests__/`（builder 直跑）+ 对应面板/provider 测试。
- 守既有断言边界：**缺省行为（不传 opts）必须与现状完全一致**；新增能力一律靠可选 opts 开启。
- 全量回归：`npx tsc --noEmit` 零错误；`npm test`（vitest run）全绿。

---

## 3. 字段传导路径（示例）

```text
writingStore.chapters / settings / storylines / timelineEvents / foreshadowings / outlines
        │ L1
        ▼
buildWorldBibleCorpus      →  人物/世界观设定总览（含结构化档案位 + relations）
buildTimelineCorpus        →  章节骨架 + 剧情线 + 事件全表 + 冲突 + 草稿（settingId→名称）
buildForeshadowingCorpus   →  伏笔开合状态 + 回收点（chapterId→章节名）
buildInspirationCorpus     →  未落章节拍（念头池）+ 待补全草稿 + 伏笔悬置
buildProofreadCorpus       →  校对体检（空章/0字完稿/过期伏笔/时间线冲突/念头池）
buildStatsCorpus           →  KPI + 卷分布 + 离群章（advisory）
buildManuscriptCorpus      →  当前章全文 + 前情提要（前 2 章各尾部 400 字）+ 骨架
buildCharactersCorpus      →  人物卡浓缩（姓名/副标题/外貌/性格/动机/口头禅/备注）
buildCatalogCorpus         →  卷 → 章节骨架 + 念头池（chapterLimit 可截断）
buildSettingCorpus         →  聚焦设定完整档案（描述 + 结构化字段 + 关系）
buildChapterIndexCorpus    →  卷章索引 md 表格（buildPack overview 用）
buildRefIndex / resolveRefs →  #id 引用 → 名称(#id)，缺失显式标注
        │ L2
        ▼
writingContextProvider（makeSection + tokenBudget + sectionDiff 打戳）
workbenchPanelHooks（题材分支）／ WritingPage（聊天首轮注入，CHAT_CONTEXT_PROFILE）
        │ L3
        ▼
AI analysisRunner / 聊天面板 / 工作台右栏   （L4 只读消费）
```

### 引用（关系化）传导

- `expandRelations`：`relations` 中 `targetId` 优先 → 输出 `#c-1` 形态（无字段则回退自由文本 target）。
- `resolveRefs(text, refIndex, lang)`：把 `#id` 解析为 `名称(#id)`；索引缺失时显式标注 `#id（引用缺失）` / `#id (missing ref)`。
- `buildRefIndex(settings, chapters, storylines)`：收集 `id → 名称`（缺失名回退 id 本身）。
- **缺省不解析**：builder 的 `opts.refIndex` 不传时保持 `#id` 原样——既有断言锁定该行为，勿改。

---

## 4. 新增消费端最小动作集

新增一个「把语料送给 AI 的入口」（端）时，最少要完成：

1. **取数对齐**：与 provider 相同口径的 bookId 守卫 + store 取数（章节/设定/剧情线等）。
2. **复用 builder**：直接调用 L2 builder，不复制实现。
3. **组装**：按端形态组装（provider 用 `makeSection`；UI 面板拆题材分支；聊天注入拼文本）。
4. **预算**：引用 `writingCorpusBudget.ts` 常量 / 端 profile；禁止新魔法数字。
5. **缺省兼容**：复用既有 builder 且不传 opts 时，行为必须与既有消费端一致（既有断言不破）。
6. **测试**：新消费端至少补一条冒烟测试（数据 → 语料 → 消费端产出），全量回归。

---

## 5. 维护铁律

1. **口径零第二份**：同一题材语料只允许一个 builder；新增消费端一律复用，禁止复制/改写。
2. **预算单一真源**：所有截断上限必须来自 `writingCorpusBudget.ts`；builder/组装点内禁止裸数字。
3. **缺省行为冻结**：`opts` 缺省值即既有断言锁定的输出；任何新能力用可选参数开启，不反向破坏旧输出。
4. **反向依赖禁止**：utils 层（L2）不得 import ai/renderer 侧（`mdTable`/`makeSection` 等在 ai 层，L2 自含渲染或仅产文本）。
5. **纯函数禁迁移**：builder 不读 store、不触发异步、不含随机；有状态需求放 L3。
6. **双语同步**：`zh`/`en` 结构同步演进，字段顺序与占位符保持一致；缺失文案用同形兜底（未命名/untitled）。
7. **引用显式化**：语料内实体引用尽量走 `#id` + `resolveRefs`，避免自由文本悬空指向；新增 builder 若引用实体，默认提供 refIndex 接入点。
8. **改前景查断言**：修改 builder 前先 grep 既有断言（`workbenchWorldBible.test.ts`、`writingCorpus.test.ts`、`writingAiCorpus.test.ts`、`writingTimeline.test.ts` 等），锁定的名字形态/兜底文案不可改。
9. **验证门禁**：任何语料改动必须过 `tsc --noEmit` + 全量 vitest；不影响无产出纯对话。

---

## 6. 现状速查（2026-09 修复后）

| 项                       | 位置                                            | 说明                                                                                     |
| ------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 主题材 builder           | `src/utils/writingCorpus.ts`                    | 12 个导出 + 共享字段模板 + resolveRefs/buildRefIndex/buildChapterIndexCorpus             |
| 补充题材 builder         | `src/utils/writingAiCorpus.ts`                  | 人物/大纲/聚焦设定（复用 writingCorpus 解析口径）                                        |
| 预算常量                 | `src/utils/writingCorpusBudget.ts`              | 语料片段上限 + `CHAT_CONTEXT_PROFILE`                                                    |
| provider overview 章节表 | `buildChapterIndexCorpus`                       | 已替换手工 mdTable（缺省行为不变）                                                       |
| 关系化引用解析           | `resolveRefs` / `buildRefIndex`                 | 已接入 timeline/foreshadowing/setting；工作台四个调用点保持缺省（文档第 3 节：可选启用） |
| 单测                     | `src/utils/__tests__/writingCorpus*.test.ts` 等 | builder 直跑 + provider / 面板契约                                                       |

---

## 7. 语料库存储与维护（书库层）

> 适用范围：Sight Folio「书场景」的**书库存储层**——`corpus_books` /
> `corpus_chunks` / `corpus_book_tags` / `corpus_book_sources` 四张表的建表、
> 重建、标签与查重口径。与上文 1-6 节的「语料生产」分层：本章管**怎么存与怎么维护**，
> 上文管**存完之后怎么组装成 AI 上下文**。

### 7.1 表结构与建表铁律

| 表                    | 用途                                 | 关键约束                                                                  |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| `corpus_books`        | 书目主表（来源/指纹/统计/镜像关联）  | `content_hash` + `simhash` 指纹列；`source_path` 记录原文件路径           |
| `corpus_chunks`       | 句级索引（含 FTS5 trigram 倒排镜像） | 删除/替换由事务内同步触发器维护 FTS，索引不残留                           |
| `corpus_book_tags`    | 多标签表                             | `(book_id, tag)` 复合主键 + `idx_corpus_book_tags_tag` 索引；空标签不落库 |
| `corpus_book_sources` | 全文镜像归档（P0-1）                 | 导入即归档抽取后的全文；重建优先用镜像                                    |

**建表铁律（只增不改，历史库必须可由升级脚本一路 CREATE/ALTER 升上来）**：

1. 只允许 **CREATE / ALTER 升级**，禁止 DROP 表、禁止删列（VACUUM 除外——见 7.4 空间回收）。
2. 新字段只能以「新增列 + 默认值」形态演进；旧数据缺列/空值为合法状态，读路径必须兼容。
3. 表间联动（标签双写、删除级联清 FTS）由 **数据库内触发器 / 事务内语句** 保证，业务层不散落第二套同步逻辑。

### 7.2 索引重建：增量跳过 + 三级回退，失败不清空

全量重建（`rebuild_corpus_index`）与单本重建（`rebuild_corpus_index(book_id)`）共用同一单本逻辑 `rebuild_one`。

**增量重建（P2-5，方案 1）**——重切分完成后先用 `book_fingerprints` 与库内 `content_hash` 比对：

- **一致 → `unchanged`（无变更跳过）**：内容未变的书直接跳过整个 replace——DELETE/INSERT chunks、刷新统计/指纹/镜像全免，落在句子侧 FTS 上的开销为零（书量上万时绝大多数书属此类，收益最大）。
- **不同 → 整体替换**；`content_hash` 为空（旧数据）时**不比对**，保守整体重建并回填指纹。

**三级回退**（决定以哪份文本重切分）：

1. **库内全文镜像优先**（P0-1）：导入时归档的 `raw_text` 直接重切分——源文件被移动/删除仍可重建，消除「孤儿书」。
2. **无镜像（旧数据）→ 读外部源文件**重抽取（`extract_text_by_path` 按扩展名分流，与导入完全同口径）。
3. **无镜像且源文件也不可用 → `skipped`（无源跳过）**：**不清空既有索引**。

**状态语义**：逐本返回 `rebuilt / unchanged / skipped / failed` 细分类（`RebuildReport`，含 `unchanged` 计数），失败/跳过原因逐本携带、进度事件透传各行状态：

- `rebuilt`：整体替换完成，携带新句子数；
- `unchanged`：有源可重建但**内容未变** → 跳过（与 `skipped` 正交，二者核算分开）；
- `skipped`：无源 / 源不可用，索引保持原样；
- `failed`：抽取 / 切分失败，索引保持原样。

重建（rebuilt 时）在事务内整体替换 chunks、刷新统计/指纹，并以新抽取文本 upsert 刷新镜像。

### 7.3 标签双写与标签维护

- **双写口径（P0-3）**：`corpus_book_tags` 表是标签**真源**；`corpus_books.category` 列是顿号连接串**镜像**（`join_tags`），保证旧前端 / 旧 LIKE 检索路径仍能命中。凡标签变更，事务内同步重算受影响书的镜像，禁止二者长期不一致。
- **导入即分类**：`import_book` 接受 `category`（单值或分隔串，与 `update_book_meta` 同口径），导入事务内同时写标签真源表与 category 镜像列——不经 `set_book_tags` 的独立写路径，避免嵌套事务/重复加锁。导入后书级 FTS（含 category 列，AFTER INSERT 触发器）自动带出分类，检索/按标签过滤/书卡展示立即生效；存量书不受影响（无 migration），未分类书可在书卡编辑补齐。
- **读路径回退**：只有 `category` 列、无标签行的旧数据，读作 `tags = [category]`。
- **维护三命令（P2-2）**：
  - `rename_corpus_tag(from, to)`：事务内 `INSERT OR IGNORE (book_id, to) SELECT … WHERE tag = from` + `DELETE` 旧标签 → 与既有 `to` 自然归并去重 → 同步镜像。返回受影响书数。
  - `merge_corpus_tags(sources, into)`：多源归并到目标，逐书 `INSERT OR IGNORE` 目标 + `DELETE` 全部源，同一本书带源和目标的收敛为单条目标标签；同步镜像。
  - `delete_corpus_tag(tag)`：解除所有书该标签并同步镜像；标签不存在时幂等返回 0。
- **计数**：`list_corpus_tag_counts` 返回 `(tag, count)` 计数降序、同计数按标签名升序；前端标签筛选栏据此显示各标签书目数，超限折叠「更多」（`MAX_VISIBLE_TAGS = 10`）。

### 7.4 查重口径与已知边界

**导入前查重**（`check_corpus_duplicate`，**只提示不阻断**）：

- 命中分级（强 → 弱）：`exact_path`（同一文件）＞ `exact_content`（归一化后全文一致）＞ `similar`（SimHash 近似，带相似度%）＞ `same_meta`（同名同作者）。
- 文件不可读 / 抽取失败时**自动降级**为「同路径 + 同名同作者」弱信号比对，不把硬错误抛给导入流程。
- 命中复用最近一次指纹缓存（键 = source_path + 文件大小 + mtime），文件未变时直接比对，避免每次导入重复全量抽取。

**全库查重**（`scan_corpus_duplicates`，只读）：书本级精确组（`content_hash` 相同 / `source_path` 同源）+ SimHash 近似组（汉明距离 ≤ `SIMHASH_NEAR_DUP_MAX_DISTANCE`）；已在精确组的书不重复进近似组。

**规模适用边界（已知边界，勿当缺陷修）**：

- 书量级建议 **&lt; 200 本**。书检索已入库 FTS：**≥3 字符走 `corpus_books_fts`（trigram 子串，覆盖书名/作者/分类）**，<3 字符（中文双字词居多）回退 LIKE（与句子分支同口径）；命中上限 `BOOK_MATCH_LIMIT = 10`。
- 书 FTS 为 external content（`content='corpus_books'`）+ 三触发器（INSERT/DELETE/UPDATE OF title,author,category）同步；表首次创建时一次性 `rebuild` 回填存量书行；**不改业务表，只 CREATE**，符合建表铁律。
- 剩余边界：书量上万后句子侧 FTS 与重建耗时才会成为瓶颈，当前几十本量级无感；检索本身不再全表扫。

**空间回收**（`optimize_corpus_storage`）：FTS5 `rebuild` + `VACUUM` 两步，回收删除残留的倒排段与文件空洞；幂等可重复执行，**不动业务数据表**。

### 7.5 端到端维护冒烟测试

`commands/corpus.rs::tests::maintenance_smoke_import_rebuild_scan_delete`：真实临时文件走通
「导入 → 单本重建 → 全库扫描查重 → 删除」全链路，断言镜像归档、陈旧索引重建恢复、
`content_hash` 精确分组、删除级联清索引/镜像。任何改动破坏上述任一环节时该测试先行失败。

### 7.6 参考价值过滤与最小索引长度

导入管线在**句级入库前**做参考价值判级（`domain/corpus/reference.rs::tier_of`），
目标是「入库的每个检索单元都对创作者有参考价值」，过滤只发生在导入/重建时，不改库表结构与检索语义。

**判级规则（保守优先，宁可保留不误伤）**：

| 层       | 判定                                                                                                                                                                                                           | 是否入库   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `High`   | 含对话引号对 / 叙事动词 / 描写意象 / 修辞词                                                                                                                                                                    | 入库       |
| `Medium` | 无显著信号但有效字符 ≥ 4 的普通完整句                                                                                                                                                                          | 入库       |
| `Low`    | 有效字符 < [`MIN_INDEX_CHARS`](=3)（长度门槛优先，带信号也不豁免）；或无信号且有效字符 < 4 的碎片；**或纯感叹词**（多字感叹短语整体命中 `EXCLAMATION_PHRASES`，如 `“我的天！”`、`“老天爷！”`、`“哎呀妈呀！”`） | **不入库** |

**最小索引长度门槛（`MIN_INDEX_CHARS = 3`，有效字符口径）**：

- 有效字符 = 汉字/字母/数字，剔除空白与标点（与信息量基准口径一致）。
- **长度门槛优先于信号**：1–2 字碎片即使携带叙事/对话信号（如 `“嗯。”`、`“好。”`、`走吧。`），
  单独成句也无索引价值，一律 `Low` 不入库——解决全文检索命中单字/双字短句的问题。
- 章标题行（`kind == "chapter"`，如「序」「第一章」）**不经此过滤，始终保留**。

**纯感叹词判定（`tier_of` 前置 Low）**：多字感叹词（`“我的天！”`、`“老天爷！”`、
`“哎呀妈呀！”` 等）含非语气字（天/爷/家/伙…），不命中噪声字符集（`ONOMATOPOEIA`），
原本走正文分支会独立成句，且因含「天」等意象/叙事子串被判 `High` 入索引，成为
无表达内容的孤立检索单元。修复：判定为**纯感叹词**（剥离引号/标点/空白后整体精确命中
[`EXCLAMATION_PHRASES`](`reference.rs`) 短语表，如「我的天」「天哪」「哎呀妈呀」）→ 在信号
判定之前直接 `Low` 不入库；带正文的感叹句（`“哎哟，这可不得了。”`）剥离后为整串
≠ 短语，不被误伤，仍按合并后完整单元判级入库。短语表（`EXCLAMATION_PHRASES`，
含 天哪/我的天/老天爷/哎呀妈呀/好家伙 等常见多字感叹）在 `reference.rs` 中维护，
保守收编、只增不减，语料新增感叹形式时按「整体精确命中」口径追加。

**先合并、后判级**：判级发生在管线路径末端，短句合并（`MIN_MERGED_CHARS`）、
独立语气行/感叹词行并入后续正文（`pending_tone` 缓冲）等所有合并动作**之前**的碎片不参与判级。
只有「再也无法并入」的最终单元（EOF / 章标题前 / 后续语气行前孤立落库）才进入 `tier_of`：

- 能并入正文的语气行（`“嗯。”` + 正文）或感叹词行（`“我的天！”` + 正文）→
  合并为一个完整单元，按合并后的单元判级（观点：感叹词不独立成句，并入正文才有检索价值）；
- 无法并入的孤立语气行（如文末孤立的 `“嗯。”`）→ 判级为 `Low`，不入库；
- 无法并入的孤立感叹词行（如文末孤立的 `“我的天！”`）→ 纯感叹判定 `Low`，不入库；
- 普通正文短行（如 `走吧。`）若后无正文可并 → 判级 `Low`，不入库；
  若后跟正文且合并后有效字符达标 → 保留合并单元。

**存量生效方式**：过滤在**导入/重建时**执行，仅对新建或重建的索引生效。
存量书库中已入库的历史短句不自动消失，需执行一次全量重建
（`rebuild_corpus_index`，`book_id` 为空则重建全部书，命令空跑返回
`RebuildReport`）重切分并重新判级后，历史 `Low` 碎片即被剔除；
不重建不影响检索正确性（检索语义不变，只是旧短句仍在）。

### 7.7 噪声行扩展与章标题净化（句子级优化，2026-09-27）

基于斗破苍穹存量库（102423 chunk）实证定位的薄弱场景，导入期噪声判定与
章标题识别各做一类加固，**只作用于导入/重建时**，不改变既有机制行为：

**① 作者更新注匹配扩展到方括号（`is_noise_text` ③ 分支）**：

- 原规则只认 `（`/`(` 开头，漏掉网文常见的 `【…】` 作者注行
  （`【三更合一，包括了五百票的加更！`、`【拉推荐票！`、
  `【第三更到，呐喊一声，月票~~~！` 等，存量 16 条）。
- 现纳入 `【`/`[` 开头，沿用「前 12 字符含 更/票/订/求/爆/PS」的保守条件；
  存量实证 `【` 开头正文（如 `【系统提示】…`）前 12 字符不含这些词，不误伤。
- 求票短语新增变体前缀：`求保底月票`、`求声保底月票`、`求一声月票`、`求五百票`
  （补齐 `求月票/求收藏/求推荐/求订阅/求点击` 的 `starts_with` 盲区）。
- 卷标/版权行：`VIP卷`/`VIP 卷` 前缀、`版权信息`（精确等值）判噪声；
  不采 `starts_with("版权")`，避免误伤 `版权归作者所有` 类正文说明。

**② 章标题识别：允许感叹/问号/逗号，并剥离尾随【作者注（`clean_chapter_heading`）**：

- 原规则「含任一 `。！？…，、；` 即不判标题」把真实标题当正文——存量实证
  482 条带感叹/问号的标题（`第七章 休！`、`第五十章 帮？`），以及
  36 条含逗号的标题（`第一百八十章 曾经的十大强者，冰皇！`）被误入正文句子。
- 现改为：符合「第X章/回/节/卷/部/篇」「Chapter N」「卷章关键词」结构后，
  仅拦截**正文句子终结标点**（`。` `…` `；`）；感叹/问号/逗号/顿号是标题合法
  组成部分，放行（守卫 `第一章的内容很精彩，值得一看。` 因含句号仍被拒判）。
- 新增 `strip_author_note`：从第一个 `【` 起截断，章节标题行混挂的作者注尾巴
  （`第三百零八章 过于简单的第二轮【这算是第一千票的加更吧。`，存量 408 条）
  剥离后按**净标题**入库，作者注内容不再混入标题文本；
  存量实证无 `第X章【标题】` 紧贴形态，剥离安全。
- `parse_text` 的章标题分支改走 `clean_chapter_heading`：`current_chapter`
  与 chapter chunk 的 `content` 均使用剥离后的净标题，句子归属与 tier 契约不变
  （章标题恒 `High`）。

**存量生效方式**：同上，需对存量库执行一次全量重建（`rebuild_corpus_index`）
后，历史误入正文的章标题行、`【` 作者注行、求票行才会按新规则重分类；
不重建不影响检索正确性。

### 7.8 作者附言行首模板（句子级优化，2026-09-27 第二轮）

基于重建后存量库（101080 chunks）实证定位：**裸行首「PS:」系附言、起点章尾
广告、整行圆括号包裹的独立作者附言**此前全量漏网入库（镜像层 250 条，
sentence chunk 残留 220 条）。新增 `is_noise_text` ⑤ 分支（不依赖括号开头、
不改变既有 ①–④ 行为）：

**① 裸行首「PS:」系附言**：

- 原规则仅在 `（/(`/`【`/`[` 开头的③分支内查 `PS`/`ps`，**裸 `PS:` 行首完全不命中**
  ——存量实证 141 条全量入库（`PS:一点左右还有更新。)`、`PS:郑重的推荐一本书:医狂天下…`等）。
- 现按行首前缀判定：`PS:`/`PS：`/`ps:`/`ps：`/`Ps:`/`Ps：`/`pS:`/`pS：`/
  `再PS:`/`再PS：`，全部为作者更新说明/求票/推书，正文不以此起头。

**② 起点章尾广告模板**：

- `新书大主宰已发。`（8 字符短行 × 2）与 79 字符长模板
  （`新书大主宰已发,起点中文网首发,…您的支持,就是我最大的动力。)`）——
  长模板超 ④ 短行门槛（≤60 字符）漏网，现按行首前缀 `新书大主宰已发` 拦截；
- `新书开张,请大家收藏与推荐新书,感谢。` 按行首前缀 `新书开张,请大家收藏`
  拦截。守卫：作者感言正文 `新书开张了,不知不觉,…` 前缀为 `新书开张了`，
  不匹配「新书开张,」，保留入库。

**③ 整行圆括号包裹的独立作者附言**：

- 行首 `(`/`（` 且行尾 `)`/`）` 判噪声——作者用整行圆括号括注的固定排版形态
  （`(请诸位看完后,顺手投几张推荐票吧,谢了。)`、`(晚上还有。)`、`(抱歉,晚了点!)`)），
  存量实证 106 条全量人工核查均为作者言/求票/勘误/请假，无正文误伤；
- 守卫：未闭合括号的正文内心独白（`(杀?还是不杀?`、`(高潮终于即将来到!`）
  不以 `)`/`）` 收尾，不命中；与正文同行的括号附言
  （`“本殿倒是想要见识一番…” (忘记作者专区的账号密码了…`）不在行首模板
  定位范围，保持现状（存量 2 条，重建前即有，非本轮引入）。

**存量生效方式**：备份后全量重建（`rebuild_corpus_index`，book_id 为空）。
本轮重建实测：chunk 101080 → **100800**（-280），`PS:`/`新书大主宰已发`/
整行圆括号附言 0 残留；正文独白与作者感言保留；`第七章 休`、`曾经的十大强者`、
`八极崩` 等正文检索不缩水。

### 7.9 书外运营词与电子书版权门户行（句子级优化，2026-09-27 第三轮）

基于重建后存量库（100800 chunks）实证定位：**书外运营词行（月票/推荐票/订阅）
与电子书版权门户行**此前全量漏网。新增 `is_noise_text` ⑤ 分支 ⑤d/⑤e
（纯行级 contains/行首前缀判定，不改变既有 ①–④ 与 ⑤a–⑤c 行为）：

**⑤d 书外运营词整行拦截**（`OPERATION_WORDS = ["月票", "推荐票", "订阅", "票票"]`）：

- 判定为**整行含有任一运营词**即判噪声（不要求行首/行尾边界）——存量实证
  求票残留 56 条中 53 条命中运营词子串，另 3 条（`兄弟姐妹们,拜求给力…`、
  `被一票票的拉近…`、`投上一票票!!!)`）由 `票票` 兜住；
- 合并去重后存量影响 **376 条**（含 31 条求月票/7 条求推荐/1 条求订阅及
  `(新的一周…丢几张推荐票吧…` 等括号内运营词行），chunk 长度 min=6/avg=39.4/max=170
  ——max 为长句作者附言（`另外,月票已经被超了,土豆码字都是心急如焚…`），非正文；
- **误伤守卫实证**：正文 `打包票`/`售票台`/`票单`/`投票`/`得票` 等"票"字
  用法均不含运营词子串，重建后 LIKE 命中 打包票 6/售票台 2/一票 20/投票 5/
  得票 1/票单 2，**零正文损失**。
- **放弃的候选判据**（误伤风险不可接受）：
  - 行首 `(` 大类（91 条几乎全为作者附言），但 `(杀?还是不杀?`、
    `(高潮终于即将来到!` 等约 4 条为正文内心独白，误伤边界难可靠界定
    ——仅吸收其中含运营词的行，保留既有 7.8 未闭合括号独白规则；
  - `土豆` 判据（313 条中含 `土豆道:`/`土豆说:` 等 14 条疑似正文人物动作）；
  - `拜求` 判据（正文敬语风险、仅覆盖 3 条漏网，收益低）。

**⑤e 电子书版权门户行**（行首前缀模板）：

- `t.starts_with("本书版权由") || t.starts_with("版权所有，未经书面许可") ||
t.starts_with("此电子书由")`——存量 4 条门户行（`此电子书由公众号：三秋君分享`×2、
  `本书版权由上海阅文信息技术有限公司提供。`、`版权所有，未经书面许可，不得转载、
复制，违者必究`），与运营词 0 重叠，合计净增量 **380 条**；
- **根因闭环**：纯数字 chunk `2016`（id=318505，版权页「…提供。2016」同行
  句号破句产物，整行非纯数字放行 → 切句后才出现 `2016`、不复检）。加
  `本书版权由` 行首前缀后整行拦截，`2016` 随行消失，**无需单独处理纯数字**；
- 门户/社群词扫描：公众号 2/QQ 2/贴吧 1/威信 4（正文 `威信/权威`）等无规模化
  残留，不纳入；`群` 907 条全为正文量词，排除。

**存量生效方式**：备份后全量重建（`rebuild_corpus_index`，book_id 为空）。
本轮重建实测：chunk 100800 → **100400**（-400；按行预估 380，差值来自
短行合并/多句一行等重建口径差异），sentence 96317 + chapter 4083；
`月票`/`推荐票`/`订阅`/`票票`/`本书版权由`/`此电子书由`/`版权所有，未经
书面许可` 与 `2016` 破句残留全部 **0**；`打包票` 等正文"票"字用法检索不缩水
（FTS 与业务表 row 数一致，tokenizer 行为与重建前基线相同）。

## 8. mobi 解析链路修复与重导基线（2026-10-08）

### 8.1 问题与修复

- **根因**：mobi `palmdoc_decompress` 移植自上游（LZ77 变种），其对畸形输入
  `offset % text_pos`（text_pos == 0）会除零 panic → 异常记录被截断为 3% 尾块，
  全书 18,993,859 解压字节只取到 ~48.9 万字节（约 15.7 万字 / 445 chunk）。
- **修复点**（`src-tauri/src/commands/corpus.rs`）：
  - `palmdoc_decompress`：text_pos == 0 时按距离 0 处理（防御，不 panic）；
    去除 record 头部残留尾字节（UTF-8 半字符污染）。
  - `decode_mobi_text`：容错 UTF-8 —— 合法 UTF-8 直接返回；跨 record 截断造成的
    lossy 替换字符占比 ≤5% 判为 UTF-8 并清洗 `\u{FFFD}` 残片；GBK（CJK 占比 ≥20%）
    与 CP1252 依次兜底；不可解码时明确报错而非静默乱码。
  - `html_to_text`：逐字符剔除 CR（HTML 空白归一化，旧实现残留 `\r` 并污染尾部
    分句）；遇 `</body>`/`</html>` 闭合后停止收集文本（丢弃源文件在文档边界后的
    尾部垃圾，如 `\x00d Bbody>` 残杂质）。

### 8.2 重导实测（斗破苍穹 mobi，全书 26 卷）

- 解压字节 18,993,859（与修复前基线一致）→ 正文文本 14,695,811 字符。
- 切分：**chunk 90,680 = chapter 4,537 + sentence 86,143**，word_count 5,117,274；
  over_5000chars=0 无超长块；min=5 / avg=58 / max=407，无 ≤2 字碎片。
- 质量校验：无 `\u{FFFD}` 替换符、无 NUL/CR 控制字符残留、无 `Bbody` 垃圾句；
  章标题覆盖至 1,6xx 章（含目录页/卷目录重复识别，为 mobi 结构固有现象）；
  正文结尾为作者完本感言，内容完整无截断。
- **与 7.9 节 100,400 / 96,317 / 5,109,253 的差异说明**：7.9 基线为修复前旧源
  （txt 物理行粒度 / 旧切分规则）实证；本版为 mobi（HTML 块级标签补行粒度）+
  修复后链路 + 章标题识别增强（目录行/无单位短标题进 chapter）的实测结果，
  同书同位（字量差 0.16%），chunk 差异属来源与规则口径不同，**非丢章/丢文**。
- 语料检索口径（FTS5 trigram）：≥3 字走 FTS 命中正常（如「斗气大陆」346 条）；
  2 字及以内须走 LIKE 子串兜底（trigram 对 2 字查询必然 0 命中，属预期）。
