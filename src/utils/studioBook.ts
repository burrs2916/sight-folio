// 工作室 × 作品 共享工具（F5 → F7 v2「书=场景」）：
//
// F7 方向纠正：新建作品不是跳去写作台，而是**在工作室里创建一个作品** ——
// 书的画布就是工作室画布本身。实现：一本书对应一个支撑场景（backing scene），
// 场景 id = 分析 id = `wscan_{book_id}`（本代码库场景 id == 分析 id 是同一约定），
// SceneEditorPage 已有的 activeSceneId → loadAll → 空画布自动同步管线全部复用，
// 不新写任何画布代码。
//
// 行为约定：
// - openBookInStudio = 扫描（幂等，Rust 侧透传画布字段防丢）→ 确保支撑场景存在
//   → setActiveScene → projectStore 接线（files + findings）；
// - createBookAutoNamed = 建书 + 自动建「第 1 章」+ 走 openBookInStudio 落场景；
// - importBookFromDialog = 系统对话框选 txt/md → import_writing_book → 刷新书架。

import { open } from '@tauri-apps/plugin-dialog';
import { analyzerRegistry } from '../editor/analyzer/analyzerRegistry';
import { useProjectStore } from '../store/projectStore';
import { useSceneStore } from '../store/sceneStore';
import { useWritingStore } from '../store/writingStore';
import { useEditorStore } from '../store/editorStore';
import { useWritingDocsStore } from '../store/writingDocsStore';
import { writingScanApi, type WritingImportSummary, type WritingScanSummary } from '../services/tauri';
import { defaultBookNameKeyForGenre, defaultMediumForGenre, genreLabelKey, hiddenViewKindsForGenre, unitNameKey, viewKindLabelKey } from './writingSchema';
import { buildStatsBoard } from './writingBoards';
import {
  duplicateStudioPaneIds,
  isLegacyBoardCard,
  studioPaneForViewKind,
  type StudioPaneKind,
} from './writingPaneSeed';
import { t } from '../i18n';
import logger from './logger';
import { destroyDeskWindowFor, isWritingDeskWindow } from './writingDeskWindow';

/**
 * 并发 seed 守卫：同一 (viewId, kind) 只允许一个 seed 在途。
 *
 * 最初为时间线视图的 seed 反馈环而设——seedTypedView 异步 `await loadTimelineEvents`，
 * 而时间线视图的 live-refresh effect 监听 `timelineEvents`，load 每次重建数组引用会触发
 * reseed → seed → 又 load 的环，并发在途时 stale 清理总在 add 落地前跑 → 只增不删。
 * 现在时间线已改为 reconcileStudioPaneView 铺可编辑编辑面（不再 seed），守卫主要保护
 * stats 只读板 seed，作为「清理+重建」对单视图原子化的通用安全网保留。
 */
const pendingSeeds = new Set<string>();

/** 书的支撑场景 id（与 Rust 侧 writing_analysis_id 同一规则：wscan_{book_id}） */
export function bookSceneId(bookId: string): string {
  return `wscan_${bookId}`;
}

/**
 * ㉫ 写侧扳正（轮 24 · AI-7，形状沿用卡片挂载时的接线 effect：WritingDesignView.tsx:46-53 /
 * WritingStudioPane.tsx:105-112，只是把时机从「挂载」延到「点击那一刻」）：
 * 章节 / 剧情线等实体按 store 活跃书落库，卡片所属的书却住在 config.filePath 里。
 * 两者分叉可达（写作台书切换器换书不重跑卡片的扳正 effect）⇒ 写动作前先把它扳到本卡书，
 * 扳不动（无卡书 / 接线失败）就不写——宁可不建，不静默建进别人的书。不是新判据，是既有接线的复用。
 *
 * ㉭ 上收本文件（轮 26 · AI-9）：右栏灵感总览卡的「＋记个念头」也需要同一道写侧闸（它的
 * createOutline 同样按 store 活跃书落库）。本文件是「书 × 工作室接线」的既有归宿，且两侧都早已
 * import 它 —— 留在 writingPanes 里再跨文件 import 会形成 panels ↔ renderers 循环引用，
 * 复制一份则是同一概念第二条定义。两种都不要，故整段搬来，函数体一字未改。
 */
export async function ensureWritingBookWired(bookId: string): Promise<boolean> {
  if (!bookId) return false;
  const ws = useWritingStore.getState();
  if (ws.activeBookId === bookId) return true;
  try {
    await ws.setActiveBook(bookId);
    return true;
  } catch (e) {
    logger.warn('writingPanes', 'ensure card book wired failed', { bookId, error: String(e) });
    return false;
  }
}

