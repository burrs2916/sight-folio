// canvasAssistant —— 工作室画布 AI 助手（H3「AI 修改优化画布」）。
//
// 与 writingAssistant 同款无头执行器模式：开会话（不抢 AI 页前台）→ sendMessage
// → 拉取最终回复。区别在于输出契约：AI 不直接改画布，而是返回**结构化操作数组
// （CanvasAiOp）**，由前端解析 → 用户预览确认 → 走 editorStore 正规 API 应用。
//
// 三条铁律：
//   1. AI 永远拿不到画布写通道（无后端 ai_edit 工具），越权操作天然不可能；
//   2. 一切修改必须先预览、经用户点击「应用」才生效（平台不擅自改用户的作品）；
//   3. 应用前自动快照，一键「撤销本次」恢复 —— 不依赖 editorStore 历史，
//      ops 多步应用后仍能一步回到应用前状态。
import { useAgentStore } from '../store/agentStore';
import { useWritingStore } from '../store/writingStore';
import { agentApi } from '../services/tauri';
import { useEditorStore } from '../store/editorStore';
import { L } from './aiLang';
import { getLang, t } from '../i18n';
import { canCreateEntityForGenre, genreTagLabelKey, hiddenViewKindsForGenre, workbenchCommandSet, type GenreGatedEntity } from '../utils/writingSchema';
import { quickActionTermsFor, type GenrePromptVariant } from './quickActionPrompts';
import { parseBookIdFromScene } from '../utils/studioBook';

// ─── 操作协议 ───────────────────────────────────────────────

export type CanvasAiOp =
  | { op: 'move'; id: string; x: number; y: number }
  | { op: 'resize'; id: string; width: number; height: number }
  | { op: 'rename'; id: string; name: string }
  | { op: 'set_text'; id: string; text: string }
  | { op: 'remove'; id: string }
  | {
      op: 'add';
      type: string;
      name: string;
      x: number;
      y: number;
      width?: number;
      height?: number;
      text?: string;
    }
  | {
      op: 'arrange_grid';
      ids: string[];
      startX?: number;
      startY?: number;
      columns?: number;
      cellWidth?: number;
      cellHeight?: number;
      gapX?: number;
      gapY?: number;
    };

/**
 * AI 可以新增的实体类型（白名单：全是写作语义卡，杜绝 AI 造图片路径/代码实体）。
 * 2026-10-31 第十四轮补 writing-worldview：世界观与人物、大纲同为写作台 L2 三大
 * 设定支柱（characters/worldview/catalog），此前唯独 AI 加不了世界观卡 —— 用户让
 * 画布 AI「把主要世界观设定也铺几张卡」会静默失败（normalizeOp 白名单校验丢弃）。
 * writing-worldview 已在 writingAnalyzer manifest 注册，addComponent 正规落地。
 */
export const AI_ADDABLE_TYPES = ['writing-character', 'writing-worldview', 'writing-outline', 'annotation-text'] as const;

/* ── ㉨ AI-6″（2026-11-10 轮 21）：add 白名单按体裁裁 ─────────────────────────
 *
 * 病灶（状态文件 §队列 AI-6″，轮 19 交账时用新证据抓出）：上面那张 `AI_ADDABLE_TYPES` 是
 * **全局常量、不吃体裁**。于是同一本书的四道闸口里，只有画布 AI 这一道是开的——
 *   · L2 页签：`SceneTabBar.tsx:245` 按 `hiddenViewKindsForGenre` 裁掉 worldview；
 *   · 现场建视图：`studioBook.ts:641` 同一张嘴直接 return；
 *   · 货架/右栏拖源：`writingSchema.ts:594` 的世界观模板只登记在 novel 支，`writingPalette.ts:146`
 *     的 WORLDVIEW 条目只存在于 worldview 视图里（那四支根本开不出这个视图）；
 *   · 写作台左栏「＋ 新世界观条目」：`WritingPage.tsx:2789` 吃 `canCreateEntityForGenre`。
 * 而画布这边 `:290/:296/:297` 把 worldview 逐字端给模型、`normalizeOp` 按同一枚全局表放行 ——
 * 模型真能给一本诗集铺一张世界观卡。这正是轮 7 判过的「一边锁门一边发钥匙」的第三张脸。
 *
 * 轮 19 留的**待验项本轮取证完毕**（不许拿注释当结论）：这张卡在 L1 画布上**并非不可见**——
 *   `editor/sceneEditor/renderers.tsx:58` 无条件把 writing-worldview 映射到 WritingWorldviewRenderer，
 *   双击跳转 `canvasEntityNode.tsx:248-302` → `openWritingDesk({bookId, settingId})` →
 *   `WritingPage.tsx:804-808` 落 leftTab='settings'，而那条列表**按数据可见性护栏不裁**
 *   （`WritingPage.tsx:2786` 原话：「只关新建口；已有条目照旧列出」）。
 * 所以这一刀的定性**不是**「拦住库里长毛的死数据」，而是⑲/⑳ 那条更根本的口径：
 * **这本书的体裁不该长出这类实体，就不该存在任何一条创建路径**——AI 也是创建路径。
 *
 * 判据零新表：只查现成的 `canCreateEntityForGenre`（它自己只查 `hiddenViewKindsForGenre`），
 * 与页签表、创建闸、货架、上下文块共用同一张嘴。
 */
