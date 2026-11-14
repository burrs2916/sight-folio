// 体裁 × 载体 → 创作元素体系（创作体系重构 P2 的单一事实源）
//
// 设计主张：体裁（genre）决定「有什么创作元素」，载体（medium）决定「元素怎么组织」。
// 一套数据模型 + 体裁术语层，不为每种体裁造表（散文篇目复用 writing-chapter）。
//
// 铁律合规：
// - 本模块只存 i18n key，不调用 t()（模块级调用 t() 会固化语言，事故先例 ×2）；
//   label 渲染一律在组件里 t(labelKey)。
// - script / diary 均已实装开闸（2026-11-09 / 2026-11-10）：不再有"预留域"这一说。
//   poetry 于 2026-11-09 实装开闸（docs/诗歌剧本体裁实装审计-2026-11-09.md：
//   闸口一开，术语/货架/页签/设计视图/AI 五层必须同时跟上，否则得到一本"小说式诗集"）。

export type WritingGenre = 'novel' | 'essay' | 'poetry' | 'script' | 'diary';
export type WritingMedium = 'serial' | 'standalone' | 'collection';

export interface WritingGenreDef {
  id: WritingGenre;
  labelKey: string;
  color: string;
  /** 体裁域是否已实装（未实装 = 向导里可选但置灰，货架回落通用集） */
  ready: boolean;
}

export const WRITING_GENRES: WritingGenreDef[] = [
  { id: 'novel', labelKey: 'writing.genre.novel', color: '#4A338F', ready: true },
  { id: 'essay', labelKey: 'writing.genre.essay', color: '#2563eb', ready: true },
  { id: 'poetry', labelKey: 'writing.genre.poetry', color: '#875b1c', ready: true },
  // 剧本于 2026-11-09 开闸（⑮-2）：幕›场结构 + 术语全链 + AI 层就位，与小说/散文/诗歌同权。
  // 唯一仍未做、且**明确等李先生批**的是正文排版（角色名居中 / 台词缩进 / 舞台指示斜体）——那是承载层。
  { id: 'script', labelKey: 'writing.genre.script', color: '#047857', ready: true },
  // 日记（diary）于 2026-11-10 开闸：一天一篇、按年月归档。
  // 这一轮**不分开闸**：术语 / 载体 / 页签 / 货架 / 统计 / 语料 / AI 一次配齐 —— 剧本当年只开了术语层，
  // AI 层留到下一刀，结果就是账上 21 号那一簇「剧本被告知自己是网文写手」的缺陷。
  { id: 'diary', labelKey: 'writing.genre.diary', color: '#9d174d', ready: true },
];

export interface WritingMediumDef {
  id: WritingMedium;
  labelKey: string;
  descKey: string;
  /** 该载体默认适配的体裁（建书向导联动预选用） */
  fits: WritingGenre[];
}

export const WRITING_MEDIUMS: WritingMediumDef[] = [
  { id: 'serial', labelKey: 'writing.medium.serial', descKey: 'writing.medium.serialDesc', fits: ['novel'] },
  {
    id: 'standalone',
    labelKey: 'writing.medium.standalone',
    descKey: 'writing.medium.standaloneDesc',
    // 剧本的默认载体也是「单本」：一出戏整体成书，不连载。说明行按体裁换成幕场口径
    // （见 CARRIER_TERM_OVERRIDES），不会顶着小说的「部章结构」。
    fits: ['novel', 'script'],
  },
  {
    id: 'collection',
    labelKey: 'writing.medium.collection',
    descKey: 'writing.medium.collectionDesc',
    // 诗集与散文集同一个载体：都是一篇一首**互不连载**地平铺，没有卷层。
    // （2026-11-09 诗歌开闸时加 poetry —— 载体词表不必为每种体裁另造一个）
    // 日记也落在这里：一天一篇、前后不要求连贯，与「集子」同构；载体名按体裁覆盖成「日记集」。
    fits: ['essay', 'poetry', 'diary'],
  },
];

export function genreDef(genre: string): WritingGenreDef | undefined {
  return WRITING_GENRES.find((g) => g.id === genre);
}

/**
 * 体裁域是否已实装 —— 渲染层「建设中」的**唯一**判据（W-0b，2026-11-10）。
 *
 * 存在的理由是一条现场账：`writingSchema` 里 script(2026-11-09) / diary(2026-11-10) 早已
 * `ready:true`，而载体设计卡另写了一份手写三支 `isCollection || genre === 'novel' || ''`
 * （`WritingDesignView.tsx:82`）→ 剧本作者点开卡片正中还是「建设中」。同一件事两处判据，
 * 开闸的人只改了一张表。这里把判据收回表本身：**改表即改行为**，渲染层不再复述体裁名。
 *
 * 与全仓一致的回落口径：空串 / 未登记值 = 旧书未设体裁 = 小说口径 → ready。
 * （注意别和 `defaultMediumForGenre` 混为一谈：那一条对未知值刻意返回空串「未指定」，
 *  问的是「该给这本挑哪个载体」，不是「这本能不能写」。两条判据问题不同，各自有测试钉着。）
 */
export function isGenreReady(genre: string): boolean {
  const def = genreDef(genre);
  return def ? def.ready : true;
}

export function mediumDef(medium: string): WritingMediumDef | undefined {
  return WRITING_MEDIUMS.find((m) => m.id === medium);
}

/**
 * 建书时按体裁取默认载体。取该体裁第一个适配的载体（novel→serial 连载 / essay→collection 篇目集）；
 * 未实装或未知体裁返回空串（= 未指定，渲染层按小说·连载兜底）。
 * 抽成纯函数是为了建书有多条入口（L1「＋」菜单、拖载体进画布、书库页）时口径只有一个。
 */
export function defaultMediumForGenre(genre: string): string {
  const g = genreDef(genre);
  if (!g?.ready) return '';
  return WRITING_MEDIUMS.find((m) => m.fits.includes(g.id))?.id ?? '';
}

/**
 * 「新建一个可写正文单位」的默认名 i18n key：散文是**篇**、诗歌是**首**，其余沿用**章**。
 *
 * 为什么要收成这一个函数：建正文单位的入口有六处（建书首篇、写作台「新建章」、正文容器「＋」×2、
 * 篇目面板、架构层面板），以前各自写死 `writing.newChapterName` —— 拖「散文」建的书第一篇就叫
 * 「第 1 章」（2026-11-08 李先生指出"点散文还是按小说走"，库里 `新建作品 3` 就是活证据）。
 * 入口多不等于口径多：命名只在这里判一次，各入口一律 `t(unitNameKey(genre), { n })`。
 * 只存 key、不调 t()（同模块铁律）。
 *
 * 未开闸的体裁（script）与未设置体裁的旧书都落在最后那条 `newChapterName` 上：
 * 剧本真正实装时（审计刀 4）再在这里加一支，不在它建不出来之前先造出一个没人走的分支。
 */
export function unitNameKey(genre: string): string {
  const id = genreDef(genre)?.id;
  if (id === 'essay') return 'writing.newPieceName';
  if (id === 'poetry') return 'writing.newPoemName';
  if (id === 'script') return 'writing.newSceneName';
  if (id === 'diary') return 'writing.newDayName';
  return 'writing.newChapterName';
}

/**
 * 书的**自动名** i18n key（N-23，2026-11-11 轮 72 续）。
 *
 * 真因取证：李先生报「点日记进去正文怎么是"第一首"」，全仓 + 真库三形扫描**零命中**，
 * 库里唯一的「第 1 首」属于那本 poetry 书 —— 问题不在体裁词串了，而在**四本书全叫
 * 《新建作品 N》**：手势型建书入口（L1「＋」/ 拖载体进画布）沿用历史自动名，书名里
 * 不含体裁，五载体在书架 / 页签 / 标题栏三处长得一个样，点错本了都看不出来。
 *
 * 与 `unitNameKey` 同族：只存 key、不调 t()，命名只在这里判一次。
 * **未设 / 脏 / 未开闸体裁一律落回 `studio.defaultBookName`**（逐字不变 = 零回归线）。
 * 体裁清单取 `WRITING_GENRES` 真源，不在这里抄第二份（列表类数组手抄必漂 = 轮 35 在册）。
 */
export function defaultBookNameKeyForGenre(genre: string): string {
  const ready = WRITING_GENRES.some((g) => g.ready && g.id === genre);
  return ready ? `studio.defaultBookName_${genre}` : 'studio.defaultBookName';
}

/**
 * 正文单位的**单字徽标** i18n key（纸面卡左边那颗方块里的字：章 / 篇 / 诗）。
 * 与 `unitNameKey` 同为"一个概念一个函数"：那是完整默认名（第 N 章），这是徽标单字。
 * 2026-11-09 之前这个三元式写在 `WritingChapterEditor` 里（唯一消费点），加体裁就得去渲染层改判据。
 */
export function unitShortKey(genre: string): string {
  const id = genreDef(genre)?.id;
  if (id === 'essay') return 'writingDesign.unitEssay';
  if (id === 'poetry') return 'writingDesign.unitPoem';
  if (id === 'script') return 'writingDesign.unitScene';
  if (id === 'diary') return 'writingDesign.unitDay';
  return 'writingDesign.unitChapter';
}

/**
 * 本体裁**不该出现**的功能视图（值 = studioBook 的 WritingViewKind 字符串；
 * 这里只回字符串数组，不 import 视图类型，免得 writingSchema 反向依赖渲染层）。
 *
 * 为什么散文要摘掉这三项：世界观 / 剧情线 / 伏笔承诺链是**连载长篇叙事**的骨架，
 * 短篇散文集既没有"世界观设定卡"也没有"伏笔—回收"的承诺关系，页签照挂就是十一个空面板，
 * 用户点开只会看到"暂无数据"，而散文真正需要的东西（篇目、立意、素材）反倒被淹在里面。
 *
 * 诗歌同一条理由，甚至更成立（2026-11-09 开闸）：诗集连"人物"都常常没有，
 * 剧情线与伏笔链更是无从谈起。**时间线留着** —— 组诗按年月编排是常见做法，
 * 李先生本轮未就时间线表态，宁可不摘多留一个页签，也不擅自替他删掉一条入口。
 * 剧本 ready=false（前端置灰、回落小说），这里不替未实现的体裁乱承诺。
 *
 * 注意：这只是**默认页签**的裁剪，不是禁止。调用方必须自己加护栏 ——
 * 书里已经建过该 kind 的视图就照常显示，绝不能让已有数据因为页签被裁而看不见。
 */