/**
 * 把一本书在工作室打开：扫描 → 确保支撑场景 → 激活场景 → projectStore 接线。
 * 幂等：场景已存在则只补扫并切换；不存在则先扫再按扫描结果建场景。
 */
export async function openBookInStudio(bookId: string, title?: string): Promise<WritingScanSummary> {
  // 1) 扫描（幂等 upsert：Rust 侧透传既有画布字段，重扫不丢布局）
  const scanned = await writingScanApi.scanBook(bookId);
  const ws = useWritingStore.getState();
  const bookTitle = title ?? ws.books.find((b) => b.id === bookId)?.title ?? scanned.analysisId;
  const sid = bookSceneId(bookId);

  // 2) 确保支撑场景存在（场景列表可能是懒加载的，先拉一次再判）
  const ss = useSceneStore.getState();
  if (ss.scenes.length === 0 || !ss.scenes.some((s) => s.id === sid)) {
    await ss.loadScenes();
  }
  const exists = useSceneStore.getState().scenes.some((s) => s.id === sid);
  if (!exists) {
    // 首建：createScene 的 partial 展开在默认值之后，id/name/扫描字段全部可覆写；
    // 此刻画布字段本来就是空（新书），后续重扫由 Rust 侧透传保护。
    await useSceneStore.getState().createScene({
      id: sid,
      name: bookTitle,
      projectRoot: `writing://${bookId}/`,
      primaryLanguage: 'novel-zh',
      tags: ['writing'],
      scanStatus: 'ready',
      scanProgress: 100,
      lastScannedAt: Math.floor(Date.now() / 1000),
      totalFiles: scanned.fileCount,
      totalLines: scanned.totalWords,
    });
  }

  // 3) 激活写作分析器 + 场景 + projectStore 接线
  analyzerRegistry.setActiveAnalyzer('writing-analyzer');
  useSceneStore.getState().setActiveScene(sid);
  const ps = useProjectStore.getState();
  ps.setActiveAnalysis(scanned.analysisId);
  await ps.loadFiles(scanned.analysisId);
  await ps.loadFindings(scanned.analysisId);
  return scanned;
}

/**
 * 新建一本书（**显式命名**）+ 自动建第 1 章 + 落支撑场景。
 * 返回书对象；调用方留在工作室画布（不跳写作台）。
 *
 * 这是「用户显式点新建作品」的单一创建入口（书架空态/书架按钮/代码场景工具栏
 * 经 NewBookDialog 收集 名+体裁+载体 后调用），与 createBookAutoNamed 共享
 * 「建首章 + 落工作室」逻辑，只是命名由用户给而非自动「新建作品 {n}」。
 *
 * genre 可传（2026-09-12 起 L1 = 书）：拖「散文」进画布 = 新建一本散文书。
 * 载体 medium 由体裁推出（`defaultMediumForGenre`），不传体裁则保持历史行为
 * （genre="", medium=""，渲染层按小说·连载兜底）。
 */
export async function createBookNamed(
  name: string,
  genre = '',
  medium = defaultMediumForGenre(genre),
): Promise<{ id: string; title: string }> {
  const ws = useWritingStore.getState();
  if (ws.books.length === 0) await ws.loadBooks();
  const book = await ws.createBook(name, genre, medium);
  await ws.setActiveBook(book.id);
  // 首章：工作室画布要有一章可渲染，写作台也直接可写。
  // 名字必须跟体裁走（散文=第 1 篇）：以前这里无条件用「第 1 章」，拖散文建的书
  // 第一篇就挂着小说名（库里 `新建作品 3` 的活证据）。小说侧文案与原来逐字相同，零回归。
  await ws.loadChapters(book.id);
  await ws.createChapter(t(unitNameKey(genre), { n: 1 }));
  await openBookInStudio(book.id, book.title);
  return { id: book.id, title: book.title };
}

/**
 * 新建一本书（自动命名「新建作品 {n}」）+ 自动建第 1 章 + 落支撑场景。
 * 返回书对象；调用方留在工作室画布（不跳写作台）。
 *
 * 仅服务**手势型**入口（L1「＋」菜单、拖载体进画布）：这些入口语义是「再拖/再点
 * 一次 = 再建一本」，无需打断用户去命名，沿用历史自动名。用户显式点「新建作品」
 * 的入口改走 NewBookDialog → createBookNamed（干掉丑默认名，羽化 P）。
 *
 * genre 可传（2026-09-12 起 L1 = 书）：拖「散文」进画布 = 新建一本散文书。
 */
export async function createBookAutoNamed(
  genre = '',
  medium = defaultMediumForGenre(genre),
): Promise<{ id: string; title: string }> {
  const ws = useWritingStore.getState();
  if (ws.books.length === 0) await ws.loadBooks();
  // N-23（轮 72 续）：自动名**跟载体走**（新日记 1 / 新诗集 2 …），未设或脏体裁仍落历史名
  return createBookNamed(t(defaultBookNameKeyForGenre(genre), { n: ws.books.length + 1 }), genre, medium);
}