/** add 白名单里哪些 type 对应一个**受体裁闸口管**的实体（type → `canCreateEntityForGenre` 的 entity 名） */
const ADDABLE_GATED_ENTITY: Partial<Record<(typeof AI_ADDABLE_TYPES)[number], GenreGatedEntity>> = {
  'writing-worldview': 'worldview',
};

/**
 * 这本书的体裁下 AI 真能新增的 type。被裁实体**不进白名单**：
 * 规则句端的就是这张表（模型看不到 = 不会去造），校验层也按这张表放行/丢弃（模型硬造 = 丢，
 * 且计入 `dropped`，界面「忽略 N 条无效」明示，不静默）。
 * 小说 / 未设体裁旧书 / 脏值 = 判据回落，返回**完整四枚、顺序不变** = 改造前逐字。
 */
export function aiAddableTypesForGenre(genre: string): readonly string[] {
  return AI_ADDABLE_TYPES.filter((type) => {
    const gated = ADDABLE_GATED_ENTITY[type];
    return gated === undefined || canCreateEntityForGenre(genre, gated);
  });
}

/**
 * 各可新增/改写文字时**真正被渲染器读到的主字段**（与 writingAnalyzer manifest
 * properties + WritingPropertyPanel primary 字段同一口径）：
 *   character / worldview 的主字段是 name，outline 是 title，便签是 text。
 * 旧实现把 set_text/add text 一律落到 `title`（无则 `text`），对 character/worldview
 * 落到无人读的 config.text → 文字静默不显示（确定的 bug）。按类型对齐主字段。
 */
function primaryTextKey(type: string): string {
  switch (type) {
    case 'writing-character':
    case 'writing-worldview':
      return 'name';
    case 'writing-outline':
      return 'title';
    default:
      return 'text';
  }
}

const MAX_OPS = 60;

// ─── 画布快照（喂给 AI 的清单）──────────────────────────────

export interface CanvasSnapshotItem {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 卡片主要显示文字（title/text/fileName 的第一个非空者） */
  text: string;
}

export function captureCanvasSnapshot(): CanvasSnapshotItem[] {
  return useEditorStore.getState().components.map((c) => {
    const cfg = (c.config ?? {}) as Record<string, unknown>;
    // 主字段优先级补 name：character/worldview 卡的名字在 config.name，旧提取漏了
    // name，喂给 AI 的人物/世界观卡「文字」恒为（无），add/rename 贴合度打折。
    const text =
      [cfg.title, cfg.name, cfg.text, cfg.fileName].filter(
        (v): v is string => typeof v === 'string' && v.trim().length > 0,
      )[0] ?? '';
    return {
      id: c.id,
      type: c.type,
      name: c.name,
      x: Math.round(c.transform.x),
      y: Math.round(c.transform.y),
      width: Math.round(c.transform.width),
      height: Math.round(c.transform.height),
      text: text.slice(0, 60),
    };
  });
}

// ─── 写作上下文（H3 缺口②：AI 面板挂写作语境）────────────────

/* ── ㉤ AI-6（2026-11-10 轮 17）：画布助手的体裁接管 ──────────────────────────
 *
 * 病灶（状态文件 §队列 AI-6，轮 13 交账时用新证据抓出）：本文件**整体不吃体裁**——
 * 【作品】行把 `book.genre` 的 schema id 原样插进 prompt（模型收到的是 `(poetry)` 不是「诗歌」，
 * 轮 9 点名的脏读数同族第五例）；进度行的栏名与量词是写死的小说腔（那是全仓第五枚裸进度栏）；
 * 人物/大纲两枚栏题也是小说词；人设那一句从建文件起就把载体写死成小说——诗集作者的画布
 * 收到的是「你在给小说排版」。
 *
 * 修法沿用轮 9-13 一族，**零新判据**：显示名走 `genreTagLabelKey`（轮 9），单位词与栏题走
 * `quickActionTermsFor`（轮 9/12/13 现成格 + 本轮补的四格），人设名词走 `workbenchCommandSet`
 * 穷尽 Record。回落线不变：未设 / 空 / 脏体裁值一律落小说格 = 改造前逐字。
 *
 * 栏题英文侧（`[Characters]` / `[Outline]` / `[Worldbuilding]`）**有意不换**：这三个词是
 * 语种中立通名，不像中文「人物档案/大纲节拍」那样自带小说腔——与轮 13 对 en 进度行
 * 「无物可换 = 无事生非不登记」同一条判据。
 */