export type GenreGatedEntity = 'character' | 'worldview' | 'storyline' | 'foreshadowing';

/** 实体 → 它的家视图（值 = studioBook 的 WritingViewKind 字符串） */
const GATED_ENTITY_VIEW: Record<GenreGatedEntity, string> = {
  character: 'characters',
  worldview: 'worldview',
  storyline: 'storylines',
  foreshadowing: 'foreshadowing',
};

/**
 * 这本书的体裁**该不该长出这类关联实体**（⑲，2026-11-10）。
 *
 * 它存在的理由是一条被现场打出来的事实：⑨/⑮ 只做了「按体裁裁 L2 页签」，
 * 结果诗集作者仍能从**没被裁的入口**造出被裁掉的实体 ——
 * 时间线工具栏能「＋ 新建剧情线」（writingPanes.tsx:3527）、灵感能「⇢ 转为伏笔草稿」
 * （InspirationPanels.tsx:289）、写作台左栏能「＋ 新世界观条目」（WritingPage.tsx:2748）。
 * 建完还看不见（页签被裁），于是数据在库里长毛、UI 上一片空白。**藏视图不藏入口就是化妆。**
 *
 * 判据故意**直接查 `hiddenViewKindsForGenre`**，不再另立一张表：
 * 页签该不该出现、这类数据该不该被创建，本来就是同一个问题的两张脸。
 * 两套口径迟早漂（这已是本项目第 N 次为这句话付钱）。
 */
export function canCreateEntityForGenre(genre: string, entity: GenreGatedEntity): boolean {
  return viewKindVisibleForGenre(genre, GATED_ENTITY_VIEW[entity]);
}

export function hiddenViewKindsForGenre(genre: string): string[] {
  const id = genreDef(genre)?.id;
  if (id === 'essay' || id === 'poetry') return ['worldview', 'storylines', 'foreshadowing'];
  // 日记（李先生 2026-11-10 这一轮直接选的）：藏 世界观 / 剧情线 / 伏笔，**人物、时间线、素材、便签都留**。
  // 日记会反复提到具体的人，人物档不能藏；时间线更是日记的本体 —— 它本来就是按天排的。
  // 这一张表同时是创建闸口（canCreateEntityForGenre 只查它）：藏了页签就必须关掉入口。
  if (id === 'diary') return ['worldview', 'storylines', 'foreshadowing'];
  // 剧本只摘「世界观」这一件（⑮-2 判定，理由写在这里而不是散到渲染层）：
  // 一出戏通常不需要连载式世界观设定卡，但**人物（角色表）、剧情线（动作线）、
  // 伏笔（铺垫—呼应）、时间线（幕场时序）都是戏剧本体**，跟着诗一起摘掉就是外行。
  if (id === 'script') return ['worldview'];
  return [];
}

/**
 * 这类体裁的书**有没有这一个栏**（㊽ 入口族唯一判据，2026-11-11 轮 29）。
 *
 * 它是 `hiddenViewKindsForGenre` 的正问法，存在的理由是把「同一张表要查几次」收干净：
 * 页签该不该出现、这类实体该不该被创建、快捷卡该不该递、输入条快捷动作该不该亮 ——
 * 四张脸问的是同一个问题。前三个各有一个封装（`hiddenViewKindsForGenre` /
 * `canCreateEntityForGenre` / `aiQuickActionVisible`），第四个（输入条 chip）此前**没有封装**，
 * 于是它就成了「藏视图不藏入口」的最后一批漏口：诗集与日记的输入条上仍挂着
 * 「审情节节奏」（判据指向 storylines/foreshadowing）与「全书设定一致性」（判据指向 worldview），
 * 点了之后模型收到的是「请审视情节连贯性与伏笔回收」——替一本诗集宣布它有情节线。
 *
 * 消费点直接传它要用的那个 viewKind，不再另立一张「chip → view」映射表：
 * 表一多必漂，这是本仓写过也付过钱的结论。
 */
export function viewKindVisibleForGenre(genre: string, viewKind: string): boolean {
  return !hiddenViewKindsForGenre(genre).includes(viewKind);
}

/**
 * L2 固定页签按体裁的**顺序**表（㉳ T-B，2026-11-11 轮 34；目标态卡 §2 已定稿，零审批）。
 *
 * 裁剪（`hiddenViewKindsForGenre`）管「这栏该不该存在」，这张表管「先看见哪一栏」：
 * 十一枚页签此前全体裁吃同一份 `SceneTabBar.KIND_TABS` 顺序（2026-09-28 按功能群定稿），
 * 「正文」永远垫底 —— 而正文恰好是五种载体作者每天最先打开的那一枚。
 *
 * 三条纪律：
 * ① **只排序，不增减成员**：某 kind 该不该被裁只归 `hiddenViewKindsForGenre` 管，
 *    这张表把它收进来就是第二真源。表里没登记的 kind（含被裁护栏放行的已建视图，
 *    如散文那本建过「世界观」）一律由 `sortTabsForGenre` **排到尾部、保持原相对序**
 *    —— 数据可见性护栏优先于审美。
 * ② 诗歌「形式」、剧本「幕场结构」、日记「日历」是**还没长出来的页签**（T-C 加法刀，
 *    卡 P4 待拍），本表不给未上线的 kind 留空位；哪天真建了，加法刀同轮补槽，
 *    不许两张表各写各的。所以诗歌当前前三 = 正文·诗作·素材，日记 = 正文·条目（日历待补）。
 * ③ 未设置 / 脏体裁 → 空表 = 保持 KIND_TABS 原序（旧书零回归线，
 *    与 `hiddenViewKindsForGenre('') === []` 同形）。
 */
const TAB_ORDER: Record<WritingGenre, readonly string[]> = {
  // 前三 = 目标态卡 §2「这类作者每天先点开的」：正文 · 目录 · 剧情线
  novel: ['writing', 'catalog', 'storylines', 'characters', 'worldview', 'timeline', 'foreshadowing', 'inspiration', 'proofread', 'stats', 'overview'],
  // 正文 · 篇目 · 素材；散文用得上的（人物/时间线/校对/统计/总览）跟在后段
  essay: ['writing', 'catalog', 'inspiration', 'characters', 'timeline', 'proofread', 'stats', 'overview'],
  // 正文 · 诗作 · 素材（目标态第三枚是「形式」，T-C 落地前不落空位）
  poetry: ['writing', 'catalog', 'inspiration', 'characters', 'timeline', 'proofread', 'stats', 'overview'],
  // 正文 · 幕场 · 角色表；动作线（storylines）/ 铺垫呼应（foreshadowing）是戏剧本体，留在前段（⑮-2 同判据）
  script: ['writing', 'catalog', 'characters', 'storylines', 'foreshadowing', 'timeline', 'inspiration', 'proofread', 'stats', 'overview'],
  // 正文 · 条目（目标态第一枚是「日历」，等 P4；人物/时间线对日记都是本体，见 hiddenViewKindsForGenre 注释）
  diary: ['writing', 'catalog', 'characters', 'timeline', 'inspiration', 'proofread', 'stats', 'overview'],
};

/** 该体裁的页签顺序表；未设置/脏体裁 = 空表（不改序）。 */
export function tabOrderForGenre(genre: string): readonly string[] {
  const id = genreDef(genre)?.id;
  return id ? TAB_ORDER[id] : [];
}

/**
 * 按体裁顺序表给「带 kind 的页签数组」排序 —— **全仓唯一一份排序实现**。
 * 页签渲染与 ⌥1–9 键盘序列必须同一次调用产出：看到的顺序和按出来的顺序
 * 分叉，是这套 UI 最阴的 bug（表一多必漂，本仓付过 N 次钱）。
 * 表里没有的 kind 排到尾部并保持原相对序；空表原样返回。
 */
export function sortTabsForGenre<T extends { kind?: string }>(genre: string, tabs: readonly T[]): T[] {
  const order = tabOrderForGenre(genre);
  if (order.length === 0) return [...tabs];
  const rank = new Map(order.map((kind, i) => [kind, i] as const));
  return tabs
    .map((tab, i) => ({ tab, i }))
    .sort((a, b) => {
      const ra = a.tab.kind == null ? undefined : rank.get(a.tab.kind);
      const rb = b.tab.kind == null ? undefined : rank.get(b.tab.kind);
      if (ra === undefined && rb === undefined) return a.i - b.i;
      if (ra === undefined) return 1;
      if (rb === undefined) return -1;
      return ra - rb || a.i - b.i;
    })
    .map((x) => x.tab);
}

/**
 * AI 助手空态那六张快捷卡 → 这类书的**家视图**（㉜ AI-2，2026-11-10 轮 7）。
 *
 * 为什么需要它：`WelcomeView` 的六张卡原先是写死的，五种载体领到同一排。诗集作者
 * 会看到一张「世界观：构建或完善世界规则、文化与历史设定」的卡 —— 而诗集在
 * `hiddenViewKindsForGenre` 里 ⑮-2 就把 worldview 裁掉了。**视图不许长出来，
 * 却还递一张"我帮你建它"的卡，这是自己跟自己矛盾。**
 *
 * 判据故意只查那张页签表（与上面的 `GATED_ENTITY_VIEW` 同一口径），不再另立一张：
 * 「这类书有没有这个世界观栏」与「该不该给它一张世界观快捷卡」是同一个问题的两张脸。
 * 没登记进来的卡（续写 / 润色 / 五维诊断 / 大纲）= 五种载体都成立 → 恒可见。
 */
const AI_CARD_VIEW: Record<string, string> = {
  character: 'characters',
  world: 'worldview',
};

export function aiQuickActionVisible(genre: string, action: string): boolean {
  const view = AI_CARD_VIEW[action];
  return view === undefined ? true : viewKindVisibleForGenre(genre, view);
}

/**
 * 该体裁是否**不以人设卡为常规元素**：散文集与诗集常常压根没有人物的设定这件事。
 *
 * 用途只有一处，但必须收在这里（"体裁决定有什么创作元素"正是本模块的立场）：
 * AI 上下文别把「没有人设卡」标成数据缺陷 —— 标了只会诱导模型回一句
 * 「建议先建人设卡」，对散文/诗完全无效（2026-11-08 散文、2026-11-09 诗歌先后踩到）。
 * 小说与未设置体裁的旧书 = false，照旧标缺陷，零回归。
 */
