// 体裁 × 载体 → 创作元素体系（创作体系重构 P2 的单一事实源）
//
// 设计主张：体裁（genre）决定「有什么创作元素」，载体（medium）决定「元素怎么组织」。
// 一套数据模型 + 体裁术语层，不为每种体裁造表（散文篇目复用 writing-chapter）。
//
// 铁律合规：
// - 本模块只存 i18n key，不调用 t()（模块级调用 t() 会固化语言，事故先例 ×2）；
//   label 渲染一律在组件里 t(labelKey)。
// - poetry / script 为预留域：货架回落到通用元素集并明示「建设中」。

export type WritingGenre = "novel" | "essay" | "poetry" | "script";
export type WritingMedium = "serial" | "standalone" | "collection";

export interface WritingGenreDef {
  id: WritingGenre;
  labelKey: string;
  color: string;
  /** 体裁域是否已实装（未实装 = 向导里可选但置灰，货架回落通用集） */
  ready: boolean;
}

export const WRITING_GENRES: WritingGenreDef[] = [
  { id: "novel", labelKey: "writing.genre.novel", color: "#4A338F", ready: true },
  { id: "essay", labelKey: "writing.genre.essay", color: "#0ea5e9", ready: true },
  { id: "poetry", labelKey: "writing.genre.poetry", color: "#f59e0b", ready: false },
  { id: "script", labelKey: "writing.genre.script", color: "#10b981", ready: false },
];

export interface WritingMediumDef {
  id: WritingMedium;
  labelKey: string;
  descKey: string;
  /** 该载体默认适配的体裁（建书向导联动预选用） */
  fits: WritingGenre[];
}

export const WRITING_MEDIUMS: WritingMediumDef[] = [
  { id: "serial", labelKey: "writing.medium.serial", descKey: "writing.medium.serialDesc", fits: ["novel"] },
  { id: "standalone", labelKey: "writing.medium.standalone", descKey: "writing.medium.standaloneDesc", fits: ["novel"] },
  { id: "collection", labelKey: "writing.medium.collection", descKey: "writing.medium.collectionDesc", fits: ["essay"] },
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
  if (!g?.ready) return "";
  return WRITING_MEDIUMS.find((m) => m.fits.includes(g.id))?.id ?? "";
}

/** 显示用 label key（未设置的旧书回退「未设置」） */
export function genreLabelKey(genre: string): string {
  return genreDef(genre)?.labelKey ?? "writing.genre.unset";
}

export function mediumLabelKey(medium: string): string {
  return mediumDef(medium)?.labelKey ?? "writing.medium.unset";
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
  config: Record<string, unknown> = {}
): ShelfTemplate {
  return { type, labelKey, color, blank, config, genre };
}

const NOVEL_SHELF: ShelfTemplate[] = [
  tpl("novel", "writing-chapter", "writingLeft.tplChapter", "#8b5cf6", true, { volume: "", wordCount: 0, chapterStatus: "draft" }),
  tpl("novel", "writing-character", "writingLeft.tplCharacter", "#f59e0b", true, { appearances: 0 }),
  tpl("novel", "writing-worldview", "writingLeft.tplWorldview", "#10b981", true, { kind: "worldview" }),
  tpl("novel", "writing-outline", "writingLeft.tplOutline", "#0ea5e9", false),
  tpl("novel", "annotation-text", "writingLeft.tplNote", "#94a3b8", false, { text: "" }),
];

const ESSAY_SHELF: ShelfTemplate[] = [
  // 散文篇目 = writing-chapter 同表复用，仅术语不同（labelKey 指向「篇目」）
  tpl("essay", "writing-chapter", "writingLeft.tplEssayPiece", "#8b5cf6", true, { volume: "", wordCount: 0, chapterStatus: "draft" }),
  tpl("essay", "writing-outline", "writingLeft.tplEssayIdea", "#0ea5e9", false),
  tpl("essay", "annotation-text", "writingLeft.tplNote", "#94a3b8", false, { text: "" }),
];

export function shelfFor(genre: string): { templates: ShelfTemplate[]; fallback: boolean } {
  const def = genreDef(genre);
  if (!def || !def.ready) return { templates: NOVEL_SHELF, fallback: true };
  if (def.id === "essay") return { templates: ESSAY_SHELF, fallback: false };
  return { templates: NOVEL_SHELF, fallback: false };
}