/** 人设句里的载体名词（zh 值逐支 = `genreTagLabelKey` 那四枚现成体裁键的显示值；en 侧 ⊂ `personaWords` 现成名词，novel = 改造前逐字） */
const CANVAS_PERSONA_NOUN: Record<GenrePromptVariant, { zh: string; en: string }> = {
  novel: { zh: '小说', en: 'novel-writing' },
  essay: { zh: '散文', en: 'prose-essay' },
  poetry: { zh: '诗歌', en: 'poetry' },
  script: { zh: '剧本', en: 'playwriting' },
  diary: { zh: '日记', en: 'journal' },
};

/**
 * 硬性规则第 7 条的「贴合对象」清单 —— 规则句只准点名**上下文块里真会端出去的东西**。
 * 轮 17 已按 `hiddenViewKindsForGenre` 把【世界观设定】整段对四支闸掉，而规则句照旧叫模型去贴合
 * 世界观那一头 = 轮 7 判过的「一边锁门一边发钥匙」，只是换了第二张嘴（状态文件 §队列 AI-6′ ①）。
 * zh 侧四格全部由 `PromptTerms` 现成栏题拼出（人物卡 / 角色表 × 构思 / 意象素材 / 场次梗概 /
 * 当日要点），**零自创词、零新词表**；en 侧只摘掉被裁那一头的名字 —— `[Characters]` / `[Outline]`
 * 是语种中立通名，与轮 17 对栏题英文侧「无物可换不登记」同一条判据。
 * novel 那格 = 改造前逐字（零回归线），它用的是规则句自己的词、不是栏题名，所以不并入拼接。
 */
function canvasFitListFromTerms(g: GenrePromptVariant): { zh: string; en: string } {
  const terms = quickActionTermsFor(g);
  return { zh: `书名、${terms.personaBlockZh}与${terms.outlineBlockZh}`, en: 'book title, characters, outline' };
}

const CANVAS_FIT_LIST: Record<GenrePromptVariant, { zh: string; en: string }> = {
  novel: { zh: '书名、角色、世界观与大纲设定', en: 'book title, characters, worldbuilding, outline' },
  essay: canvasFitListFromTerms('essay'),
  poetry: canvasFitListFromTerms('poetry'),
  script: canvasFitListFromTerms('script'),
  diary: canvasFitListFromTerms('diary'),
};

/**
 * ㉪ AI-6⁗（2026-11-10 轮 23）：**画布助手认书 = 场景根优先**。
 *
 * 取证（本轮实测，不拿轮 22 的注释当结论）：
 * ① 画布切书走 `SceneTabBar.handleBookSwitch:332` → `openBookInStudio`（`utils/studioBook.ts:55-93`），
 *    后者只切场景 + 接 projectStore，**整条不写 `setActiveBook`**（写点在 `createBookNamed:115`，
 *    不在 openBookInStudio 里 —— 轮 22 记的「全仓只有五处写点、没有一处是换场景」是带
 *    `include` 过滤的漏读，AU-7 ⑦ 同族第五例：渲染层另有六处写点 WritingDocsRenderer:86 /
 *    WritingStudioPane:110 / WritingDesignView:51 / WritingChapterEditor:182 / WritingTreeTab:138 /
 *    WritingInspectorPanel:1492，但每一处都只在**那张卡恰好挂在当前视图**时才把活跃书扳到场景书）。
 * ② `writingStore` 无持久化（全仓 grep `persist(` 命中全在别处）→ 重启直达书场景那一刻
 *    `activeBookId` 仍是初始值 `null`（`store/writingStore.ts:395`）。
 * ⇒ 「生成那一刻端着 A 书的语境与白名单给 B 书的画布排卡」确实可达：B 的当前视图没挂上那六枚
 *    卡时体裁与语境都还是 A 的；重启直达时体裁直接落 `''` = 全表白名单，诗集画布也能建世界观卡。
 *
 * 修法取队列**换源案**（零审批）：认书改从**场景根**现取，复用现成解析器 `parseBookIdFromScene()`
 * （`utils/studioBook.ts:421`，画布取色 `SceneEditorPage.tsx:458` 早已在吃它），不另立第二份认书口径。
 * 场景不是书（根不是 writing:// 前缀）时回落**活跃书** = 改造前行为，非书画布与既有测试零动。
 * **判据链一字未动**：体裁仍走 `*ForGenre` / `workbenchCommandSet` 一族，本处只换「哪本书」的源。
 * 另一案（换场景时顺手接线 setActiveBook）会把写作台一起扳到 B 书 = 产品口径，已记 **P13** 待拍板。
 */
function canvasBookId(): string {
  return parseBookIdFromScene() || useWritingStore.getState().activeBookId || '';
}