/**
 * 「合集型」体裁：一本 = 若干互不连载的正文单位（散文的篇 / 诗歌的首）。
 *
 * 判据住这里而不是渲染层（原在 `writingPanes`，2026-11-09 归位）：它决定的是
 * "这个体裁有哪些东西"，正是本模块的立场；统计口径、语料措辞、页签裁剪都要吃它，
 * 放渲染层会让 utils 反向依赖组件。
 */
export function isCollectionGenre(genre: string): boolean {
  const id = genreDef(genre)?.id;
  return id === 'essay' || id === 'poetry' || id === 'diary';
}

/**
 * 三格 KPI（单位数 / 分组数 / 平均长度）的标签与副标 i18n key。
 *
 * 为什么又要一个函数：同一组 KPI 被 7 个面各自渲染，标签全是小说口径的字面键
 * （章节数 / 卷数 / 平均章长），散文与诗集看到的是「章节数」「卷数」——
 * 诗集里既没有章也没有卷。收成一个函数后，各面只需 `t(keys.count)`。
 * **小说沿用既有键**，一个字节都没改；未设置体裁与未开闸体裁也走这条，零回归。
 */
/**
 * 「某分组 · N 章 · N 字」那句摘要的 i18n key（⑭ 刀C）。
 * 诗集里说「3 章」是错的，但改模板形状会牵动所有调用方，所以按体裁给**同形的另一条串**：
 * 小说仍取原键 volumeSummary，渲染逐字不变。
 */
export function volumeSummaryKey(genre: string): string {
  const id = genreDef(genre)?.id;
  if (id === 'essay') return 'agent.writing.volumeSummaryPiece';
  if (id === 'poetry') return 'agent.writing.volumeSummaryPoem';
  if (id === 'script') return 'agent.writing.volumeSummaryScene';
  if (id === 'diary') return 'agent.writing.volumeSummaryDay';
  return 'agent.writing.volumeSummary';
}

export function kpiLabelKeys(genre: string): {
  count: string;
  countSub: string;
  group: string;
  groupSub: string;
  avg: string;
  avgSub: string;
} {
  const id = genreDef(genre)?.id;
  if (id === 'essay') {
    return {
      count: 'writing.pieceCount',
      countSub: 'editor.writing.stats.kpiPiecesSub',
      group: 'editor.writing.stats.kpiGroups',
      groupSub: 'editor.writing.stats.kpiGroupsSub',
      avg: 'editor.writing.stats.kpiAvgPiece',
      avgSub: 'editor.writing.stats.kpiAvgPieceSub',
    };
  }
  if (id === 'poetry') {
    return {
      count: 'writing.poemCount',
      countSub: 'editor.writing.stats.kpiPoemsSub',
      group: 'editor.writing.stats.kpiGroups',
      groupSub: 'editor.writing.stats.kpiGroupsSub',
      avg: 'editor.writing.stats.kpiAvgPoem',
      avgSub: 'editor.writing.stats.kpiAvgPoemSub',
    };
  }
  if (id === 'script') {
    // 剧本三格 = 场数 / 幕数 / 场均字数。「卷」与「章」在剧本里根本不存在
    return {
      count: 'writing.sceneCount',
      countSub: 'editor.writing.stats.kpiScenesSub',
      group: 'editor.writing.stats.kpiActs',
      groupSub: 'editor.writing.stats.kpiActsSub',
      avg: 'editor.writing.stats.kpiAvgScene',
      avgSub: 'editor.writing.stats.kpiAvgSceneSub',
    };
  }
  if (id === 'diary') {
    // 日记三格 = 天数 / 年月分组 / 日均字数。group 不复用「按上级容器归组」那句：
    // 日记的上级是**年与月**，说"容器"会让作者以为要先建卷。
    return {
      count: 'writing.dayCount',
      countSub: 'editor.writing.stats.kpiDaysSub',
      group: 'editor.writing.stats.kpiMonths',
      groupSub: 'editor.writing.stats.kpiMonthsSub',
      avg: 'editor.writing.stats.kpiAvgDay',
      avgSub: 'editor.writing.stats.kpiAvgDaySub',
    };
  }
  return {
    count: 'writing.chapterCount',
    countSub: 'editor.writing.stats.kpiChaptersSub',
    group: 'editor.writing.stats.kpiVolumes',
    groupSub: 'editor.writing.stats.kpiVolumesSub',
    avg: 'editor.writing.stats.kpiAvg',
    avgSub: 'editor.writing.stats.kpiAvgSub',
  };
}

/**
 * 工作台 AI 命令面吃哪一套（⑬ 刀A）：小说 / 未设置体裁的旧书 / 未开闸的剧本 = 'novel'
 * （现有 6 条命令逐字不变），散文 = 'essay'，诗歌 = 'poetry'。
 * 命令**定义**住在 `workbenchSlashCommands`（要带 prompt 构造函数），这里只出**判定**，
 * 免得渲染层自己写 `if (genre === 'poetry')` 长出第二份体裁分支。
 */
/**
 * 行尾「结构读数」徽标的类型（⑯-1）：诗要看形式（五言 / 十四行…），剧本要看幕场与对白结构，
 * 小说与散文没有这一层 → 空串。
 * 收在这里是为了让章表只接**一个** prop：以前是 `showPoemForm={genre === 'poetry'}`，
 * 再加体裁就会在组件里长出第二张体裁判断表。
 */
/**
 * 「 running text 里的单位名词」（⑰-1，2026-11-10 李先生：四个体裁的关键字/特别词汇要联动，
 * 不能全按小说的写）。
 *
 * 与 `unitShortKey`（徽标单字：章/篇/首/场）分开放，因为两者用法不同：
 * 徽标要一个字的量词，句子要「新建**篇目**」这种双字词。硬用一个会写出
 * 「新建章」「删除首」这种不像中文的话。
 */
export function unitWordKey(genre: string): string {
  const id = genreDef(genre)?.id;
  if (id === 'essay') return 'writing.unitWord.essay';
  if (id === 'poetry') return 'writing.unitWord.poetry';
  if (id === 'script') return 'writing.unitWord.script';
  if (id === 'diary') return 'writing.unitWord.diary';
  return 'writing.unitWord.novel';
}

/**
 * 中文**量词**（「新建一{X}开始写作」里的 X）：章 / 篇 / 首 / 场。
 *
 * 为什么不复用 `unitShortKey`：那是行尾徽标用的**体裁字**，诗歌那枚是「诗」；
 * 拿它去插量词槽会写出「新建一**诗**」这种不像中文的话（⑰-1 被自己的测试当场抓到）。
 * 徽标要说"这是什么"（诗），量词要说"怎么数它"（首）—— 两个概念，两个 key。
 */
export function unitClassifierKey(genre: string): string {
  const id = genreDef(genre)?.id;
  if (id === 'essay') return 'writing.unitClassifier.essay';
  if (id === 'poetry') return 'writing.unitClassifier.poetry';
  if (id === 'script') return 'writing.unitClassifier.script';
  // 日记的单位名是「天」，但中文数它说「一**篇**日记」—— 三个键各管一件事：
  // unitWord=日记（句中双字词）/ unitClassifier=篇（量词）/ unitShort=天（徽标）。混用会写出「新建一天」。
  if (id === 'diary') return 'writing.unitClassifier.diary';
  return 'writing.unitClassifier.novel';
}

/**
 * 「数它」槽位的词（㉱ E-A′，2026-11-11：完结导出区计数句 `published.chaptersWords`）。
 *
 * 这是第四个槽位键（unitWord=句中双字词 / unitClassifier=新建短语量词 / unitShort=徽标 /
 * **unitCount=计数句的词**）：中文恰好与 unitClassifier 同字，英文要复数形
 *（50 poems / 365 entries —— 不规则复数不许拼 "s" 糊弄）。
 * 为什么不给 published 模板开两个不同名的占位符：`publishedPackDeadKeys` ③ 钉死
 * **同一键双语占位符必须同名**（占位符名漂移 = 对端语言渲染残缺句），语言差只能在值表消化。
 * 小说支路渲染与改造前逐字相同（零回归）。
 */
export function unitCountKey(genre: string): string {
  const id = genreDef(genre)?.id;
  if (id === 'essay') return 'writing.unitCount.essay';
  if (id === 'poetry') return 'writing.unitCount.poetry';
  if (id === 'script') return 'writing.unitCount.script';
  if (id === 'diary') return 'writing.unitCount.diary';
  return 'writing.unitCount.novel';
}

/**
 * 「快照 N」标题槽位的单位名（㉱ E-A′）：中文吃 unitWord 同形的双字词（快照诗作），
 * 英文吃复数单位名（Snapshot poems）。消费点 `published.snapshotChapters`；
 * 小说两侧逐字 = 改造前旧句（快照章节 / Snapshot chapters）。
 */
export function unitNameCountKey(genre: string): string {
  const id = genreDef(genre)?.id;
  if (id === 'essay') return 'writing.unitNameCount.essay';
  if (id === 'poetry') return 'writing.unitNameCount.poetry';
  if (id === 'script') return 'writing.unitNameCount.script';
  if (id === 'diary') return 'writing.unitNameCount.diary';
  return 'writing.unitNameCount.novel';
}

/**
 * AI 对话空态那句**必须整句换**，不能插值：小说聊「剧情走向/人物动机/伏笔」，
 * 诗集问的是「意象/分行/炼字」，剧本问的是「幕场/对白/舞台指示」——
 * 拿小说那句去问诗人"你想聊哪条伏笔线"，等于告诉作者这个软件只认小说。
 * 小说一支是原文逐字保留（零回归）。
 */
export function aiChatEmptyKey(genre: string): string {
  const id = genreDef(genre)?.id;
  if (id === 'essay') return 'writing.aiChatEmptyPiece';
  if (id === 'poetry') return 'writing.aiChatEmptyPoem';
  if (id === 'script') return 'writing.aiChatEmptyScript';
  if (id === 'diary') return 'writing.aiChatEmptyDay';
  return 'writing.aiChatEmpty';
}

/**
 * `/ai` 独立页空态那句引导语（㉜ AI-2，2026-11-10 轮 7）。
 *
 * 上面那四句自 ⑰-1 起就只喂到了 `WritingAiChatDialog`（写作台里的对话弹窗），
 * `/ai` 页的空态 `WelcomeView` 一直挂着那条与体裁无关的通用串。同一个"AI 空态"
 * 长两张嘴，诗集作者换一个入口就又被问「想聊哪条伏笔线」。
 *
 * 为什么不干脆让五支都走 `aiChatEmptyKey`：小说那支的历史文案是通用串，
 * **本仓零回归线是"小说侧逐字不变"**，要换得由李先生拍板（状态文件 P9）。
 * 无书（代码项目 / 未开书）与未设体裁的旧书同样走通用串 —— 它们本来就没有体裁可说。
 */