/**
 * 拖载体进画布 = **新建一本作品**，并打开该体裁的「大纲」编辑视图。
 *
 * 【语义变更 2026-09-12，用户拍板】此前这颗落点是**幂等复用**的：命中同题材视图就切过去。
 * L1 从「题材分组」改成「作品页签」后这个语义就错了 —— 题材只有固定四项（小说/散文/
 * 诗歌/剧本），复用会让「再拖一次小说」永远表现为无反应，而用户的预期是
 * 「再拖小说相当于新建一本书，那就新建一个 L1」。
 *
 * 所以这里改成无条件建书：拖几次就有几本书（多个 L1 页签并存）。
 * 建完立刻铺该体裁的「大纲」编辑视图，用户拖完直接落在编辑区，
 * 而不是停在一张空画布上还要再点一次 L2。
 */
export async function createBookFromCarrierDrop(genre: string): Promise<{ id: string; title: string }> {
  const book = await createBookAutoNamed(genre);
  openTypedCarrierView(genre, 'catalog');
  return book;
}

/**
 * 删书（= 放弃这本书）+ 清掉它的支撑场景。
 *
 * 为什么必须由本模块收口、而不是直接调 `writingStore.deleteBook`：
 * 书与场景是一对一的（`wscan_{bookId}`），只删书行会留下**孤儿场景** ——
 * 它仍挂在场景列表里，重启后还能被打开，而它指向的 writing_ 数据已经没了
 * （打开就是一本空书，与"已放弃"不符）。
 *
 * 顺序：先删书（Rust 侧级联删章节/设定/大纲）→ 再删场景 → 若删的是**当前书**
 * 则切到剩余第一本（`deleteScene` 会把 activeSceneId 置 null，不补这一步会停在
 * 无场景的悬空态）。剩余为空则什么都不做，L1 栏只剩「＋」。
 */
export async function deleteBookWithScene(bookId: string): Promise<void> {
  const wasActive = parseBookIdFromScene() === bookId || useWritingStore.getState().activeBookId === bookId;
  await useWritingStore.getState().deleteBook(bookId);

  const sid = bookSceneId(bookId);
  const ss = useSceneStore.getState();
  if (ss.scenes.some((s) => s.id === sid)) {
    await ss.deleteScene(sid);
  } else {
    // 场景懒加载：列表可能还没拉到这一本，补拉一次再确认，避免孤儿残留
    await ss.loadScenes();
    if (useSceneStore.getState().scenes.some((s) => s.id === sid)) {
      await useSceneStore.getState().deleteScene(sid);
    }
  }
  logger.info('studioBook', 'book deleted with scene', { bookId, wasActive, sceneId: sid });

  // 一书一窗：删书连带销毁该书专属写作台窗口（防孤儿窗口残留）。
  // 若删除正发生在该书自己的写作台窗口内，destroy 后 webview 即随书关闭。
  void destroyDeskWindowFor(bookId);

  if (!wasActive) return;
  // 写作台窗口内删绑定书：窗口随书销毁，不再执行主窗口语义的落场景切换
  if (isWritingDeskWindow()) return;
  const rest = useWritingStore.getState().books;
  if (rest.length > 0) {
    await openBookInStudio(rest[0].id, rest[0].title);
  }
}

/** 系统对话框选 txt/md → 导入写作库 → 刷新书架。取消选择返回 null。 */
export async function importBookFromDialog(): Promise<WritingImportSummary | null> {
  const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
  if (!isTauri) return null;
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: t('studio.importFilter'), extensions: ['txt', 'md'] }],
  });
  if (typeof selected !== 'string') return null;
  const imported = await writingScanApi.importBook(selected);
  await useWritingStore.getState().loadBooks();
  return imported;
}

/**
 * 货架空白模板 → 真建档（业务闭环 P3，IA 收口拍板「拖出即真建」）：
 *   - writing-chapter    → createChapter（自动「第 N 章」），确定性绑定
 *     fileId = wfile_{chapter_id} / filePath = writing://{bookId}/{chapter_id}.md
 *     （与 Rust scan_writing_book 的文件 id/path 约定一致，无需等待重扫即可双击跳正文，
 *     后台幂等补扫只为让 project_files 行尽快落库）；
 *   - writing-character  → createSetting("character")；
 *   - writing-worldview  → createSetting("worldbuilding")。
 * 其他类型（大纲/便签等纯画布元素）返回 null，走旧链路空壳卡。
 * 场景不是书（projectRoot 非 writing://）也返回 null —— 货架只在书场景出现，防御性兜底。
 */