/** 现读**这幅画布所属那本书**的体裁（画布是 B 的画布，不是「写作台最后碰的那本」；与注入的写作语境认**同一本书**，不给「算了 genre 没接到行上」（AU-7 ⑨）留缝） */
function activeBookGenre(): string {
  const ws = useWritingStore.getState();
  return ws.books.find((b) => b.id === canvasBookId())?.genre ?? '';
}

/**
 * 从 writingStore 提取**这幅画布所属那本书**的写作语境，组装为纯文本注入 prompt。
 * ㉪ 认书口径 = 场景根优先（见 `canvasBookId`）；场景书 ≠ 活跃书时只端作品行，不端另一本的集合。
 * 让 add/set_text/rename 类操作贴合作品语境（画布对象多数是章节/人物/大纲卡）。
 * 认不到书时返回 null：画布 AI 保持「有上下文则用、没有也能干排版」的宽容语义。
 */
export function buildCanvasWritingContext(): string | null {
  const ws = useWritingStore.getState();
  // ㉪ 认书与 `activeBookGenre()` **同一个源**（场景根优先）：端给模型的作品、体裁、白名单、add 闸
  // 必须是同一本书——这本就是本函数头注写着的口径，本轮只是把它落到「哪一本书」上。
  const book = ws.books.find((b) => b.id === canvasBookId());
  if (!book) return null;
  // ㉤ 体裁现读现用（不新增传参链，workbenchContext 同法）：单位词、栏题、体裁显示名全部按当前书取。
  const genre = book.genre ?? '';
  const terms = quickActionTermsFor(genre);
  // 脏读数修复（队列点名的 bug 级）：喂模型的体裁必须是**显示名**；
  // 空体裁旧书不拼括号（= 改造前），未登记值按全仓口径落「小说」（`genreTagLabelKey`）。
  const genreTag = book.genre ? t(genreTagLabelKey(book.genre)) : '';
  // ㉪ 集合只随 `setActiveBook` 装载（`writingStore.ts:563-587`：先整批清空再拉），所以
  // chapters / settings / outlines 里躺的是**活跃书**的数据，不是场景书的数据。场景书 ≠ 活跃书时
  // 只端「作品 + 体裁」这一行，章数 / 人物 / 大纲 / 世界观一概不端 —— **宁缺不错**：把 A 书的人物与
  // 章数喂进「给 B 书画布排卡」的请求，模型会把 A 的角色排到 B 的画布上，而画布这一端看不出来。
  // 降级不新造语义：本函数无书时本来就返回 null（头注「有上下文则用、没有也能干排版」）。
  const collectionsMatchScene = ws.activeBookId === book.id;
  const chapter = collectionsMatchScene ? ws.chapters.find((c) => c.id === ws.activeChapterId) : undefined;
  const chars = collectionsMatchScene
    ? ws.settings
        .filter((s) => s.kind === 'character')
        .slice(0, 8)
        .map(
          (c) =>
            `- ${c.name}${c.subtitle ? `（${c.subtitle}）` : ''}${c.description ? `：${c.description.slice(0, 80)}` : ''}`,
        )
    : [];
  const outlines = collectionsMatchScene
    ? ws.outlines.slice(0, 10).map((o) => `- ${o.title}${o.summary ? `：${o.summary.slice(0, 60)}` : ''}`)
    : [];
  // 第十四轮：补【世界观设定】段——本批次刚把 writing-worldview 加进 AI 可新增白名单，
  // 但若上下文不含书里已有世界观，AI「能加世界观卡」却无据可依，只会凭空造卡、与既有
  // 人物/大纲口径打架。settings 里世界观是 kind==='worldbuilding'，与人物档案同构注入。
  // ㉤ worldview 对非小说四支是被裁视图（⑮-2）：老数据里就算躺着 worldbuilding 条目也不再把这一端
  // 喂给模型——一边闸着创建入口（`canCreateEntityForGenre` 只查同一张表）一边叫模型去读它，
  // 是轮 7 判过的「一边锁门一边发钥匙」。小说 / 未设体裁旧书 / 脏值 = 判据回落，逐字改造前。
  // ㉪ 世界观段读的也是 settings（活跃书的集合），同受「集合只属于活跃书」这条管；页签闸口径原样在。
  const worldviewAllowed = collectionsMatchScene && !hiddenViewKindsForGenre(genre).includes('worldview');
  const worldviews = worldviewAllowed
    ? ws.settings
        .filter((s) => s.kind === 'worldbuilding')
        .slice(0, 8)
        .map(
          (w) =>
            `- ${w.name}${w.subtitle ? `（${w.subtitle}）` : ''}${w.description ? `：${w.description.slice(0, 80)}` : ''}`,
        )
    : [];
  const completed = collectionsMatchScene ? ws.chapters.filter((c) => c.status === 'completed').length : 0;
  const parts: string[] = [];
  parts.push(
    L(
      `【作品】《${book.title}》${genreTag ? `（${genreTag}）` : ''}${chapter ? ` · ${terms.unitTagZh}《${chapter.title}》` : ''}`,
      `[Book] "${book.title}"${genreTag ? ` (${genreTag})` : ''}${chapter ? ` · ${terms.unitTagEn} "${chapter.title}"` : ''}`,
    ),
  );
  if (collectionsMatchScene && ws.chapters.length > 0) {
    parts.push(
      L(
        `【${terms.progressLabel}】共 ${ws.chapters.length} ${terms.unitMeasure}，已完稿 ${completed} ${terms.unitMeasure}`,
        `[Progress] ${ws.chapters.length} ${terms.progressUnitEn} total, ${completed} completed`,
      ),
    );
  }
  if (chars.length) {
    parts.push(
      L(
        `【${terms.personaBlockZh}】\n${chars.join('\n')}`,
        `[Characters]\n${chars.map((c) => c.replace(/^-\s*/, '')).join('\n')}`,
      ),
    );
  }
  if (outlines.length) {
    parts.push(
      L(
        `【${terms.outlineBlockZh}】\n${outlines.join('\n')}`,
        `[Outline]\n${outlines.map((o) => o.replace(/^-\s*/, '')).join('\n')}`,
      ),
    );
  }
  if (worldviews.length) {
    parts.push(
      L(
        `【世界观设定】\n${worldviews.join('\n')}`,
        `[Worldbuilding]\n${worldviews.map((w) => w.replace(/^-\s*/, '')).join('\n')}`,
      ),
    );
  }
  return parts.join('\n');
}