export function aiWelcomeDescKey(genre?: string | null): string {
  const id = genre ? genreDef(genre)?.id : undefined;
  if (!id || id === 'novel') return 'agent.welcome.desc';
  return aiChatEmptyKey(id);
}

/**
 * `/ai` 六张卡的**卡面一句话**按体裁取键（㉝ AI-2b，2026-11-10 轮 9）。
 *
 * 为什么只登记 continue / polish：㉜ 把卡的数量裁对了（诗集不再领世界观卡），
 * 但每张卡的一句话仍是小说口径 —— 散文集那张「续写」写着「基于当前章节…300-600 字」。
 * 卡面话与点卡后发出去的话（`quickActionPrompts`）必须同时换词、同一批名词，
 * 只改一边就是 ㉜ 头注释里判过的那种「换一种骗法」。
 * **㉞（AI-2b′，轮 11）把 analyze / outline 两对补了进来**：它们的指令正文已在
 * `quickActionPrompts` 的 DIAGNOSE / OUTLINE 里按体裁重排，卡面这句若还留着小说的
 * 「情节破洞 / 伏笔状态 / 章节大纲」，就是同一张嘴上一轮说小说、下一轮说自己。
 * character / world 的本句不含正文单位词（角色对五种载体都成立；world 卡非小说不出现），无事生非者不登记。
 *
 * 形状沿用 `aiChatEmptyKey` 一族的既有做法：**只开覆盖、不做全表** ——
 * 未登记（含小说 / 未设 / 脏值 / 未来新卡）一律回落 `agent.welcome.${kind}Desc` 原键，
 * 小说侧渲染字节与改造前完全相同。措辞只用本体裁现成名词（篇目/诗作/场次/条目、构思/意象/梗概/要点）。
 */
const AI_CARD_DESC_OVERRIDES: Partial<Record<WritingGenre, Partial<Record<string, string>>>> = {
  essay: {
    continue: 'agent.welcome.continueDescPiece',
    polish: 'agent.welcome.polishDescPiece',
    analyze: 'agent.welcome.analyzeDescPiece',
    outline: 'agent.welcome.outlineDescPiece',
  },
  poetry: {
    continue: 'agent.welcome.continueDescPoem',
    polish: 'agent.welcome.polishDescPoem',
    analyze: 'agent.welcome.analyzeDescPoem',
    outline: 'agent.welcome.outlineDescPoem',
  },
  script: {
    continue: 'agent.welcome.continueDescScript',
    polish: 'agent.welcome.polishDescScript',
    analyze: 'agent.welcome.analyzeDescScript',
    outline: 'agent.welcome.outlineDescScript',
  },
  diary: {
    continue: 'agent.welcome.continueDescDay',
    polish: 'agent.welcome.polishDescDay',
    analyze: 'agent.welcome.analyzeDescDay',
    outline: 'agent.welcome.outlineDescDay',
  },
};

export function aiCardDescKey(genre: string, kind: string): string {
  const id = genreDef(genre)?.id;
  return (id ? AI_CARD_DESC_OVERRIDES[id]?.[kind] : undefined) ?? `agent.welcome.${kind}Desc`;
}

export function structureInspectorForGenre(genre: string): '' | 'poem' | 'script' {
  const id = genreDef(genre)?.id;
  if (id === 'poetry') return 'poem';
  if (id === 'script') return 'script';
  return '';
}

export function workbenchCommandSet(genre?: string): 'novel' | 'essay' | 'poetry' | 'script' | 'diary' {
  const id = genreDef(genre ?? '')?.id;
  if (id === 'essay') return 'essay';
  if (id === 'poetry') return 'poetry';
  if (id === 'script') return 'script';
  if (id === 'diary') return 'diary';
  return 'novel';
}

/**
 * 该体裁是否**不该**用「章均 2× / 0.3×」判体量离群。
 * 散文集与诗集里长短悬殊是体裁常态（一首短诗挨着一篇长散文不是缺陷），
 * 判出来只会满屏假预警。小说照旧判。
 */
export function outlierMeaninglessForGenre(genre: string): boolean {
  // 剧本**不在**这一列（⑮-2 判定）：诗集/散文集的长短悬殊是体裁本体，而场次体量是节奏工具——
  // 「这一场比同剧其他场短得多」在剧本里是真信号，不是满屏假预警。
  return isCollectionGenre(genre);
}

export function characterCardsOptionalForGenre(genre: string): boolean {
  const id = genreDef(genre)?.id;
  // 日记也算"人设卡非必需"：日记里的人是以"那天在场"出现的，不是先立卡再写。
  // 它决定的是 AI 别把「没有人设卡」标成数据缺陷（散文 11-08、诗歌 11-09 先后踩过）。
  return id === 'essay' || id === 'poetry' || id === 'diary';
}

/** 显示用 label key（未设置的旧书回退「未设置」） */
export function genreLabelKey(genre: string): string {
  return genreDef(genre)?.labelKey ?? 'writing.genre.unset';
}

/**
 * **喂给 AI 的 prompt** 里那个体裁名的 key（㉝ AI-2b，2026-11-10 轮 9）。
 *
 * 与上面 `genreLabelKey` 是两条不同的问题：那条问「书架/详情上把这本标成什么」，
 * 未设置要有「未设置」这一格；这条问「模型该被告知这是一本什么」—— 未登记值按全仓
 * 回落口径落小说（与 `unitNameKey` / `workbenchCommandSet` 同一族回落），
 * 空串由调用方决定不拼接（改造前旧书 prompt 里就没有这个括号，零回归）。
 * 存在的直接理由是一条现场脏读数：`AiAgentPage` 曾把 `currentBook.genre` **原样**插进
 * prompt，模型收到的是 `（poetry）` 这个 schema id，不是「诗歌」。
 */
export function genreTagLabelKey(genre: string): string {
  return genreDef(genre)?.labelKey ?? 'writing.genre.novel';
}

export function mediumLabelKey(medium: string): string {
  return mediumDef(medium)?.labelKey ?? 'writing.medium.unset';
}

/** 载体说明行的 key（与 label 同一个家：以前是渲染层自己拼 `writing.medium.${id}Desc`，加体裁覆盖就得两处同改） */
export function mediumDescKey(medium: string): string {
  const def = mediumDef(medium);
  return def ? `writing.medium.${def.id}Desc` : 'writing.medium.unset';
}

/**
 * 「体裁 × 载体」的名词覆盖表（⑮-1，2026-11-09 李先生：载体不一样、术语不一样、中英文也要区分，
 * 这些要联动起来）。
 *
 * 为什么载体也要吃体裁：载体只有三档（连载 / 单本 / 集子），但**同一种载体在不同体裁下不是同一个东西**。
 * 诗集顶着散文的「篇目集 / 独立篇目平铺 · 无卷层」，作者在建成之前那一眼里看不出自己建的是什么 ——
 * 浏览器实测：新建对话框里诗歌与散文的载体下拉都只有 `篇目集` 一项，两个体裁看起来一模一样。
 *
 * 形状只开**覆盖表**，不做全量重命名：命中才用体裁专属词，未命中一律回落该载体的通用 key
 * （= 改造前文案）。这样小说与历史散文书的读数一个字都不会变，只有新体裁拿到自己的词。
 */
const CARRIER_TERM_OVERRIDES: Array<{
  genre: WritingGenre;
  medium: WritingMedium;
  labelKey?: string;
  descKey?: string;
}> = [
  {
    genre: 'poetry',
    medium: 'collection',
    labelKey: 'writing.medium.poetryCollection',
    descKey: 'writing.medium.poetryCollectionDesc',
  },
  {
    // 剧本的「单本」不是小说的部章结构，是幕与场（⑮-2 开闸前先把词备好，避免又共用小说文案）
    genre: 'script',
    medium: 'standalone',
    descKey: 'writing.medium.scriptStandaloneDesc',
  },
  {
    // 日记不叫「篇目集」（载体只有三档，但作者要在建书前那一眼看懂自己建的是什么）
    genre: 'diary',
    medium: 'collection',
    labelKey: 'writing.medium.diaryCollection',
    descKey: 'writing.medium.diaryCollectionDesc',
  },
];

/** 当前「体裁 + 载体」该显示的那对名词 key（只存 key，不调 t()） */
export function carrierTermKeys(genre: string, medium: string): { labelKey: string; descKey: string } {
  const id = genreDef(genre)?.id;
  const hit = id
    ? CARRIER_TERM_OVERRIDES.find((o) => o.genre === id && o.medium === (medium as WritingMedium))
    : undefined;
  return {
    labelKey: hit?.labelKey ?? mediumLabelKey(medium),
    descKey: hit?.descKey ?? mediumDescKey(medium),
  };
}

/**
 * 货架模板集 = f(体裁)。渲染时按当前书 genre 取集；未设置/未实装体裁回落小说集
 * （历史上全部书都按小说域创建，回落保持零回归）。
 * type 必须已在 componentRegistry 注册；blank: true 拖出即真建档（handleDrop 消费）。
 * 术语层：essay 的 chapter 显示为「篇目」，落到同一 writing-chapter 类型。
 */
export interface ShelfTemplate {
  type: string;
  labelKey: string;
  color: string;
  blank: boolean;
  config: Record<string, unknown>;
  /** 该模板所属体裁（载体线索：左栏分区与 drop 建档的体裁感知都从这取） */
  genre: WritingGenre;
}

function tpl(
  genre: WritingGenre,
  type: string,
  labelKey: string,
  color: string,
  blank: boolean,
  config: Record<string, unknown> = {},
): ShelfTemplate {
  return { type, labelKey, color, blank, config, genre };
}

const NOVEL_SHELF: ShelfTemplate[] = [
  tpl('novel', 'writing-chapter', 'writingLeft.tplChapter', '#8b5cf6', true, {
    volume: '',
    wordCount: 0,
    chapterStatus: 'draft',
  }),
  tpl('novel', 'writing-character', 'writingLeft.tplCharacter', '#f59e0b', true, { appearances: 0 }),
  tpl('novel', 'writing-worldview', 'writingLeft.tplWorldview', '#10b981', true, { kind: 'worldview' }),
  tpl('novel', 'writing-outline', 'writingLeft.tplOutline', '#0ea5e9', false),
  tpl('novel', 'annotation-text', 'writingLeft.tplNote', '#94a3b8', false, { text: '' }),
];