/** 章节卡绑定 config（确定性约定与 Rust scan_writing_book 一致）。建档与已有元素拖入共用。 */
export function chapterCardConfig(
  bookId: string,
  chapter: { id: string; title: string; volume?: string; wordCount?: number; status?: string },
): Record<string, unknown> {
  return {
    fileId: `wfile_${chapter.id}`,
    filePath: `writing://${bookId}/${chapter.id}.md`,
    title: chapter.title,
    volume: chapter.volume ?? '',
    wordCount: chapter.wordCount ?? 0,
    chapterStatus: chapter.status ?? 'draft',
    chapterId: chapter.id,
  };
}

/** 设定卡绑定 config（人物/世界观共用）。建档与已有元素拖入共用。 */
export function settingCardConfig(setting: { id: string; name: string; kind?: string }): Record<string, unknown> {
  return {
    name: setting.name,
    settingId: setting.id,
    appearances: 0,
    ...(setting.kind === 'worldbuilding' ? { kind: 'worldview' } : {}),
  };
}

export async function createBlankWritingEntity(
  type: string,
  genreHint = '',
  _chapterId = '',
): Promise<{ name: string; config: Record<string, unknown> } | null> {
  if (
    type !== 'writing-chapter' &&
    type !== 'writing-character' &&
    type !== 'writing-worldview' &&
    type !== 'writing-workbench'
  ) {
    return null;
  }
  const scene = useSceneStore.getState().getActiveScene();
  const bookId = scene?.projectRoot?.replace(/^writing:\/\//, '').replace(/\/+$/, '');
  if (!bookId) return null;

  const ws = useWritingStore.getState();
  // 直接从场景打开（应用重启后）时 writingStore 可能还没接线：先补齐再建档
  if (ws.activeBookId !== bookId) {
    await ws.setActiveBook(bookId);
  }
  const state = useWritingStore.getState();

  if (type === 'writing-workbench') {
    // 设计视图（用户拍板「拖载体落设计视图」）：载体拖进画布 = 落一张**书级**
    // 设计视图大卡，绑定当前书（书的画布就是这本书的场景，书已存在，不再建章）。
    // 人物 / 主线 / 场景在卡内设计；正文成稿仍在写作台。
    const genre = genreHint || state.books.find((b) => b.id === bookId)?.genre || '';
    const bookTitle = state.books.find((b) => b.id === bookId)?.title ?? '';
    return {
      name: bookTitle,
      config: {
        filePath: `writing://${bookId}/`,
        genre,
      },
    };
  }

  if (type === 'writing-chapter') {
    // 体裁术语层（载体线索）：命名跟随**所拖模板的体裁**（散文分区拖出即「第 N 篇」），
    // 未带提示时回落当前书体裁 —— 分区切换与书体裁不一致时以用户选择为准
    const genre = genreHint || state.books.find((b) => b.id === bookId)?.genre || '';
    // ⑲：这里原来只写 `genre === 'essay' ? 第 N 篇 : 第 N 章` —— 于是**诗集与剧本拖出来的节点
    // 叫「第 N 章」**（术语层在这条路上被整段绕过）。改成走 unitNameKey 单源。
    // 零回归依据：studio.chapterN 与 writing.newChapterName、studio.pieceN 与 writing.newPieceName
    // 在 zh/en 两侧**逐字相同**（2026-11-10 对照过），所以小说与散文的名称一个字符都不变。
    const chapter = await state.createChapter(
      t(unitNameKey(genre), { n: state.chapters.length + 1 }),
    );
    if (!chapter) return null;
    // 后台幂等补扫：project_files 落 wfile_{chapter_id} 行（绑定不依赖它，只为准确定位）
    void writingScanApi.scanBook(bookId).catch((e) => {
      logger.warn('studioBook', 'blank chapter backfill scan failed (binding unaffected)', { error: e });
    });
    return {
      name: chapter.title,
      config: chapterCardConfig(bookId, chapter),
    };
  }

  // 人物 / 世界观 → 设定卡真建档
  const kind = type === 'writing-character' ? 'character' : 'worldbuilding';
  const setting = await state.createSetting(
    kind,
    t(type === 'writing-character' ? 'studio.newCharacter' : 'studio.newWorldview'),
  );
  if (!setting) return null;
  return {
    name: setting.name,
    config: settingCardConfig(setting),
  };
}

/**
 * 程序化开章级载体视图（编辑区内点击章节触发，不依赖拖放）：
 * G3 起章节统一进入**正文容器视图**的 L3 文档页签（不再每次 addView）：
 *   1. ensureCarrierContainer 确保该题材的容器视图（kind="writing" + writing-docs 卡）
 *      存在并切换过去；
 *   2. writingDocsStore.openTab 打开/激活章节页签（默认按章去重，forceNew 同章多开）。
 * 旧章级纸面卡视图（G2 前落库）仍可从 Tab 栏进入，但新点击一律进容器。
 * 章节入口只存在于编辑区（设计视图，页面本体）——绝不放左栏（铁律 #9）。
 */
export function openChapterCarrierView(
  chapterId: string,
  name: string,
  genre: string,
  bookId: string,
  opts?: { forceNew?: boolean },
) {
  const { docsCompId } = ensureCarrierContainer(genre, bookId);
  if (!docsCompId) {
    logger.warn('studioBook', 'openChapterCarrierView: container has no docs card', { chapterId, genre });
    return;
  }
  useWritingDocsStore.getState().openTab(docsCompId, chapterId, name, opts);
}

/**
 * 确保题材的「正文容器视图」存在并激活（G3）：
 *   - 已有 kind="writing" 且带 writing-docs 卡的视图 → 切换过去；
 *   - 存在但卡丢失（异常恢复）→ 补一张铺满卡；
 *   - 不存在 → 新建（视图名=题材名，meta 打 carrierType+kind）+ 铺满卡。
 * 返回视图 id 与容器卡 id（无卡时为 null，调用方据此决定能否开页签）。
 */
export function ensureCarrierContainer(genre: string, bookId: string): { viewId: string; docsCompId: string | null } {
  const bookIdSafe = bookId || parseBookIdFromScene();
  // L1 缺口加固（2026-09-19）：书 id 为空（无书场景 / scene 解析失败）直接早退，
  // 不再往下走 addDocsCard("") 产出 writing:/// 孤儿卡——调用方均已按
  // docsCompId === null 守卫（openChapterCarrierView / SceneEditor 落卡 / openTypedCarrierView 忽略返回值），
  // 且「无作品不建作品视图」正是空态规范（2026-09-19 拍板）。
  if (!bookIdSafe) {
    logger.warn('studioBook', 'ensureCarrierContainer: no bookId, skip container creation', { genre });
    return { viewId: '', docsCompId: null };
  }
  const es = useEditorStore.getState();
  const found = es.views.find((v) => v.carrierType === genre && v.kind === 'writing');
  if (found) {
    if (es.activeViewId !== found.id) es.switchView(found.id);
    const st = useEditorStore.getState();
    const view = st.views.find((v) => v.id === found.id);
    const card = view?.components.find((c) => c.type === 'writing-docs');
    if (card) return { viewId: found.id, docsCompId: card.id };
    // 卡丢失：补一张铺满 writing-docs（当前 activeView 即该视图）
    logger.warn('studioBook', 'carrier container missing docs card, re-adding', { viewId: found.id });
    const docsCompId = addDocsCard(bookIdSafe, genre);
    return { viewId: found.id, docsCompId };
  }
  // 新建容器视图
  const label = genre ? t(genreLabelKey(genre)) : t('writing.viewKind.writing');
  const taken = new Set(useEditorStore.getState().views.map((v) => v.name));
  let viewName = label;
  let i = 2;
  while (taken.has(viewName)) viewName = `${label} ${i++}`;
  useEditorStore.getState().addView(viewName, { meta: { carrierType: genre || undefined, kind: 'writing' } });
  const docsCompId = addDocsCard(bookIdSafe, genre);
  useEditorStore.getState().deselectAll();
  logger.info('studioBook', 'carrier container created', { genre, viewName, docsCompId });
  return { viewId: useEditorStore.getState().activeViewId, docsCompId };
}

/** 往当前激活视图铺一张 writing-docs 卡（逻辑画布尺寸，默认缩放下铺满可视区）。 */
function addDocsCard(bookId: string, genre: string): string | null {
  const es = useEditorStore.getState();
  const cfg = es.canvasConfig;
  const comp = es.addComponent('writing-docs', undefined, { x: 0, y: 0 });
  if (!comp) {
    logger.warn('studioBook', 'addDocsCard: addComponent returned null', { bookId, genre });
    return null;
  }
  es.updateComponentTransform(comp.id, { x: 0, y: 0, width: cfg.width, height: cfg.height });
  es.updateComponentConfig(comp.id, {
    filePath: `writing://${bookId}/`,
    ...(genre ? { genre } : {}),
  });
  return comp.id;
}

/** projectRoot（`writing://{bookId}/`）→ bookId；非书场景返回空串。 */
export function parseBookIdFromRoot(root: string | undefined | null): string {
  if (!root || !root.startsWith('writing://')) return '';
  return root.replace(/^writing:\/\//, '').replace(/\/+$/, '');
}

/** 当前场景 projectRoot（writing://{bookId}/）→ bookId；非书场景返回空串。 */
export function parseBookIdFromScene(): string {
  return parseBookIdFromRoot(useSceneStore.getState().getActiveScene()?.projectRoot);
}

// ─────────────────────────────────────────────────────────────
// L2 题材视图的编辑面（2026-09-12）
// ─────────────────────────────────────────────────────────────
// 此前 catalog / characters / worldview 三个视图铺的是**只读分析板**
// （buildStoryboard / buildRelationBoard / buildWorldviewBoard，渲染器
// WritingEntityRenderer 零 input/onChange/button，数据源是扫描产物
// project_files.metadata.appearances）→ 用户在大纲视图里编辑不了大纲，
// 唯一的编辑面只存在于「左栏拖体裁载体 → writing-workbench 卡」那条通路上。
//
// 现在这三个视图铺对应的 writing-studio-pane（铺满画布、就地读写
// writing_chapters / writing_outlines / writing_settings），内容的编辑面回到编辑区。
//
// 只读分析板一张没删：buildStoryboard / buildRelationBoard / buildWorldviewBoard
// 仍由 SceneEditorPage.buildBookBoard（全书总览 / 分镜板 / 人物关系）提供 ——
// 它们读的是「扫描到的实况」，定位是结构体检，不再占 L2 主位。
// stats 仍走只读板（它的读法本来就是「看」）；timeline 已改为可编辑编辑面
// （reconcileStudioPaneView 铺 writing-studio-pane）。
//
// 映射与「只读板残留」判定抽在 utils/writingPaneSeed（纯函数，可单测）——
// 后者错了会误删用户拖进来的卡，必须有测试锁住。

/** 题材视图的 bookId：场景优先，回落当前激活的书（重启后场景可能还没接线）。 */
function currentBookId(): string {
  return parseBookIdFromScene() || useWritingStore.getState().activeBookId || '';
}

/** 往当前激活视图铺一张铺满画布的 writing-studio-pane 编辑面卡。 */
function addStudioPaneCard(pane: StudioPaneKind, bookId: string): string | null {
  const es = useEditorStore.getState();
  const cfg = es.canvasConfig;
  const comp = es.addComponent('writing-studio-pane', undefined, { x: 0, y: 0 });
  if (!comp) {
    logger.warn('studioBook', 'addStudioPaneCard: addComponent returned null', { pane, bookId });
    return null;
  }
  es.updateComponentTransform(comp.id, { x: 0, y: 0, width: cfg.width, height: cfg.height });
  es.updateComponentConfig(comp.id, { filePath: `writing://${bookId}/`, pane });
  return comp.id;
}

/**
 * 确保题材编辑视图（大纲/人物设定/世界观）的编辑面就位 —— 幂等，可反复调用：
 *   1. 已有 pane 卡 → 只校正 pane/filePath（书换了 / 早期版本 pane 写错都能自愈）；
 *   2. 没有 → 先清掉残留的只读分析板卡（只认 seed 标记，见 writingPaneSeed），
 *      再铺一张铺满画布的编辑面；
 *   3. 拿不到 bookId → 记日志不铺（避免落一张无绑定的空壳卡，静默空白比报错更难查）。
 * 非题材编辑视图（正文容器 / 时间线 / 统计 / 自定义视图）直接返回，零副作用。
 */
export function reconcileStudioPaneView(viewId: string): void {
  const pane = studioPaneForViewKind(useEditorStore.getState().views.find((v) => v.id === viewId)?.kind);
  if (!pane) return;
  const bookId = currentBookId();
  const filePath = `writing://${bookId}/`;
  const view = useEditorStore.getState().views.find((v) => v.id === viewId);
  if (!view) return;

  // 旧板卡残留清理：**无条件执行**。此前只在「无 pane 卡」分支跑，视图一旦铺好
  // 编辑面就早退跳过清理 —— 统计板卡误 seed 进时间线视图后 5 批 × 12 张永远清不掉
  // 的根因。只认 seed 标记（writingPaneSeed.isLegacyBoardCard），用户内容一张不动。
  const stale = view.components
    .filter((c) => isLegacyBoardCard(c.type, c.config as Record<string, unknown> | undefined))
    .map((c) => c.id);
  if (stale.length > 0) {
    const es = useEditorStore.getState();
    if (es.activeViewId !== viewId) es.switchView(viewId);
    useEditorStore.getState().removeComponentsBulk(stale);
    logger.info('studioBook', 'legacy board cards removed', { viewId, pane, removed: stale.length });
  }

  const existing = view.components.find((c) => c.type === 'writing-studio-pane');
  if (existing) {
    // 重复残留清理（真实事故：本函数的两个触发点在同一轮提交里各补了一张，
    // 同一视图叠了两张坐标完全相同的编辑面 —— 看不出来，但两个编辑面同时在
    // 读写同一份数据）。只清「同 pane + 几何完全重合」的种子重复项，
    // 用户自己摆到别处的编辑面卡一张不动（判定见 utils/writingPaneSeed）。
    const dupes = duplicateStudioPaneIds(view.components);
    if (dupes.length > 0) {
      useEditorStore.getState().removeComponentsBulk(dupes);
      logger.warn('studioBook', 'duplicate studio panes removed', { viewId, removed: dupes.length });
    }
    const cfg = (existing.config ?? {}) as Record<string, unknown>;
    if (cfg.pane !== pane || cfg.filePath !== filePath) {
      useEditorStore.getState().updateComponentConfig(existing.id, { pane, filePath });
      logger.info('studioBook', 'studio pane config reconciled', { viewId, pane });
    }
    return;
  }
  if (!bookId) {
    logger.warn('studioBook', 'reconcileStudioPaneView skipped: no book id', { viewId });
    return;
  }

  const newId = addStudioPaneCard(pane, bookId);
  // addComponent 会把新卡设为选中项 → 铺满画布的编辑面被选中会在整块画布上画选框，
  // 右栏也会变成「这张卡」的属性。只在「选中的确实是刚铺的这张」时清掉，
  // 不无条件 deselectAll（那会顺手清掉用户自己的选中）。
  if (newId && useEditorStore.getState().selection.selectedIds.includes(newId)) {
    useEditorStore.getState().deselectAll();
  }
}

/**
 * 类型化视图内容 seed（**只剩统计只读板一类**）：
 *   - stats  统计   → buildStatsBoard（体量 KPI + 卷分布 + 章节体量）
 * 其余 L2 kind（catalog / characters / worldview / timeline）已改由
 * reconcileStudioPaneView 铺可编辑编辑面，不再走这里。
 */
function seedTypedView(kind: 'stats', viewId: string): void {
  const key = `${viewId}:${kind}`;
  if (pendingSeeds.has(key)) {
    logger.info('studioBook', 'seedTypedView skipped (already in flight)', { kind, viewId });
    return;
  }
  pendingSeeds.add(key);
  void Promise.resolve().then(async () => {
    try {
      const files = useProjectStore.getState().files;
      let cards: {
        type: string;
        name: string;
        x: number;
        y: number;
        width: number;
        height: number;
        locked: boolean;
        config: Record<string, unknown>;
      }[] = [];
      try {
        cards = buildStatsBoard(files).cards;
      } catch (err) {
        logger.warn('studioBook', 'seedTypedView build failed', { kind, error: String(err) });
        return;
      }
      if (cards.length === 0) {
        logger.info('studioBook', 'seedTypedView skipped (no files/empty book)', { kind, viewId });
        return;
      }
      const es = useEditorStore.getState();
      if (es.activeViewId !== viewId) es.switchView(viewId);
      // 加固：实时复核激活视图 —— 快照可能过期（dev 热更新/快速切换窗口），
      // 任何情况下绝不把统计板卡铺进非统计视图；宁可放弃本次刷新也不污染别视图。
      if (useEditorStore.getState().activeViewId !== viewId) {
        logger.warn('studioBook', 'seedTypedView aborted: active view mismatch', { kind, viewId });
        return;
      }
      useEditorStore.getState().addComponentsBulk(cards);
      logger.info('studioBook', 'typed view seeded', { kind, viewId, cards: cards.length });
    } finally {
      pendingSeeds.delete(key);
    }
  });
}

/**
 * 命中已有 stats 视图时重铺：清掉上一次 seed 的只读板卡（按实体类型 +
 * config.kind 签名，不动用户自己拖的便签），再跑一次 seedTypedView 拿最新数据，
 * 实现「返回即刷新」——数据变了，统计回到该视图立刻反映。
 */
export function reseedTypedView(viewId: string, kind: 'stats'): void {
  const es = useEditorStore.getState();
  const view = es.views.find((v) => v.id === viewId);
  if (!view) return;
  const stale = view.components
    .filter(
      (c) => c.type === 'writing-outline' && String((c.config as Record<string, unknown> | undefined)?.kind) === 'stat',
    )
    .map((c) => c.id);
  if (stale.length > 0) {
    es.removeComponentsBulk(stale);
    logger.info('studioBook', 'typed view reseed: stale board cards removed', { viewId, kind, removed: stale.length });
  }
  seedTypedView(kind, viewId);
}

/**
 * 打开题材组内的类型化单例视图（L2 十项固定 Tab）。
 * 幂等：该题材下已有此 kind 的视图 → 切换（并校正编辑面）；否则新建（addView 自动激活）。
 * kind="writing" 是容器视图：创建时同时铺 writing-docs 卡（正文页签宿主）；
 * 其余 kind 全部走 reconcileStudioPaneView 铺可编辑编辑面——stats 已从旧只读画布板
 * （seedTypedView/buildStatsBoard，源码保留不再调用）升级为 StatsPane（2026-09-19），
 * reconcile 的无条件清场会按 isLegacyBoardCard 签名清掉历史 stat 卡，用户内容不动。
 */
export type WritingViewKind =
  | 'catalog'
  | 'characters'
  | 'worldview'
  | 'timeline'
  | 'storylines'
  | 'foreshadowing'
  | 'inspiration'
  | 'proofread'
  | 'stats'
  | 'writing'
  | 'overview';

export function openTypedCarrierView(genre: string, kind: WritingViewKind): void {
  const es = useEditorStore.getState();
  const hit = es.views.find((v) => v.carrierType === genre && v.kind === kind);
  if (hit) {
    es.switchView(hit.id);
    // 命中已有视图也要校正编辑面（stats 的旧画布 stat 卡由此清场，见 reconcile 无条件清理）
    reconcileStudioPaneView(hit.id);
    return;
  }
  // ㉓-2 中心护栏（2026-11-10）：这本书的体裁**不该长出这类实体**时，不许现场新建它的视图。
  // 位置必须在上面的 hit 分支之后：已经建过的数据仍要能切过去看 —— 折叠的是展示，不是事实。
  // 这一条替 30+ 处生产入口收口（writingPanes 9 处、TimelineSidePanels 5 处、WritingInspectorPanel 5 处、
  // BookOverviewPanel/InspirationPanels/ProofreadPanels/writingDeskJump 各若干）。
  // 判据直接查 hiddenViewKindsForGenre，不另立表：页签该不该出现、这类数据该不该被建，是同一个问题
  //（⑳ 的原话：藏视图不藏入口就是化妆）。
  // ㉓-2 中心护栏（2026-11-10）：这本书的体裁**不该长出这类实体**时，不许现场新建它的视图。
  // 位置必须在上面的 hit 分支之后：已经建过的数据仍要能切过去看 —— 折叠的是展示，不是事实。
  // 这一条替 30+ 处生产入口收口（writingPanes 9 处、TimelineSidePanels 5 处、WritingInspectorPanel 5 处、
  // BookOverviewPanel / InspirationPanels / ProofreadPanels / writingDeskJump 各若干）。
  // 判据直接查 hiddenViewKindsForGenre，不另立一张表：页签该不该出现、这类数据该不该被建，
  // 本来就是同一个问题的两张脸（⑲ 的原话：藏视图不藏入口就是化妆）。
  if (hiddenViewKindsForGenre(genre).includes(kind)) return;
  if (kind === 'writing') {
    ensureCarrierContainer(genre, parseBookIdFromScene());
    return;
  }
  // 视图名与 L2 页签同一个解析器（㉚ T-A）：诗集的这一只视图不该在搜索/列表里叫「大纲」，
  // 而页签已经写着「诗作」。两处各取一次键 = 又一张嘴。
  const label = t(viewKindLabelKey(genre, kind));
  const taken = new Set(es.views.map((v) => v.name));
  let viewName = label;
  let i = 2;
  while (taken.has(viewName)) viewName = `${label} ${i++}`;
  const viewId = es.addView(viewName, { meta: { carrierType: genre || undefined, kind } });
  reconcileStudioPaneView(viewId);
}

/**
 * 载体卡关闭（G1 止血）：固定铺满卡整卡拦截 mousedown/click，永远选不中，
 * Delete 快捷键（依赖 selectedIds）对它无效——此前没有任何删除/退出路径。
 * 行为：
 *   1. removeComponent 移除卡本体；
 *   2. 若所在视图因此变空、又不是结构 default 视图、且还存在其他视图 →
 *      连视图一起回收（「一视图一载体」下关卡 = 关视图，removeView 自动切到相邻视图）。
 * preview 模式（导出预览页）调用方不应渲染关闭按钮。
 */
export function closeCarrierCard(componentId: string): void {
  const es = useEditorStore.getState();
  const viewId = es.activeViewId;
  es.removeComponent(componentId);
  const st = useEditorStore.getState();
  if (st.activeViewId !== viewId) return; // 防御：移除过程中 activeView 被外力切换
  const view = st.views.find((v) => v.id === viewId);
  if (!view || view.id === 'default' || st.views.length <= 1) return;
  if (view.components.length === 0) {
    es.removeView(viewId);
    logger.info('studioBook', 'closeCarrierCard recycled empty view', { viewId });
  }
}