// ─── Prompt 组装 ────────────────────────────────────────────

function langNote(): string {
  return getLang() === 'en-US' ? 'Respond in English.' : '用中文。';
}

export function buildCanvasOpsMessage(
  snapshot: CanvasSnapshotItem[],
  instruction: string,
  writingContext?: string | null,
): string {
  const list = snapshot
    .map(
      (s) =>
        `- id=${s.id} | type=${s.type} | 名称=${s.name} | 文字=${s.text || '（无）'} | 位置=(${s.x},${s.y}) | 大小=${s.width}×${s.height}`,
    )
    .join('\n');
  // ㉤ 人设跟载体走（轮 13 在册的那句写死小说工作台的修法）：现读活跃书，与写作语境块认同一本书。
  const persona = CANVAS_PERSONA_NOUN[workbenchCommandSet(activeBookGenre())];
  // ㉦ 第 7 条的贴合对象跟载体走（与上面人设认**同一本书**，不给「算了没接上」留缝）
  const fit = CANVAS_FIT_LIST[workbenchCommandSet(activeBookGenre())];
  // ㉨ add 白名单按体裁取（与上面 persona/fit 认**同一本书**：现读活跃书体裁，不给 AU-7 ⑨ 留缝）
  const addable = aiAddableTypesForGenre(activeBookGenre());
  return [
    L(
      `你是${persona.zh}创作工作台的画布排版助手。根据用户指令，输出一组对画布实体的结构化操作。`,
      `You are the canvas layout assistant of a ${persona.en} studio. Output a set of structured canvas operations per the user's instruction.`,
    ),
    '',
    L('【可用操作（严格按此 JSON Schema）】', '[Operations (strict JSON schema)]'),
    `[
  {"op":"move","id":"<清单中的id>","x":<数字>,"y":<数字>},
  {"op":"resize","id":"<id>","width":<数字>,"height":<数字>},
  {"op":"rename","id":"<id>","name":"<新名称>"},
  {"op":"set_text","id":"<id>","text":"<新文字>"},
  {"op":"remove","id":"<id>"},
  {"op":"add","type":"${addable.join("|")}","name":"<名称>","x":<数字>,"y":<数字>,"width":<可选>,"height":<可选>,"text":"<可选>"},
  {"op":"arrange_grid","ids":["<id>",...],"startX":<可选>,"startY":<可选>,"columns":<可选>,"cellWidth":<可选>,"cellHeight":<可选>,"gapX":<可选>,"gapY":<可选>}
]`,
    '',
    L('【硬性规则】', '[Hard rules]'),
    L(
      `1. 只输出一个 JSON 数组，不要任何解释、前后缀或代码围栏；2. move/resize/rename/set_text/remove 的 id 必须来自下方清单；3. 新增实体的 type 只能取白名单里的值（${addable.join("、")}）；4. 坐标是画布逻辑坐标（原点左上，向右下为正）；5. 排版类指令优先用 arrange_grid；6. 不确定的操作宁可不输出，绝不要臆造；7. 新增/改名/改文字时，内容优先贴合下方写作背景中的${fit.zh}。`,
      `1. Output ONLY one JSON array: no explanations, prefixes, or code fences; 2. move/resize/rename/set_text/remove ids must come from the list below; 3. add.type must be one of the whitelisted values (${addable.join(", ")}); 4. Coordinates are canvas logical coords (origin top-left); 5. Prefer arrange_grid for layout instructions; 6. When unsure, omit — never fabricate; 7. For add/rename/set_text, prefer content that fits the writing context below (${fit.en}).`,
    ),
    '',
    L('【当前画布实体清单】', '[Current canvas entities]'),
    list || L('（空画布）', '(empty canvas)'),
    '',
    ...(writingContext ? [L('【写作背景】', '[Writing context]'), writingContext, ''] : []),
    L(`【用户指令】${instruction}`, `[User instruction] ${instruction}`),
    '',
    langNote(),
  ].join('\n');
}