const ESSAY_SHELF: ShelfTemplate[] = [
  // 散文篇目 = writing-chapter 同表复用，仅术语不同（labelKey 指向「篇目」）
  tpl('essay', 'writing-chapter', 'writingLeft.tplEssayPiece', '#8b5cf6', true, {
    volume: '',
    wordCount: 0,
    chapterStatus: 'draft',
  }),
  tpl('essay', 'writing-outline', 'writingLeft.tplEssayIdea', '#0ea5e9', false),
  tpl('essay', 'annotation-text', 'writingLeft.tplNote', '#94a3b8', false, { text: '' }),
];

/**
 * 诗歌货架（2026-11-09 开闸）：同一张 writing_chapter 表，术语换成「诗作」，
 * 第二格给的是**意象素材**而不是散文的「构思」—— 诗存的是可拼装的意象与残句，
 * 这是它和散文真正不一样的地方（散文的立意卡是一段话，诗的是若干个词/半句）。
 * 刻意**不放** 人设卡 / 世界观：那两件已在 `hiddenViewKindsForGenre` 里被摘掉，
 * 页签没有、货架却给一个拖出来建了看不见的实体，就是死条目。
 */
const POETRY_SHELF: ShelfTemplate[] = [
  tpl('poetry', 'writing-chapter', 'writingLeft.tplPoem', '#8b5cf6', true, {
    volume: '',
    wordCount: 0,
    chapterStatus: 'draft',
  }),
  tpl('poetry', 'writing-outline', 'writingLeft.tplPoemImagery', '#0ea5e9', false),
  tpl('poetry', 'annotation-text', 'writingLeft.tplNote', '#94a3b8', false, { text: '' }),
];

/**
 * 剧本货架（⑮-2）：同一张 writing_chapter 表，单位叫**场**；第二格给「场次梗概」
 * 而不是诗的意象素材 —— 戏剧存的是「这一场谁要什么、谁挡着、结果如何」，
 * 那是 outline 语义。人物卡照给：角色表是剧本的正式构成，不是可选项。
 */
const SCRIPT_SHELF: ShelfTemplate[] = [
  tpl('script', 'writing-chapter', 'writingLeft.tplScene', '#047857', true, {
    volume: '',
    wordCount: 0,
    chapterStatus: 'draft',
  }),
  // 角色表是剧本的正式构成（不是可选项）：页签保留 characters，货架就必须拖得出来，
  // 否则注释与代码分家（⑮ 之前这条注释写着"照给"而条目里没有 —— 我自己在 ⑮-2a 写的）。
  tpl('script', 'writing-character', 'writingLeft.tplCharacter', '#f59e0b', true, { appearances: 0 }),
  tpl('script', 'writing-outline', 'writingLeft.tplSceneBeat', '#0ea5e9', false),
  tpl('script', 'annotation-text', 'writingLeft.tplNote', '#94a3b8', false, { text: '' }),
];

/**
 * 日记货架：同一张 writing_chapter 表，单位叫**天**（默认标题「第 N 天」）。
 * 第二格给「当日要点」（outline 语义：今天写了什么、明天要接什么），不是诗的意象素材。
 * 人物卡照给：这一轮定的是"藏世界观/剧情线/伏笔、人物保留"，页签里有人物档，
 * 货架就必须拖得出来（剧本那次注释写着"照给"而条目里没有，是同一类自欺）。
 * 世界观不放：它已被 hiddenViewKindsForGenre 摘掉，放了就是个拖出来看不见的死条目。
 */
const DIARY_SHELF: ShelfTemplate[] = [
  tpl('diary', 'writing-chapter', 'writingLeft.tplDiaryDay', '#9d174d', true, {
    volume: '',
    wordCount: 0,
    chapterStatus: 'draft',
  }),
  tpl('diary', 'writing-character', 'writingLeft.tplCharacter', '#f59e0b', true, { appearances: 0 }),
  tpl('diary', 'writing-outline', 'writingLeft.tplDiaryMatter', '#0ea5e9', false),
  tpl('diary', 'annotation-text', 'writingLeft.tplNote', '#94a3b8', false, { text: '' }),
];

/**
 * 界面上「这一档 / 这一组 / 这一条」该叫什么 —— 槽位键表（㉓-1，2026-11-10）。
 *
 * 为什么又开一张表而不是往 `unitWordKey` 上叠：这些槽位**不是一个名词**，是十来句完整文案
 * （「已写 12 / 目标 365 章」「还没有章节——落第一章…」「插入到目标章」），
 * 它们的**占位符形状各不相同**（{n} / {chapters}+{target} / 无参）。
 * 用一个字符串函数套不住，硬套就会写出「已写 12 / 目标 365 日记」这种话。
 *
 * 关键约束（零回归的机制保证）：**表里没登记的体裁一律回落原键**。
 * 所以小说/散文/诗/剧本渲染出来的字节与改造前完全相同，只有日记拿到新串。
 * 日记的覆盖键必须沿用同一条串的占位符形状，这条写在键表旁边，改的人一眼能看见。
 */
export type SurfaceSlot =
  | 'tabUnit'
  | 'childCount'
  | 'bandGroup'
  | 'bandUnitSize'
  // ㉜ T-F′（2026-11-10 轮 8）：统计带「无组那一组」的兜底组名。前两格 ㉓-1 起就有，
  // 但一直只有 diary 登记 —— 诗集统计页因此印着「卷分布 / 未分卷」。它与前两格同族：
  // 三张嘴是同一屏的三行字，拆两轮修就会「段标题改了、组名还顶着卷」。
  | 'bandUncategorized'
  | 'statsEmpty'
  | 'unitProgress'
  | 'materialTarget'
  | 'materialInsert'
  | 'paneLabel'
  | 'paneHint'
  | 'peopleGroup'
  // ㉗ 名词补齐：分组读数 / 目标卡 / 结构按钮 / 挂单元
  | 'unitTargetLabel'
  | 'unitTargetUnset'
  | 'currentTally'
  | 'volumeStructButton'
  | 'unitListInGroup'
  | 'volumeGapNote'
  | 'groupListTitle'
  | 'groupHint'
  | 'groupEmpty'
  | 'bindUnit'
  | 'bindHint'
  // ㉗ 卷部管理对话框一族（入口按钮与对话框标题必须同一个词，见 ㉗ 交付条）
  | 'volumeStructEmpty'
  | 'volumeStructTip'
  | 'volumeStructStat'
  // ㉙ 「以当前正文单位为中心」的节题与空态（㉙ 取证：这些句子指的是这本书里的这一个单位，
  // 读者对着一条日记看到「本章大纲」就是在骗他。判据与范围见台账 ㉙ 节）
  | 'unitOutline'
  | 'unitCast'
  | 'unitScenes'
  | 'appearUnits'
  | 'relatedUnits'
  | 'unitUnattached'
  | 'unitContextTitle'
  | 'unitForeshadowTitle'
  | 'unitForeshadowEmpty'
  | 'unitForeshadowPayHere'
  | 'unitStorylinesTitle'
  | 'unitStorylinesEmpty'
  | 'unitTimelineTitle'
  | 'unitTimelineEmpty'
  | 'plantedHere'
  | 'payableHere'
  | 'mainStorylineTitle'
  | 'unitNoOutline'
  | 'unitBeatsEmpty'
  | 'openUnitInDesk'
  // ㉚ L2 页签 / 单位详情 / 载体卡副标（T-A + T-E，2026-11-10 轮 5）。
  // 为什么页签也开槽位而不是直接改 `writing.viewKind.*` 的 zh 值：
  // 那 11 条是**全局唯一**的视图名（`studioBook.openTypedCarrierView` 拿它当视图名、
  // 总览面板拿它当维度名），改值等于把小说的页签一起改掉。槽位表回落 = 小说逐字不动。
  | 'tabCatalog'
  | 'tabCharacters'
  | 'unitDetail'
  | 'designHint'
  // ㉛ L2 其余五枚 pane 的一句话引导（T-F，2026-11-10 轮 6）。
  // 为什么是五个槽位而不是给 `paneHint` 再加一位 pane 参数：`paneHint` 从 ㉓-1 起就是
  // 「大纲那一栏」的引导语，已有四体裁覆盖在册；把十枚 pane 挤进同一个槽位会让
  // `surfaceKeyForGenre` 的返回形状随 pane 变化，回落链一眼看不出漏了谁。
  // 一槽一句 = 漏一句就印小说那句，测试能逐槽点名（本轮要的正是这种点名能力）。
  | 'foreshadowingsHint'
  | 'inspirationsHint'
  | 'proofreadHint'
  | 'statsHint'
  | 'overviewHint'
  // ㉕ P14（轮 32）：工作台输入条 chip 的标签。㊽ 收了「该不该亮」，这一格收「亮着的时候叫什么」：
  // 诗集输入条顶着的「读懂本章」与 prompt 层的塌平同族，一次改完。「检查一致性 / 解释这段 /
  // 润色这段」不含单位词，不在此列；「审情节节奏」剧本保留现名（轮 30 在册决定：情节/伏笔不改）。
  // ㉢ N-20（2026-11-11 轮 72 · 李先生真人指出「日记的时间线不是按日记走的，它按天」）：
  // 时间线那一栏此前有 **7 句章字口径全体裁共用**（轴名「按章」/「绑定章节」/「未绑章」/「跳章」/
  // 时点示例「第3章」/冲突提示「跨章倒挂」/空态「绑定章节后」），它们不在槽位表里，所以 ㉓㉙ 做的
  // 55 格日记措辞**一句都盖不到这一栏** —— 这就是「措辞层全绿、界面照旧」的漏口本身。
  // 默认键 = 改造前那七条原键（逐字），日记走 writing.diary.tl* 新键；其余三体裁继续回落。
  | 'chipUnderstand'
  | 'tlAxisUnit'
  | 'tlBindUnit'
  | 'tlUnbound'
  | 'tlJumpUnit'
  | 'tlAtPlaceholder'
  | 'tlAtFieldHint'
  | 'tlConflictHint'
  | 'tlEmptyHint'
  // 洼地③（A-6 同族）：节点创作状态三档的文案（待写/草稿/已完）。此前 `writingDesign.status*` 是
  // **全局唯一**一套，五体裁都叫「待写/草稿/已完」——日记顶「待写某一天」是伪状态，诗集「已完」
  // 也不如「定稿」贴。默认键=现状那三条（小说逐字不动）；poetry/script/diary 各领本体裁词。
  | 'statusTodo'
  | 'statusDraft'
  | 'statusFinished';

