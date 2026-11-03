// 体裁 × 载体 → 创作元素体系（创作体系重构 P2 的单一事实源）
//
// 设计主张：体裁（genre）决定「有什么创作元素」，载体（medium）决定「元素怎么组织」。
// 一套数据模型 + 体裁术语层，不为每种体裁造表（散文篇目复用 writing-chapter）。
//
// 铁律合规：
// - 本模块只存 i18n key，不调用 t()（模块级调用 t() 会固化语言，事故先例 ×2）；
//   label 渲染一律在组件里 t(labelKey)。
// - poetry / script 为预留域：货架回落到通用元素集并明示「建设中」。

export type WritingGenre = 'novel' | 'essay' | 'poetry' | 'script';
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
  { id: 'poetry', labelKey: 'writing.genre.poetry', color: '#875b1c', ready: false },
  { id: 'script', labelKey: 'writing.genre.script', color: '#047857', ready: false },
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
    fits: ['novel'],
  },
  {
    id: 'collection',
    labelKey: 'writing.medium.collection',
    descKey: 'writing.medium.collectionDesc',
    fits: ['essay'],
  },
];

export function genreDef(genre: string): WritingGenreDef | undefined {
  return WRITING_GENRES.find((g) => g.id === genre);
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

/** 显示用 label key（未设置的旧书回退「未设置」） */
export function genreLabelKey(genre: string): string {
  return genreDef(genre)?.labelKey ?? 'writing.genre.unset';
}

export function mediumLabelKey(medium: string): string {
  return mediumDef(medium)?.labelKey ?? 'writing.medium.unset';
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

export function shelfFor(genre: string): { templates: ShelfTemplate[]; fallback: boolean } {
  const def = genreDef(genre);
  if (!def || !def.ready) return { templates: NOVEL_SHELF, fallback: true };
  if (def.id === 'essay') return { templates: ESSAY_SHELF, fallback: false };
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