// ─── 回复解析 ───────────────────────────────────────────────

function asFiniteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * 校验并归一单个 op；非法返回 null（宁跳过不猜测）。
 * ㉨ `addableTypes` = **这本书的体裁**能新增的 type（由 `parseCanvasOps` 按体裁现取）。
 * 改造前这里查的是全局 `AI_ADDABLE_TYPES`，于是它对任何载体都发得出世界观卡。
 * 形参**不给默认值**（轮 15 `bookOverviewPrompt` 签名翻面同一手法）：漏传体裁就编译不过，
 * 不给「忘了传就悄悄全放行」留口子。
 */
function normalizeOp(raw: unknown, addableTypes: readonly string[]): CanvasAiOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = asNonEmptyString(o.id);
  switch (o.op) {
    case 'move': {
      const x = asFiniteNumber(o.x);
      const y = asFiniteNumber(o.y);
      return id && x !== null && y !== null ? { op: 'move', id, x, y } : null;
    }
    case 'resize': {
      const w = asFiniteNumber(o.width);
      const h = asFiniteNumber(o.height);
      return id && w !== null && h !== null && w > 20 && h > 20
        ? { op: 'resize', id, width: Math.min(w, 2000), height: Math.min(h, 2000) }
        : null;
    }
    case 'rename': {
      const name = asNonEmptyString(o.name);
      return id && name ? { op: 'rename', id, name: name.slice(0, 80) } : null;
    }
    case 'set_text': {
      const text = asNonEmptyString(o.text);
      return id && text ? { op: 'set_text', id, text: text.slice(0, 500) } : null;
    }
    case 'remove':
      return id ? { op: 'remove', id } : null;
    case 'add': {
      const type = asNonEmptyString(o.type);
      const name = asNonEmptyString(o.name);
      const x = asFiniteNumber(o.x);
      const y = asFiniteNumber(o.y);
      if (!type || !name || x === null || y === null) return null;
      if (!addableTypes.includes(type)) return null;
      const out: CanvasAiOp = { op: 'add', type, name: name.slice(0, 80), x, y };
      const w = asFiniteNumber(o.width);
      const h = asFiniteNumber(o.height);
      if (w !== null && w > 20) out.width = Math.min(w, 1200);
      if (h !== null && h > 20) out.height = Math.min(h, 1200);
      const text = asNonEmptyString(o.text);
      if (text) out.text = text.slice(0, 500);
      return out;
    }
    case 'arrange_grid': {
      if (!Array.isArray(o.ids)) return null;
      const ids = o.ids.filter((v): v is string => typeof v === 'string' && v.length > 0);
      if (ids.length === 0) return null;
      return {
        op: 'arrange_grid',
        ids: ids.slice(0, 200),
        startX: asFiniteNumber(o.startX) ?? 0,
        startY: asFiniteNumber(o.startY) ?? 0,
        columns: Math.max(1, Math.min(asFiniteNumber(o.columns) ?? 4, 12)),
        cellWidth: Math.max(60, asFiniteNumber(o.cellWidth) ?? 240),
        cellHeight: Math.max(40, asFiniteNumber(o.cellHeight) ?? 80),
        gapX: Math.max(0, asFiniteNumber(o.gapX) ?? 20),
        gapY: Math.max(0, asFiniteNumber(o.gapY) ?? 20),
      };
    }
    default:
      return null;
  }
}

/**
 * 从 AI 回复里提取 JSON 数组并归一；返回 ops 与被丢弃的条数。
 * ㉨ `genre` = 当前活跃书的体裁（调用方现读现传，与 prompt 端的是**同一本书**）。
 * 被体裁闸口裁掉的实体不进白名单 → 模型硬造出来的那条 add 计入 `dropped`，
 * 界面「忽略 N 条无效」明示，不静默吞（`CanvasAiDialog.tsx:174`）。
 */