/** 回落键 = 各槽位改造前就在用的那一条（小说口径原样） */
const SURFACE_DEFAULTS: Record<SurfaceSlot, string> = {
  tabUnit: 'writing.tabChapters',
  childCount: 'writingTree.chapterCount',
  bandGroup: 'writing.statsBandVolume',
  bandUnitSize: 'writing.statsBandChapterSize',
  bandUncategorized: 'writing.statsUncategorized',
  statsEmpty: 'writing.statsPaneEmpty',
  unitProgress: 'writing.bookChapterProgress',
  materialTarget: 'writing.materialTargetChapter',
  materialInsert: 'writing.materialInsert',
  paneLabel: 'writing.viewKind.catalog',
  paneHint: 'editor.writing.studioPane.storylineHint',
  peopleGroup: 'writing.characters',
  // ㉗ 目标卡三句 + 当前读数（同一张卡必须同一个单位名，漏一句就写出「章节数 / 目标 365 天」）
  unitTargetLabel: 'writing.bookTargetChapters',
  unitTargetUnset: 'writing.bookChapterUnset',
  currentTally: 'studio.bookMeta.currentTally',
  // ㉗ 结构管理入口与分组读数
  volumeStructButton: 'panel.layers.bookTitle',
  unitListInGroup: 'editor.writing.inspector.chapterList',
  volumeGapNote: 'editor.writing.inspector.volumeGap',
  groupListTitle: 'writing.volumeOverviewList',
  groupHint: 'writing.volumeOverviewHint',
  groupEmpty: 'writing.volumeOverviewEmpty',
  // ㉗ 念头分发「挂到某单元」
  bindUnit: 'writing.inspirationBindChapter',
  bindHint: 'writing.inspirationBindHint',
  volumeStructEmpty: 'panel.layers.bookEmpty',
  volumeStructTip: 'panel.layers.bookTip',
  volumeStructStat: 'panel.layers.bookVolumeStat',
  // ㉙ 二十条默认键 = 改造前五个文件实际在用的原句（写错一条就等于改了小说的文案）
  unitOutline: 'editor.writing.inspector.beat',
  unitCast: 'editor.writing.inspector.cast',
  unitScenes: 'editor.writing.inspector.scenes',
  appearUnits: 'editor.writing.inspector.appearChapters',
  relatedUnits: 'editor.writing.inspector.relatedChapters',
  unitUnattached: 'editor.writing.inspector.notAttached',
  unitContextTitle: 'writing.chapterContextTitle',
  unitForeshadowTitle: 'writing.chapterForeshadowTitle',
  unitForeshadowEmpty: 'writing.chapterForeshadowEmpty',
  unitForeshadowPayHere: 'writing.chapterForeshadowPayHere',
  unitStorylinesTitle: 'writing.chapterLinesTitle',
  unitStorylinesEmpty: 'writing.chapterLinesEmpty',
  unitTimelineTitle: 'writing.chapterTimelineTitle',
  unitTimelineEmpty: 'writing.chapterTimelineEmpty',
  plantedHere: 'writing.foreshadowPlantedHere',
  payableHere: 'writing.foreshadowPayableHere',
  mainStorylineTitle: 'writing.storylineMainTitle',
  unitNoOutline: 'editor.writing.inspector.unplanned',
  unitBeatsEmpty: 'writing.chapterBeatsEmpty',
  openUnitInDesk: 'writing.annotationRefsOpen',
  // ㉚ 四条默认键 = 改造前界面上实际在用的原句（写错一条就是改了小说的文案）
  tabCatalog: 'writing.viewKind.catalog',
  tabCharacters: 'writing.viewKind.characters',
  unitDetail: 'writing.tabChapterDetails',
  designHint: 'writingDesign.hint',
  // ㉛ 五条默认键 = `WritingStudioPane.PANE_HINT_KEY` 删除前那五句原键（抄错一条就是改了小说的文案）
  foreshadowingsHint: 'editor.writing.studioPane.foreshadowingsHint',
  inspirationsHint: 'editor.writing.studioPane.inspirationsHint',
  proofreadHint: 'editor.writing.studioPane.proofreadHint',
  statsHint: 'editor.writing.studioPane.statsHint',
  overviewHint: 'editor.writing.studioPane.overviewHint',
  // ㉕ P14：默认键 = 改造前输入条 chip 的原键（小说「读懂本章」逐字不动）
  tlAxisUnit: 'writing.timelineViewChapter',
  tlBindUnit: 'writing.timelineChapter',
  tlUnbound: 'writing.timelineUnbound',
  tlJumpUnit: 'writing.timelineJumpChapter',
  tlAtPlaceholder: 'writing.timelineAtPh',
  tlAtFieldHint: 'writing.timelineAtHint',
  tlConflictHint: 'writing.timelineConflictHint',
  tlEmptyHint: 'writing.timelineEmptyHint',
  chipUnderstand: 'workbench.aiUnderstandChapter',
  // 洼地③：默认键 = 改造前就在用的那三条全局 status 键（写错一条就是改了小说的状态文案）。
  statusTodo: 'writingDesign.statusTodo',
  statusDraft: 'writingDesign.statusDraft',
  statusFinished: 'writingDesign.statusFinished',
};