export function parseCanvasOps(
  reply: string,
  genre: string,
): { ops: CanvasAiOp[]; dropped: number; parseError: string | null } {
  const addableTypes = aiAddableTypesForGenre(genre);
  if (!reply || reply.trim().length === 0) {
    return { ops: [], dropped: 0, parseError: 'empty' };
  }
  let jsonText: string | null = null;
  const fence = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    jsonText = fence[1];
  } else {
    const start = reply.indexOf('[');
    const end = reply.lastIndexOf(']');
    if (start !== -1 && end > start) jsonText = reply.slice(start, end + 1);
  }
  if (!jsonText) return { ops: [], dropped: 0, parseError: 'no-array' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ops: [], dropped: 0, parseError: 'invalid-json' };
  }
  if (!Array.isArray(parsed)) return { ops: [], dropped: 0, parseError: 'not-array' };
  const ops: CanvasAiOp[] = [];
  let dropped = 0;
  for (const raw of parsed) {
    const op = normalizeOp(raw, addableTypes);
    if (op) ops.push(op);
    else dropped += 1;
    if (ops.length >= MAX_OPS) break;
  }
  return { ops, dropped, parseError: null };
}

// ─── 应用（走 editorStore 正规 API，一次批量提交历史）────────

export interface CanvasApplyResult {
  applied: number;
  skipped: number;
}

/**
 * ㉩ AI-6‴（2026-11-10 轮 22）：**动作本体自锁 = 这道闸的第二层**。
 *
 * 轮 21 把 add 白名单按体裁裁到了**解析层**（`parseCanvasOps`/`normalizeOp`），但这里的
 * `case 'add'` 过去只靠「type 未注册 → addComponent 返回 null」挡乱码——`writing-worldview`
 * 是注册过的类型，第二层等于没有。本仓对创建类动作的口径写在 `InspirationPanels.tsx:296`：
 * 「双层：UI 藏口 + 动作本体自锁（这个动作以后被别人复用时，不会绕过口径）」。
 *
 * 可达性取证（轮 22 实测，不拿注释当结论）：弹窗是模态 Dialog，指针路径的切书/切场景被
 * backdrop 挡住（`CanvasAiDialog.tsx:139`），但 ① `activeBookId` 与画布场景本不同步（换场景
 * 无代码写 setActiveBook；渲染层另有六处**按卡**扳正，卡没挂在当前视图上就不扳——见 ㉪
 * `canvasBookId` 头注，轮 23 纠-2 把「全仓只有五处写点」这笔读数推翻），② 全局快捷键 Cmd+Shift+P 的命令面板浮在弹窗之上
 * （`SceneEditorPage.tsx:531-541` 的 keydown 监听不看 `canvasAiOpen`），其 `openWriting`
 * 动作会写 `setActiveBook`（`:881`）——**预览到应用之间换书这条路是通的**。
 * 于是按 genre **应用时刻的活跃书**复查：越权 add 记 `skipped`（界面「跳过 N 条」明示，不静默）。
 * 判据零新表：吃的仍是 `aiAddableTypesForGenre`，与 prompt/解析层同一张嘴。
 * genre 形参默认现读 `activeBookGenre()`——唯一生产调用方（`CanvasAiDialog.tsx:118`）不传，
 * 拿到的就是「点应用那一刻」的体裁；以后任何复用方都必须显式表态或同样吃现读书。
 */
export function applyCanvasOps(ops: CanvasAiOp[], genre: string = activeBookGenre()): CanvasApplyResult {
  const ed = useEditorStore.getState();
  const known = new Set(ed.components.map((c) => c.id));
  // ㉩ 按这本书体裁的 add 白名单（与 prompt 端出、解析层放行的是同一张嘴）
  const addableTypes = aiAddableTypesForGenre(genre);
  let applied = 0;
  let skipped = 0;
  const live = () => useEditorStore.getState();

  // 应用前冻结一份现有 id 集，AI 引用不存在/已删 id 的操作记 skipped
  const stillKnown = (id: string) => live().components.some((c) => c.id === id) && known.has(id);

  ed.beginBatch();
  try {
    for (const op of ops) {
      const s = live();
      switch (op.op) {
        case 'move':
          if (!stillKnown(op.id)) {
            skipped += 1;
            break;
          }
          s.updateComponentTransform(op.id, { x: op.x, y: op.y });
          applied += 1;
          break;
        case 'resize':
          if (!stillKnown(op.id)) {
            skipped += 1;
            break;
          }
          s.updateComponentTransform(op.id, { width: op.width, height: op.height });
          applied += 1;
          break;
        case 'rename':
          if (!stillKnown(op.id)) {
            skipped += 1;
            break;
          }
          s.updateComponent(op.id, { name: op.name });
          applied += 1;
          break;
        case 'set_text': {
          if (!stillKnown(op.id)) {
            skipped += 1;
            break;
          }
          const comp = s.components.find((c) => c.id === op.id)!;
          const cfg = { ...(comp.config ?? {}) } as Record<string, unknown>;
          // 按实体类型落**主字段**（name/title/text），与渲染器读取口径一致：
          // 旧逻辑 title 优先否则 text，对 character/worldview（主字段 name）落到
          // 无人渲染的 config.text → set_text 静默失效。
          const key = primaryTextKey(comp.type);
          cfg[key] = op.text;
          s.updateComponentConfig(op.id, cfg);
          applied += 1;
          break;
        }
        case 'remove':
          if (!stillKnown(op.id)) {
            skipped += 1;
            break;
          }
          s.removeComponent(op.id);
          applied += 1;
          break;
        case 'add': {
          // ㉩ 第二层：解析层挡过一遍，动作本体再自锁一遍（双层口径见 applyCanvasOps 头注）。
          // 预览到应用之间活跃书被换（命令面板 openWriting 可达）时，按**新那一刻的书**复查。
          if (!addableTypes.includes(op.type)) {
            skipped += 1;
            break;
          }
          const created = s.addComponent(op.type, undefined, { x: op.x, y: op.y });
          if (!created) {
            skipped += 1;
            break;
          }
          const patch: Record<string, unknown> = { name: op.name };
          useEditorStore.getState().updateComponent(created.id, patch as any);
          if (op.width || op.height) {
            const w = op.width ?? created.transform.width;
            const h = op.height ?? created.transform.height;
            useEditorStore.getState().updateComponentTransform(created.id, { width: w, height: h });
          }
          if (op.text) {
            // character/worldview→name，outline→title，便签→text
            const cfgKey = primaryTextKey(op.type);
            useEditorStore.getState().updateComponentConfig(created.id, { [cfgKey]: op.text });
          }
          applied += 1;
          break;
        }
        case 'arrange_grid': {
          let placed = 0;
          const cols = op.columns ?? 4;
          const cw = op.cellWidth ?? 240;
          const ch = op.cellHeight ?? 80;
          const gx = op.gapX ?? 20;
          const gy = op.gapY ?? 20;
          for (let i = 0; i < op.ids.length; i++) {
            const id = op.ids[i];
            if (!stillKnown(id)) continue;
            const col = i % cols;
            const row = Math.floor(i / cols);
            live().updateComponentTransform(id, {
              x: (op.startX ?? 0) + col * (cw + gx),
              y: (op.startY ?? 0) + row * (ch + gy),
            });
            placed += 1;
          }
          if (placed > 0) applied += 1;
          else skipped += 1;
          break;
        }
        default:
          skipped += 1;
      }
    }
  } finally {
    ed.endBatch();
  }
  return { applied, skipped };
}

// ─── 无头执行器（与 writingAssistant 同款流程）──────────────

export class CanvasAssistantError extends Error {
  constructor(
    message: string,
    /** 机器可读：agent-missing / busy / send-failed / no-output / parse */
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'CanvasAssistantError';
  }
}

export async function runCanvasAssistantTask(opts: {
  agentId: string;
  instruction: string;
}): Promise<{ ops: CanvasAiOp[]; dropped: number; conversationId: string }> {
  const state = useAgentStore.getState();
  const agent = state.agents.find((a) => a.id === opts.agentId);
  if (!agent) {
    throw new CanvasAssistantError(
      L('指定的 Agent 不存在，请重新选择', 'Selected agent not found, please re-pick'),
      'agent-missing',
    );
  }
  if (state.isStreaming) {
    throw new CanvasAssistantError(L('上一次对话仍在进行中，请稍后再试', 'Previous request still streaming'), 'busy');
  }

  const snapshot = captureCanvasSnapshot();
  if (snapshot.length === 0 && !/add|新增|插入/i.test(opts.instruction)) {
    // ㉦ 报错句也吃 book 级词（轮 17 在册 AI-6′ ②：改造前这一句把小说那一格焊死在报错里，
    //  而这一格在现成 overviewHint 口径里四支各有专名）。en 侧那句不含此类名词，无物可换。
    throw new CanvasAssistantError(
      L(`画布是空的，先生成${quickActionTermsFor(activeBookGenre()).bookLevelZh}总览或插入实体`, 'Canvas is empty'),
      'no-output',
    );
  }

  const conv = await state.createConversation(opts.agentId, L('画布优化', 'Canvas polish'));
  try {
    await state.sendMessage(conv.id, buildCanvasOpsMessage(snapshot, opts.instruction, buildCanvasWritingContext()));
  } catch (e) {
    throw new CanvasAssistantError((e as Error)?.message ?? String(e), 'send-failed');
  }

  const messages = await agentApi.listMessages(conv.id);
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim().length > 0);
  if (!lastAssistant) {
    throw new CanvasAssistantError(L('对话已结束，但没有拿到可用输出', 'No output'), 'no-output');
  }
  // ㉨ 校验层吃**同一本书**的体裁：prompt 里端出去的白名单与实际放行的白名单必须同一张嘴
  const { ops, dropped, parseError } = parseCanvasOps(lastAssistant.content, activeBookGenre());
  if (parseError || ops.length === 0) {
    throw new CanvasAssistantError(
      L('AI 没有返回可执行的操作，换个说法再试一次', 'AI returned no actionable operations'),
      'parse',
    );
  }
  return { ops, dropped, conversationId: conv.id };
}