/** 按体裁的覆盖：只有「日记不是章也不是卷」这一件事需要新串 */
const SURFACE_OVERRIDES: Partial<Record<WritingGenre, Partial<Record<SurfaceSlot, string>>>> = {
  diary: {
    tabUnit: 'writing.diary.tabEntries',
    childCount: 'writing.diary.childCount',
    bandGroup: 'writing.diary.bandGroup',
    bandUnitSize: 'writing.diary.bandUnitSize',
    bandUncategorized: 'writing.diary.bandUncategorized',
    statsEmpty: 'writing.diary.statsEmpty',
    unitProgress: 'writing.diary.unitProgress',
    materialTarget: 'writing.diary.materialTarget',
    materialInsert: 'writing.diary.materialInsert',
    paneLabel: 'writing.diary.paneLabel',
    paneHint: 'writing.diary.paneHint',
    peopleGroup: 'writing.diary.peopleGroup',
    unitTargetLabel: 'writing.diary.unitTargetLabel',
    unitTargetUnset: 'writing.diary.unitTargetUnset',
    currentTally: 'writing.diary.currentTally',
    // 洼地③：日记状态三档——待记/草记/已记
    statusTodo: 'writing.diary.statusTodo',
    statusDraft: 'writing.diary.statusDraft',
    statusFinished: 'writing.diary.statusFinished',

    volumeStructButton: 'writing.diary.structButton',
    unitListInGroup: 'writing.diary.unitList',
    volumeGapNote: 'writing.diary.gapNote',
    groupListTitle: 'writing.diary.groupList',
    groupHint: 'writing.diary.groupHint',
    groupEmpty: 'writing.diary.groupEmpty',
    bindUnit: 'writing.diary.bindUnit',
    bindHint: 'writing.diary.bindHint',
    volumeStructEmpty: 'writing.diary.structEmpty',
    volumeStructTip: 'writing.diary.structTip',
    volumeStructStat: 'writing.diary.structStat',
    // ㉙ 书内视角二十条
    unitOutline: 'writing.diary.unitOutline',
    unitCast: 'writing.diary.unitCast',
    unitScenes: 'writing.diary.unitScenes',
    appearUnits: 'writing.diary.appearUnits',
    relatedUnits: 'writing.diary.relatedUnits',
    unitUnattached: 'writing.diary.unitUnattached',
    unitContextTitle: 'writing.diary.unitContextTitle',
    unitForeshadowTitle: 'writing.diary.unitForeshadowTitle',
    unitForeshadowEmpty: 'writing.diary.unitForeshadowEmpty',
    unitForeshadowPayHere: 'writing.diary.unitForeshadowPayHere',
    unitStorylinesTitle: 'writing.diary.unitStorylinesTitle',
    unitStorylinesEmpty: 'writing.diary.unitStorylinesEmpty',
    unitTimelineTitle: 'writing.diary.unitTimelineTitle',
    unitTimelineEmpty: 'writing.diary.unitTimelineEmpty',
    plantedHere: 'writing.diary.plantedHere',
    payableHere: 'writing.diary.payableHere',
    mainStorylineTitle: 'writing.diary.mainStorylineTitle',
    unitNoOutline: 'writing.diary.unitNoOutline',
    unitBeatsEmpty: 'writing.diary.unitBeatsEmpty',
    openUnitInDesk: 'writing.diary.openUnitInDesk',
    // ㉚ 页签 / 详情标题 / 载体卡副标（措辞沿用本体裁现成名词：条目、当日要点）
    tabCatalog: 'writing.diary.tabCatalog',
    tabCharacters: 'writing.diary.tabCharacters',
    unitDetail: 'writing.diary.unitDetail',
    designHint: 'writing.diary.designHint',
    // ㉛ 五句 pane 引导（日记不说「章」也不说「卷」：单位是天，分组是年与月）
    foreshadowingsHint: 'writing.diary.foreshadowingsHint',
    inspirationsHint: 'writing.diary.inspirationsHint',
    proofreadHint: 'writing.diary.proofreadHint',
    statsHint: 'writing.diary.statsHint',
    overviewHint: 'writing.diary.overviewHint',
    // ㉕ P14（轮 32）：输入条 chip「读懂本章」按体裁换词（亮不亮归 ㊽ 的页签闸，叫什么归这格）
    tlAxisUnit: 'writing.diary.tlAxisUnit',
    tlBindUnit: 'writing.diary.tlBindUnit',
    tlUnbound: 'writing.diary.tlUnbound',
    tlJumpUnit: 'writing.diary.tlJumpUnit',
    tlAtPlaceholder: 'writing.diary.tlAtPlaceholder',
    tlAtFieldHint: 'writing.diary.tlAtFieldHint',
    tlConflictHint: 'writing.diary.tlConflictHint',
    tlEmptyHint: 'writing.diary.tlEmptyHint',
    chipUnderstand: 'workbench.aiUnderstandEntry',
  },
  // ㉙-2：散文 / 诗 / 剧本的同一批"书内视角"措辞（单位词表见台账 ㉙-2）。
  // 只登记那 20 条书内视角 + ㉚ 的 5 条（页签 ×2 / 详情标题 / 载体卡副标 / 大纲 pane 提示），其余仍回落：那批是 ㉓-1 为日记做的读数措辞，
  // 另三体裁各有各的键，混进来会把已经正确的句子换掉。
  essay: {
    unitOutline: 'writing.essay.unitOutline',
    unitCast: 'writing.essay.unitCast',
    unitScenes: 'writing.essay.unitScenes',
    appearUnits: 'writing.essay.appearUnits',
    relatedUnits: 'writing.essay.relatedUnits',
    unitUnattached: 'writing.essay.unitUnattached',
    unitContextTitle: 'writing.essay.unitContextTitle',
    unitForeshadowTitle: 'writing.essay.unitForeshadowTitle',
    unitForeshadowEmpty: 'writing.essay.unitForeshadowEmpty',
    unitForeshadowPayHere: 'writing.essay.unitForeshadowPayHere',
    unitStorylinesTitle: 'writing.essay.unitStorylinesTitle',
    unitStorylinesEmpty: 'writing.essay.unitStorylinesEmpty',
    unitTimelineTitle: 'writing.essay.unitTimelineTitle',
    unitTimelineEmpty: 'writing.essay.unitTimelineEmpty',
    plantedHere: 'writing.essay.plantedHere',
    payableHere: 'writing.essay.payableHere',
    mainStorylineTitle: 'writing.essay.mainStorylineTitle',
    unitNoOutline: 'writing.essay.unitNoOutline',
    unitBeatsEmpty: 'writing.essay.unitBeatsEmpty',
    openUnitInDesk: 'writing.essay.openUnitInDesk',
    // ㉚ 页签 / 详情 / 副标 / 大纲 pane 提示（散文的两栏是**篇目 + 立意素材**，
    // 不是小说的节拍板，pane 提示再写「写每一章要发生什么：加节拍」就是骗人）
    tabCatalog: 'writing.essay.tabCatalog',
    tabCharacters: 'writing.essay.tabCharacters',
    unitDetail: 'writing.essay.unitDetail',
    designHint: 'writing.essay.designHint',
    // ㉛ 五句 pane 引导（散文平铺成篇，不说「章」；分组维度不是卷）
    foreshadowingsHint: 'writing.essay.foreshadowingsHint',
    inspirationsHint: 'writing.essay.inspirationsHint',
    proofreadHint: 'writing.essay.proofreadHint',
    statsHint: 'writing.essay.statsHint',
    // 洼地②（T-2 残余）：统计读数 6 槽。此前只有 diary 登记，essay/poetry/script 全部回落小说
    // 「章」口径（诗集统计页印「还没有章节 / 已写 X 目标 Y 章」）。照 diary 范例补登记，novel 不登记=逐字零回归。
    tabUnit: 'writing.essay.tabUnit',
    statsEmpty: 'writing.essay.statsEmpty',
    unitProgress: 'writing.essay.unitProgress',
    unitTargetLabel: 'writing.essay.unitTargetLabel',
    unitTargetUnset: 'writing.essay.unitTargetUnset',
    currentTally: 'writing.essay.currentTally',
    // 洼地③：散文状态三档刻意沿用通用词（待写/草稿/已完 = 与小说同一口径，显式登记而非漏掉）。
    statusTodo: 'writing.essay.statusTodo',
    statusDraft: 'writing.essay.statusDraft',
    statusFinished: 'writing.essay.statusFinished',
    overviewHint: 'writing.essay.overviewHint',
    // ㉕ P14（轮 32）：输入条 chip「读懂本章」按体裁换词（亮不亮归 ㊽ 的页签闸，叫什么归这格）
    chipUnderstand: 'workbench.aiUnderstandPiece',
    paneLabel: 'writing.essay.paneLabel',
    paneHint: 'writing.essay.paneHint',
    // ㉜ 统计带三张嘴（T-F′）：散文的分组维度是「分组」（写作台没有卷），单位是篇。
    // 用词与 `writingCorpus.ts:508` 同一口径（篇目 / 分组 / 未分组），界面不再各说各话。
    bandGroup: 'writing.essay.bandGroup',
    bandUnitSize: 'writing.essay.bandUnitSize',
    bandUncategorized: 'writing.essay.bandUncategorized',
   },
   poetry: {
    unitOutline: 'writing.poetry.unitOutline',
    unitCast: 'writing.poetry.unitCast',
    unitScenes: 'writing.poetry.unitScenes',
    appearUnits: 'writing.poetry.appearUnits',
    relatedUnits: 'writing.poetry.relatedUnits',
    unitUnattached: 'writing.poetry.unitUnattached',
    unitContextTitle: 'writing.poetry.unitContextTitle',
    unitForeshadowTitle: 'writing.poetry.unitForeshadowTitle',
    unitForeshadowEmpty: 'writing.poetry.unitForeshadowEmpty',
    unitForeshadowPayHere: 'writing.poetry.unitForeshadowPayHere',
    unitStorylinesTitle: 'writing.poetry.unitStorylinesTitle',
    unitStorylinesEmpty: 'writing.poetry.unitStorylinesEmpty',
    unitTimelineTitle: 'writing.poetry.unitTimelineTitle',
    unitTimelineEmpty: 'writing.poetry.unitTimelineEmpty',
    plantedHere: 'writing.poetry.plantedHere',
    payableHere: 'writing.poetry.payableHere',
    mainStorylineTitle: 'writing.poetry.mainStorylineTitle',
    unitNoOutline: 'writing.poetry.unitNoOutline',
    unitBeatsEmpty: 'writing.poetry.unitBeatsEmpty',
    openUnitInDesk: 'writing.poetry.openUnitInDesk',
    // ㉚ 页签措辞与设计卡两栏同名（诗作 / 意象素材）：`COLLECTION_PANE_KEYS` 那条注释
    // 早写过「免得设计卡叫诗作、大纲页签叫篇目」，这一刀把页签层也接上。
    tabCatalog: 'writing.poetry.tabCatalog',
    tabCharacters: 'writing.poetry.tabCharacters',
    unitDetail: 'writing.poetry.unitDetail',
    designHint: 'writing.poetry.designHint',
    // ㉛ 五句 pane 引导（诗集单位是首，不说「章」「篇」；平铺不假装有卷）
    foreshadowingsHint: 'writing.poetry.foreshadowingsHint',
    inspirationsHint: 'writing.poetry.inspirationsHint',
    proofreadHint: 'writing.poetry.proofreadHint',
    statsHint: 'writing.poetry.statsHint',
    // 洼地②（T-2 残余）：统计读数 6 槽，照 diary 范例补登记（见 essay 块注释）。
    tabUnit: 'writing.poetry.tabUnit',
    statsEmpty: 'writing.poetry.statsEmpty',
    unitProgress: 'writing.poetry.unitProgress',
    unitTargetLabel: 'writing.poetry.unitTargetLabel',
    unitTargetUnset: 'writing.poetry.unitTargetUnset',
    currentTally: 'writing.poetry.currentTally',
    // 洼地③（2A）：诗集状态三档——未起/初稿/定稿
    statusTodo: 'writing.poetry.statusTodo',
    statusDraft: 'writing.poetry.statusDraft',
    statusFinished: 'writing.poetry.statusFinished',

    overviewHint: 'writing.poetry.overviewHint',
    // ㉕ P14（轮 32）：输入条 chip「读懂本章」按体裁换词（亮不亮归 ㊽ 的页签闸，叫什么归这格）
    chipUnderstand: 'workbench.aiUnderstandPoem',
    paneLabel: 'writing.poetry.paneLabel',
    paneHint: 'writing.poetry.paneHint',
    // ㉜ 统计带三张嘴（T-F′）：诗集平铺不假装有卷（v3 §1 的「辑」分组仍是 P8 旧账，
    // 没落地就不许在标题上先声称它存在），所以这一格说「分组」；单位是首。
    bandGroup: 'writing.poetry.bandGroup',
    bandUnitSize: 'writing.poetry.bandUnitSize',
    bandUncategorized: 'writing.poetry.bandUncategorized',
   },
   script: {
    unitOutline: 'writing.script.unitOutline',
    unitCast: 'writing.script.unitCast',
    unitScenes: 'writing.script.unitScenes',
    appearUnits: 'writing.script.appearUnits',
    relatedUnits: 'writing.script.relatedUnits',
    unitUnattached: 'writing.script.unitUnattached',
    unitContextTitle: 'writing.script.unitContextTitle',
    unitForeshadowTitle: 'writing.script.unitForeshadowTitle',
    unitForeshadowEmpty: 'writing.script.unitForeshadowEmpty',
    unitForeshadowPayHere: 'writing.script.unitForeshadowPayHere',
    unitStorylinesTitle: 'writing.script.unitStorylinesTitle',
    unitStorylinesEmpty: 'writing.script.unitStorylinesEmpty',
    unitTimelineTitle: 'writing.script.unitTimelineTitle',
    unitTimelineEmpty: 'writing.script.unitTimelineEmpty',
    plantedHere: 'writing.script.plantedHere',
    payableHere: 'writing.script.payableHere',
    mainStorylineTitle: 'writing.script.mainStorylineTitle',
    unitNoOutline: 'writing.script.unitNoOutline',
    unitBeatsEmpty: 'writing.script.unitBeatsEmpty',
    openUnitInDesk: 'writing.script.openUnitInDesk',
    // ㉚ 剧本：结构那一栏是**幕›场**，人物那一栏是**角色表**（`writingDesign.genreDesc.script`
    // 与 `hiddenViewKindsForGenre` 的注释早就这么叫了，页签层是最后一处没跟上的）。
    // 剧情线/伏笔**不改**：动作线、铺垫—呼应在戏剧里本来就说得通，换了等于替用户重命名功能。
    tabCatalog: 'writing.script.tabCatalog',
    tabCharacters: 'writing.script.tabCharacters',
    unitDetail: 'writing.script.unitDetail',
    designHint: 'writing.script.designHint',
    // ㉛ 五句 pane 引导（剧本单位是场、分组是幕；「角色表」不叫「人物设定」）
    foreshadowingsHint: 'writing.script.foreshadowingsHint',
    inspirationsHint: 'writing.script.inspirationsHint',
    proofreadHint: 'writing.script.proofreadHint',
    statsHint: 'writing.script.statsHint',
    // 洼地②（T-2 残余）：统计读数 6 槽，照 diary 范例补登记（见 essay 块注释）。
    tabUnit: 'writing.script.tabUnit',
    statsEmpty: 'writing.script.statsEmpty',
    unitProgress: 'writing.script.unitProgress',
    unitTargetLabel: 'writing.script.unitTargetLabel',
    unitTargetUnset: 'writing.script.unitTargetUnset',
    currentTally: 'writing.script.currentTally',
    // 洼地③：剧本状态三档——未排/草排/排定
    statusTodo: 'writing.script.statusTodo',
    statusDraft: 'writing.script.statusDraft',
    statusFinished: 'writing.script.statusFinished',

    overviewHint: 'writing.script.overviewHint',
    // ㉕ P14（轮 32）：输入条 chip「读懂本章」按体裁换词（亮不亮归 ㊽ 的页签闸，叫什么归这格）
    chipUnderstand: 'workbench.aiUnderstandScene',
    paneLabel: 'writing.script.paneLabel',
    paneHint: 'writing.script.paneHint',
    // ㉜ 统计带三张嘴（T-F′）：剧本的分组维度是**幕**、单位是场，
    // 用词与 `writingCorpus.ts:518` 同一口径（场次 / 幕 / 未分幕）。
    bandGroup: 'writing.script.bandGroup',
    bandUnitSize: 'writing.script.bandUnitSize',
    bandUncategorized: 'writing.script.bandUncategorized',
  },
};

export function surfaceKeyForGenre(genre: string, slot: SurfaceSlot): string {
  const id = genreDef(genre)?.id;
  return (id ? SURFACE_OVERRIDES[id]?.[slot] : undefined) ?? SURFACE_DEFAULTS[slot];
}

/** 槽位的回落键（给测试与"小说零回归"对照用，不是给 UI 的捷径） */
export function surfaceDefaultKey(slot: SurfaceSlot): string {
  return SURFACE_DEFAULTS[slot];
}

/**
 * 节点创作状态（待写 / 草稿 / 已完）的文案键——**单一真源**。
 *
 * 为什么要抽：这个 status→文案 的映射此前在 `ChapterStatusDot` / `ChapterMetaPanel` /
 * `ChapterMetaControls` 三处各抄了一份（且 ChapterStatusDot 顶部注释明写"共用同一枚，禁第二份"——
 * 纪律已被破）。本函数**不接 genre**、返回完整 i18n key 由调用方 `t()` 包裹，与三处旧逻辑
 * 逐字节等价（合法值 ''/draft/finished 三档、脏值统一兜底待写），先收敛重复、为后续体裁化铺单一入口。
 */
export function statusLabelKey(status: string, genre = ''): string {
  // 洼地③第二步（2A）：按体裁取状态三档文案。genre 缺省 '' 时经 `surfaceKeyForGenre` 落 novel
  // 默认键 = 改造前逐字不变（零回归）。novel/essay 不登记=走默认；poetry/script/diary 各领本体裁词。
  const slot = status === 'finished' ? 'statusFinished' : status === 'draft' ? 'statusDraft' : 'statusTodo';
  return surfaceKeyForGenre(genre, slot);
}

/**
 * 只有这几种固定视图的名字**跟着体裁变**（㉚ T-A）：
 * 大纲 / 人物设定是叙事小说的叫法，诗集的这一栏是一首一首、剧本的这一栏是幕与场。
 * 其余九枚（世界观/时间线/剧情线/伏笔/灵感/校对/统计/总览/正文）是功能名，
 * 五种载体叫的都一样 —— 给它们各造一份词表就是"第二份真源"。
 */
const GENRE_NAMED_VIEWKINDS: Partial<Record<string, SurfaceSlot>> = {
  catalog: 'tabCatalog',
  characters: 'tabCharacters',
};

/**
 * L2 固定视图的标签键（页签、视图名、总览维度 chip **共用这一个函数**）。
 *
 * 为什么不各写各的：页签写着「幕场」、点进去视图叫「大纲」、总览维度又叫「大纲」，
 * 是同一个概念长三张嘴 —— 本仓为这种分叉付过 N 次钱（见 `canCreateEntityForGenre` 的头注释）。
 * 未登记的体裁回落 `writing.viewKind.${kind}`，小说与旧书逐字零回归。
 */
export function viewKindLabelKey(genre: string, kind: string): string {
  const slot = GENRE_NAMED_VIEWKINDS[kind];
  return slot ? surfaceKeyForGenre(genre, slot) : `writing.viewKind.${kind}`;
}

/**
 * 十枚 L2 pane 的「一句话引导」里，只有这六枚话里有正文单位词（㉛ T-F）。
 * 其余四枚（characters / worldview / timeline / storylines）的本句不含单位词 ——
 * 轮 6 逐条实测过：`charactersHint` 的「场」来自**出场**、`timelineHint` 的「辑」来自**编辑**，
 * 都不是单位词，给它们补覆盖就是无事生非。没登记的 pane 走回落键，一个字节不变。
 */
const PANE_HINT_SLOTS: Partial<Record<string, SurfaceSlot>> = {
  storyline: 'paneHint',
  foreshadowings: 'foreshadowingsHint',
  inspirations: 'inspirationsHint',
  proofread: 'proofreadHint',
  stats: 'statsHint',
  overview: 'overviewHint',
};

/**
 * pane 引导语的键（渲染层唯一入口）。
 *
 * 为什么收进这里：`WritingStudioPane` 原先自带一张 pane → i18n 键表，十句全按小说单位写死，
 * 于是诗集打开统计页读到的仍是「卷分布、章节体量」。**本函数接管后那张表整个删掉**，
 * 回落键 = 删除前的原键，小说与旧书逐字零回归（与 ㉚ 删 `SceneTabBar.labelKey` 同一个手法）。
 */
export function studioPaneHintKey(genre: string, pane: string): string {
  const slot = PANE_HINT_SLOTS[pane];
  return slot ? surfaceKeyForGenre(genre, slot) : `editor.writing.studioPane.${pane}Hint`;
}

/**
 * 这本书有没有「按日期写」的交互（㉕：只有日记有「今天」这颗按钮）。
 * 判据留在这里而不是让组件写 `genre === 'diary'` —— 渲染层不许出现体裁判据，这是本模块的立场。
 */
export function hasTodayEntryMode(genre: string): boolean {
  return writesByDateForGenre(genre);
}

/**
 * 这本书是不是「按日历日写」的（㉖）：决定统计面板给不给连续/空档/月度密度、
 * 语料要不要多给一列日期。与上面那颗「今天」按钮**同一个判据**，
 * 两个名字只是两种意图 —— 写成两份判据迟早漂（本台账反复付过学费）。
 */
export function writesByDateForGenre(genre: string): boolean {
  return genreDef(genre)?.id === 'diary';
}

export function shelfFor(genre: string): { templates: ShelfTemplate[]; fallback: boolean } {
  const def = genreDef(genre);
  if (!def || !def.ready) return { templates: NOVEL_SHELF, fallback: true };
  if (def.id === 'essay') return { templates: ESSAY_SHELF, fallback: false };
  if (def.id === 'poetry') return { templates: POETRY_SHELF, fallback: false };
  if (def.id === 'script') return { templates: SCRIPT_SHELF, fallback: false };
  if (def.id === 'diary') return { templates: DIARY_SHELF, fallback: false };
  return { templates: NOVEL_SHELF, fallback: false };
}

/**
 * 作品状态（2026-11-03 李先生报修「状态改不动、只有连载中」后定档）。
 *
 * 与体裁×载体同域，故词表就住在 writingSchema（口径唯一，不再另造模块）。
 * 同一条铁律：**本模块只存 i18n key，不调用 t()**，label 一律由组件渲染时翻。
 *
 * 历史口径（改造前）：writing_books.status 是自由字符串，全项目只有画布工作台右栏
 * 「书属性卡」一枚 ToggleButtonGroup 能写，判读处一律 `=== 'finished' ? 已完本 : 连载中`
 * 三元式 —— 于是任何新状态都会被无条件误标成「连载中」。四态落地必须先把这些三元式
 * 全部换成 bookStatusDef()，否则等于又造一个「只存不读」的字段。
 *
 * 旧值兼容（零迁移）：早期建书在后端写死 'draft'（application/writing 建书路径），
 * 新建书与未设置则为空串 —— 两者语义都是「连载中」，由 bookStatusDef 回落承接；
 * 用户动过一次状态后即落规范码，库里不需要跑迁移。
 */
export type BookStatus = 'ongoing' | 'finished' | 'hiatus' | 'abandoned';

export interface BookStatusDef {
  id: BookStatus;
  labelKey: string;
  /** MUI Chip/ToggleButton 的语义色名（走主题调色板，遵守「颜色必须用主题令牌」，不写死 hex） */
  chipColor: 'default' | 'success' | 'warning' | 'error';
  /**
   * 终态标记：已完结 / 已弃坑 = 这本书不再往前走，视觉用实心强调；
   * 连载中 / 暂停更新 = 进行态，用描边（沿用 2026-09-21 书架「finished=filled」那条视觉约定）。
   */
  terminal: boolean;
}

/** 顺序即 UI 展示顺序（书架菜单 / 写作台菜单 / 书属性卡都按此序渲染） */
export const BOOK_STATUSES: BookStatusDef[] = [
  { id: 'ongoing', labelKey: 'dashboard.statusOngoing', chipColor: 'default', terminal: false },
  { id: 'finished', labelKey: 'dashboard.statusFinished', chipColor: 'success', terminal: true },
  { id: 'hiatus', labelKey: 'dashboard.statusHiatus', chipColor: 'warning', terminal: false },
  { id: 'abandoned', labelKey: 'dashboard.statusAbandoned', chipColor: 'error', terminal: true },
];

/**
 * 状态归一：认得的规范码原样返回，其余（'' / 'draft' / 脏值 / null）一律回落「连载中」。
 *
 * 回落选「连载中」而不是「未知」有两个理由：① 与改造前三元式的判读结果逐字一致，
 * 老书零视觉回归；② 书架/顶栏没有「未知状态」这个概念，造它反而逼 UI 多一个分支。
 */
export function bookStatusDef(status: string | null | undefined): BookStatusDef {
  return BOOK_STATUSES.find((s) => s.id === status) ?? BOOK_STATUSES[0];
}

/** 判读「是否已完结」的唯一入口（替代散落的 `=== 'finished'`） */
export function isBookFinished(status: string | null | undefined): boolean {
  return bookStatusDef(status).id === 'finished';
}
