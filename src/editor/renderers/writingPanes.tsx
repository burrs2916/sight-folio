// 写作编辑面 pane 集合（从 WritingDesignView 抽出，供两处共用）
//
// 为什么抽出来：这些 pane 是**唯一的内容编辑面**（挂载 / 人物 / 世界观 /
// 篇目 / 立意、念头池），直接读写 writing_chapters / writing_outlines / writing_settings。
// 它们原本内嵌在 WritingDesignView 里，只有「左栏拖体裁载体 → writing-workbench 卡」
// 一条通路能到达；而 L2 题材视图（大纲/人物/世界观）铺的是只读分析板 —— 结果
// 「在大纲视图里编辑不了大纲」。抽出后：
//   - WritingDesignView   → 载体卡里的三栏设计视图（原样，行为零变化）；
//   - WritingStudioPane   → L2 题材视图里铺满画布的单 pane（新增通路）。
// 两处共用同一实现，绝不再各写一份（口径分裂是这类 bug 的根源）。
//
// 零 Emotion：纯 div/input/span + inline style + CV 主题助手。
import { useEffect, useMemo, useRef, useState } from 'react';
import { openWritingDesk } from '../../utils/writingDeskWindow';
import { useWritingStore } from '../../store/writingStore';
// ㉣ N-22：日记「谁在写」的唯一口径住 services/writing（解析 / 人称清单 / 文案键），界面只消费。
import { DIARY_PERSONS, diaryPersonLabelKey, parseBookNarrator } from '../../services/writing';
// 字号铁律：新增界面文字一律走 uiFontSize()（本文件 135 处裸 fontSize 是历史欠账，不在本刀范围）
import { uiFontSize } from '../../theme/appearanceScales';
import { useEditorStore } from '../../store/editorStore';
import { WB_TYPE_COLORS } from '../panels/WritingInspectorPanel';
import {
  WORLDBUILDING_TYPE_KEYS,
  parseSettingExtra,
  writingStatsApi,
  type WritingChapter,
  type WritingDailyStat,
  type WritingOutline,
  type WritingSetting,
  type WritingTimelineEvent,
} from '../../services/tauri';
import { ensureWritingBookWired, openChapterCarrierView, openTypedCarrierView } from '../../utils/studioBook';
import { logger } from '../../utils/logger';
import { chaptersOfSetting, toggleSettingOnChapter, settingCompleteness } from '../../utils/writingOutline';
import {
  buildTree,
  forestPreorderIndex,
  treeRowIndent,
  INDENT_BASE,
  INDENT_STEP,
  defaultLevels,
  suggestedChildKind,
  type TreeNode,
} from '../../utils/writingTree';
import { getLang, t } from '../../i18n';
// ㉭ M1a：日记「今天这一条」的既有工具（日期键 / 按日期找条目 / 条目标题 / 写日期进 extra）
import { diaryEntryTitle, findEntryByDate, todayDateKey, writeDiaryDate } from '../../utils/diaryEntry';
import { clipSummary } from '../../utils/writingSearch';
import { CV } from './canvasTheme';
import {
  isComplete,
  buildChapterLanes,
  computeCoverage,
  computeTimelineConflicts,
  compareByAt,
  LANE_COLORS,
  hashStr,
  type Lane,
} from '../../utils/writingTimeline';
import {
  sortForeshadowings,
  sortForeshadowingsByPayoff,
  isOverdue,
  foreshadowStatusColor,
  foreshadowStatusLabelKey,
  foreshadowingsPlantedIn,
  foreshadowingsPayableIn,
  FORESHADOW_STATUSES,
} from '../../utils/writingForeshadowing';
import { ideasOfChapter } from '../../utils/writingOutline';
import {
  buildProofreadReport,
  PROOFREAD_GROUPS,
  filterProofreadIssues,
  proofreadGroupLabelKey,
  proofreadSeverityColor,
  sortProofreadIssues,
  stripHtmlText,
  type ProofreadFinding,
  type ProofreadGroup,
  type ProofreadSeverityFilter,
  type ProofreadSortMode,
} from '../../utils/writingProofread';
import { applyAutoFixesHtml, wordCountOfHtml } from '../proofread/chapterAutoFix';
import {
  buildChapterWordRows,
  buildVolumeRows,
  computeWritingKpis,
  diffDailyStats,
  filterChapterRows,
  sortChapterRows,
  WINDOW_DAYS,
  type StatsChapterFilter,
  type StatsChapterSort,
} from '../../utils/writingStats';
import {
  StorylineDetail,
  StorylineNarrativeView,
  StorylineMatrixView,
  TimelineEventDetail,
} from '../panels/TimelineSidePanels';
import { CastHeatmap, CastMatrix } from './CastAnalysisPanes';
import { WorldbuildingMatrix } from './WorldbuildingAnalysisPanes';
import ChapterPicker from './ChapterPicker';
import EntityPicker from './EntityPicker';
import { ForeshadowingDetail } from '../panels/ForeshadowingPanels';
import { InspirationDetail } from '../panels/InspirationPanels';
import { DraftInput } from '../components/DraftInput';
import { currentScrollBehavior } from '../../utils/reducedMotion';
import { confirmDestructive } from '../../store/confirmStore';
import { genreDef, isCollectionGenre, kpiLabelKeys, unitNameKey, canCreateEntityForGenre } from '../../utils/writingSchema';
// ㉥ M1a：记录条的体裁判据用「这个载体是一条一天吗」的现成唯一口径，不抄体裁清单
import { surfaceKeyForGenre, hasTodayEntryMode } from '../../utils/writingSchema';

// 判定住 writingSchema（体裁决定有什么），这里只**转出**给原 import 路径用，免得同一条判据出现第二份
//（2026-11-09 搬它的时候漏拆原件，这条是补账）。
export { isCollectionGenre };

export const NOVEL_ACCENT = '#4A338F';
export const ESSAY_ACCENT = '#0ea5e9';
/** 诗歌主色**不在这里造新色值**，直接取 writingSchema 里该体裁申报的颜色（体裁色只有一份）。 */
export const POETRY_ACCENT = genreDef('poetry')?.color ?? ESSAY_ACCENT;

/**
 * 体裁 → 编辑面主色。**色值只准取自 `WRITING_GENRES` 的申报色**（体裁色只有一份），
 * 不再逐支 if —— 2026-11-09 诗歌那一刀就是靠这条回落侥幸拿到色，剧本/日记开闸时没人回来补，
 * 于是两本体裁在卡上顶着一样的墨紫（T-D 收的账）。
 *
 * 两处例外都是**历史事实**，写出来而不是默默保留：
 *  - essay 用的是 #0ea5e9，与 schema 申报的 #2563eb 不同。换色是视觉改动，不在本刀范围；
 *  - 空串 / 未登记值 = 小说口径 = 墨紫，与改造前逐字相同。
 */
export function accentForGenre(genre: string): string {
  if (genre === 'essay') return ESSAY_ACCENT;
  const def = genreDef(genre);
  if (def && def.id !== 'novel') return def.color;
  return NOVEL_ACCENT;
}

/**
 * 合集型两栏的措辞 key。两张卡（设计视图 / L2 大纲 pane）都从这里取，
 * 免得"设计卡叫诗作、大纲页签叫篇目"这种半改状态再出现一次。
 * 散文用历史键（篇目 / 立意·素材），诗歌用新键（诗作 / 意象素材）。
 */
const COLLECTION_PANE_KEYS: Record<string, { pieces: string; piecesEmpty: string; ideas: string }> = {
  poetry: {
    pieces: 'writingLeft.tplPoem',
    piecesEmpty: 'writingDesign.emptyPoems',
    ideas: 'writingLeft.tplPoemImagery',
  },
  // 日记也是合集型（isCollectionGenre 已含 diary）：不补这一支，它会拿到散文的「篇目 / 立意」措辞。
  diary: {
    pieces: 'writingLeft.tplDiaryDay',
    piecesEmpty: 'writingDesign.emptyDays',
    ideas: 'writingLeft.tplDiaryMatter',
  },
};
const COLLECTION_PANE_KEYS_DEFAULT = {
  pieces: 'writingDesign.pane.pieces',
  piecesEmpty: 'writingDesign.emptyPieces',
  ideas: 'writingDesign.pane.ideas',
};

export function collectionPaneKeys(genre: string): { pieces: string; piecesEmpty: string; ideas: string } {
  return COLLECTION_PANE_KEYS[genre] ?? COLLECTION_PANE_KEYS_DEFAULT;
}

// ㉭（轮 26 · AI-9）写侧扳正助手 ensureWritingBookWired 整段上收 utils/studioBook.ts ——
// 右栏灵感总览卡也要同一道闸，留在本文件会让 panels 反向 import renderers 成循环引用。
// 本文件三处消费点（StorylinePane 加节点 / StorylineSection 新建线 / PiecesPane 新增）不变。

// 节点拖拽 reparent 的专用 MIME（拖动行首手柄把任意节点挂到另一节点下，串成树）。
export const NODE_DND_MIME = 'application/x-outline-node';

// ─── 通用小件（inline style 常量，全部纯 div/input/span） ───
export const paneStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  border: `1px solid ${CV.divider}`,
  borderRadius: 8,
  overflow: 'hidden',
  background: CV.paper,
};

export const paneHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  borderBottom: `1px solid ${CV.divider}`,
  flexShrink: 0,
};

export const paneBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  // 预留滚动条槽位：树收起/展开时内容高度突变，滚动条出现/消失会让整列横向偏移
  scrollbarGutter: 'stable',
  padding: '6px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

export function rowStyle(): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 6px',
    borderRadius: 6,
    border: `1px solid ${CV.divider}`,
    minWidth: 0,
  };
}

export function tagStyle(accent: string, active: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 9,
    lineHeight: 1,
    padding: '3px 7px',
    borderRadius: 999,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    flexShrink: 0,
    border: `1px solid ${active ? accent : `${accent}44`}`,
  };
  return active
    ? { ...base, color: '#fff', background: accent }
    : { ...base, color: accent, background: 'transparent' };
}

export const inputStyle: React.CSSProperties = {
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: CV.text,
  fontSize: 11,
  padding: 0,
  minWidth: 0,
  fontFamily: 'inherit',
};

export const delBtnStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: CV.text3,
  fontSize: 11,
  lineHeight: 1,
  padding: '2px 4px',
  cursor: 'pointer',
  flexShrink: 0,
};

export function miniBtn(accent: string): React.CSSProperties {
  // 边框透明度：仅 #RRGGBB 可拼 8 位 alpha；CV.error 等 var() 引用回退全色边框（拼后缀是无效 CSS）
  const isHex = /^#[\da-fA-F]{6}$/.test(accent);
  return {
    border: `1px solid ${isHex ? `${accent}55` : accent}`,
    color: accent,
    background: 'transparent',
    borderRadius: 6,
    fontSize: 10,
    padding: '2px 8px',
    cursor: 'pointer',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  };
}

export function PaneHeader({
  label,
  count,
  action,
  onAction,
}: {
  label: string;
  count: number;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div style={paneHeaderStyle}>
      <span style={{ fontSize: 11, fontWeight: 700, color: CV.text }}>{label}</span>
      <span style={{ fontSize: 9.5, color: CV.text3 }}>{count}</span>
      {action && onAction && (
        <button type="button" onClick={onAction} style={{ ...miniBtn('#64748b'), marginLeft: 'auto' }}>
          {action}
        </button>
      )}
    </div>
  );
}

export function EmptyHint({ text }: { text: string }) {
  return <div style={{ fontSize: 10.5, color: CV.text3, lineHeight: 1.6, padding: '6px 4px' }}>{text}</div>;
}

// ─── 人物 / 场景 栏（character 与 worldbuilding 同构，kind 参数化；可编辑） ───
// A+C：每个设定卡现在三件事齐全 ——
//   1) 反向联动：展示该设定出现在哪些章节（chaptersOfSetting，与大纲/检视器同一口径）；
//   2) 从人物侧发起绑定：把该设定挂到未关联章节（toggleSettingOnChapter，与章检视器同一写入口）；
//   3) 编辑档案入口：跳 WritingPage 定位到该设定，复用已做好的档案/关系编辑器。
// 世界观子类型筛选 chip（仅 kind==="worldbuilding" 时渲染；读 worldbuildingProfile.type）
function WbFilterChip({
  label,
  active,
  accent,
  onClick,
}: {
  label: string;
  active: boolean;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 11,
        lineHeight: 1.2,
        padding: '3px 9px',
        borderRadius: 999,
        border: `1px solid ${active ? accent : CV.divider}`,
        background: active ? accent : 'transparent',
        color: active ? '#fff' : CV.text2,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

/** 已绑定章节显示上限（折叠态），防止单条卡片撑爆面板 */
const MAX_VISIBLE_CHAPTERS = 7;

/**
 * ㉣ N-22（2026-11-11 轮 72 续 · 李先生真人原话「日记的人物有主角，是吧？这个人物是谁？我或者是
 * 其他的人？第一人称、第二人称、第三人称，这个都是可以调整的」）：日记书人物栏顶部的「谁在写」条。
 * 人称三档 + 主角称谓**就地可改**，落 `book.extra.diaryNarrator`（零迁移）；另一张嘴在
 * `writingContextProvider`（AI 全书概览）——没有它，模型会自己替创作者挑人称。
 * 只在 `genre === 'diary'` 出现：其余四体裁的人物栏一个像素都不动（零回归线）。
 */
export function DiaryNarratorBar({ bookId, accent }: { bookId?: string; accent: string }) {
  const book = useWritingStore((s) => s.books.find((b) => b.id === bookId));
  const setBookNarrator = useWritingStore((s) => s.setBookNarrator);
  const narrator = parseBookNarrator(book?.extra);
  // 受控但**不镜像**：只在打字期间持草稿，失焦即交还给 extra ⇒ 别处（另一窗口 / AI / 撤销）改过
  // 这行会自然回流，也不在 effect 里同步 setState（那会造级联重渲染，是 lint 警告源）
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? narrator.name;
  if (!book || book.genre !== 'diary') return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        flexWrap: 'wrap',
        padding: '2px 0 6px',
        borderBottom: `1px solid ${CV.divider}`,
        marginBottom: 6,
      }}
    >
      <span style={{ fontSize: uiFontSize(10), fontWeight: 700, color: CV.text2 }}>
        {t('writing.diary.narratorTitle')}
      </span>
      {DIARY_PERSONS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => void setBookNarrator(book.id, { person: p, name })}
          style={{
            ...(narrator.person === p ? miniBtn(accent) : { ...miniBtn('#64748b'), background: 'transparent', color: CV.text2 }),
            fontSize: uiFontSize(10),
            padding: '2px 8px',
          }}
        >
          {t(diaryPersonLabelKey(p))}
        </button>
      ))}
      <input
        value={name}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== narrator.name) {
            void setBookNarrator(book.id, { person: narrator.person, name: draft });
          }
          setDraft(null);
        }}
        placeholder={t('writing.diary.narratorNamePh')}
        aria-label={t('writing.diary.narratorNamePh')}
        style={{
          width: 112,
          fontSize: uiFontSize(10),
          padding: '2px 6px',
          border: `1px solid ${CV.divider}`,
          borderRadius: 6,
          background: 'transparent',
          color: CV.text,
        }}
      />
    </div>
  );
}

export function CastPane({
  kind,
  accent,
  paneLabel,
  emptyText,
  bookId,
}: {
  kind: 'character' | 'worldbuilding';
  accent: string;
  paneLabel: string;
  emptyText: string;
  /** 限定到某一本书；不传则不过滤（保留旧的全书行为，测试用） */
  bookId?: string;
}) {
  const settings = useWritingStore((s) => s.settings);
  const chapters = useWritingStore((s) => s.chapters);
  const outlines = useWritingStore((s) => s.outlines);
  const createSetting = useWritingStore((s) => s.createSetting);
  const updateSetting = useWritingStore((s) => s.updateSetting);
  const deleteSetting = useWritingStore((s) => s.deleteSetting);
  const createOutline = useWritingStore((s) => s.createOutline);
  const updateOutline = useWritingStore((s) => s.updateOutline);
  const list = useMemo(
    () =>
      settings
        .filter((x) => x.kind === kind && (bookId ? x.bookId === bookId : true))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [settings, kind, bookId],
  );
  const bookChapters = useMemo(() => chapters.filter((c) => (bookId ? c.bookId === bookId : true)), [chapters, bookId]);

  // 视图模式：
  //   - character: list / heatmap / matrix
  //   - worldbuilding: list / wb-matrix（世界观矩阵）
  const [viewMode, setViewMode] = useState<'list' | 'heatmap' | 'matrix' | 'wb-matrix'>('list');

  // 已绑定章节折叠（单条卡片独立展开态，防止长列表撑爆面板）
  const [expandedChRows, setExpandedChRows] = useState<Set<string>>(new Set());
  const isExpanded = (id: string) => expandedChRows.has(id);
  const toggleExpanded = (id: string) =>
    setExpandedChRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 设定完整性筛选（character + worldbuilding 共用，判定走 settingCompleteness，零迁移）
  const [wbTypeFilter, setWbTypeFilter] = useState('');
  const filteredList = useMemo(() => {
    if (!wbTypeFilter) return list;
    if (wbTypeFilter === '__incomplete__') {
      return list.filter((s) => !settingCompleteness(kind, s.extra).complete);
    }
    if (kind === 'worldbuilding') {
      return list.filter((s) => parseSettingExtra(s.extra).worldbuildingProfile?.type === wbTypeFilter);
    }
    return list;
  }, [list, kind, wbTypeFilter]);

  // 概览（总数 / 待补全数；worldbuilding 额外算子类型计数），零迁移
  const overview = useMemo(() => {
    let incomplete = 0;
    const subtypeCounts: Record<string, number> = {};
    for (const s of list) {
      if (!settingCompleteness(kind, s.extra).complete) incomplete += 1;
      if (kind === 'worldbuilding') {
        const p = parseSettingExtra(s.extra).worldbuildingProfile;
        const type = typeof p?.type === 'string' && p.type.length > 0 ? p.type : '';
        if (type) subtypeCounts[type] = (subtypeCounts[type] ?? 0) + 1;
      }
    }
    return { total: list.length, incomplete, subtypeCounts };
  }, [list, kind]);

  // 已设置子类型的种类集合（仅 worldbuilding 用于筛选 chip 行，零迁移）
  const wbPresentTypes = useMemo(
    () => (kind === 'worldbuilding' ? Object.keys(overview.subtypeCounts) : []),
    [overview, kind],
  );

  const handleAdd = () => {
    const name =
      kind === 'character'
        ? t('writing.newCharacterName', { n: list.length + 1 })
        : t('writing.newWorldbuildingName', { n: list.length + 1 });
    void createSetting(kind, name);
  };

  // 该书题材（跳正文容器页签需要 genre；CastPane 只有 bookId，从 books 补查）
  const genre = useWritingStore((s) => s.books.find((b) => b.id === bookId)?.genre ?? '');
  // 分析视图接线：点角色 → 右栏检视器；点热力图格子 → 打开该章正文容器页签
  const analyzeCharacter = (settingId: string) => useEditorStore.getState().selectSetting(settingId);
  const openChapterFromAnalysis = (chapterId: string) => {
    const ch = bookChapters.find((c) => c.id === chapterId);
    if (!ch) return;
    openChapterCarrierView(ch.id, ch.title || '', genre, bookId || '');
  };

  // 从人物侧把该设定挂到某章（双向闭环）：人物→cast / 场景→scenes。
  // 走 utils/writingOutline.toggleSettingOnChapter —— 与章检视器同一个写入口。
  const bindToChapter = (settingId: string, chapterId: string) => {
    if (!chapterId) return;
    const key = kind === 'character' ? 'cast' : 'scenes';
    const chapter = bookChapters.find((c) => c.id === chapterId);
    void toggleSettingOnChapter(
      { outlines, createOutline, updateOutline },
      chapterId,
      key,
      settingId,
      chapter?.title || t(surfaceKeyForGenre(genre, 'unitOutline')),
    );
  };

  // 跳到写作台独立窗口并定位到该设定：复用已做好的档案/关系编辑器（与场景栏同一跳转通道）。
  const openProfile = (settingId: string) => {
    void openWritingDesk({ bookId, settingId });
  };

  return (
    <div style={paneStyle}>
      {/* ㉣ N-22：只有日记书的「人物」栏挂这条；世界观栏与其余四体裁逐字不变 */}
      {kind === 'character' && <DiaryNarratorBar bookId={bookId} accent={accent} />}
      <div style={paneHeaderStyle}>
        <span style={{ fontSize: 11, fontWeight: 700, color: CV.text }}>{paneLabel}</span>
        <span style={{ fontSize: 9.5, color: CV.text3 }}>{list.length}</span>
        {/* 视图切换：人物 = 列表/热力图/矩阵；世界观 = 列表/世界观矩阵 */}
        {(kind === 'character' || kind === 'worldbuilding') && (
          <span style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
            {(kind === 'character'
              ? [
                  ['list', t('writing.listView')],
                  ['heatmap', t('writing.heatmapView')],
                  ['matrix', t('writing.matrixView')],
                ]
              : [
                  ['list', t('writing.listView')],
                  ['wb-matrix', t('writing.wbMatrixView')],
                ]
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode as 'list' | 'heatmap' | 'matrix' | 'wb-matrix')}
                style={{
                  border: `1px solid ${viewMode === mode ? accent : CV.divider}`,
                  color: viewMode === mode ? '#fff' : CV.text2,
                  background: viewMode === mode ? accent : 'transparent',
                  borderRadius: 6,
                  fontSize: 10,
                  padding: '2px 8px',
                  cursor: 'pointer',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            ))}
          </span>
        )}
        <button
          type="button"
          onClick={handleAdd}
          style={{ ...miniBtn('#64748b'), marginLeft: kind === 'character' ? 6 : 'auto' }}
        >
          {t('writingDesign.add')}
        </button>
      </div>
      {kind === 'character' && viewMode === 'heatmap' ? (
        <CastHeatmap
          accent={accent}
          bookId={bookId}
          onCharacterClick={analyzeCharacter}
          onCellClick={(_characterId, chapterId) => openChapterFromAnalysis(chapterId)}
        />
      ) : kind === 'character' && viewMode === 'matrix' ? (
        <CastMatrix accent={accent} bookId={bookId} onCharacterClick={analyzeCharacter} />
      ) : kind === 'worldbuilding' && viewMode === 'wb-matrix' ? (
        <WorldbuildingMatrix accent={accent} bookId={bookId} onSettingClick={analyzeCharacter} />
      ) : (
        <>
          {overview.total > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                alignItems: 'baseline',
                padding: '7px 8px 3px',
                fontSize: 10.5,
                color: CV.text2,
                lineHeight: 1.5,
              }}
            >
              <span style={{ fontWeight: 600, color: CV.text }}>
                {t('writing.wbOverviewTotal', { n: overview.total })}
              </span>
              {kind === 'worldbuilding' &&
                WORLDBUILDING_TYPE_KEYS.filter((k) => (overview.subtypeCounts[k] ?? 0) > 0).map((k) => (
                  <span key={k}>
                    {t(`writing.wbTypeOptions.${k}`)} <b style={{ color: CV.text }}>{overview.subtypeCounts[k]}</b>
                  </span>
                ))}
              <span style={{ color: overview.incomplete > 0 ? '#d9822b' : CV.text3 }}>
                {t('writing.wbIncomplete', { n: overview.incomplete })}
              </span>
            </div>
          )}
          {list.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 4,
                flexWrap: 'wrap',
                padding: '6px 8px',
                borderBottom: `1px solid ${CV.divider}`,
              }}
            >
              <WbFilterChip
                label={t('writing.wbFilterAll')}
                active={wbTypeFilter === ''}
                accent={accent}
                onClick={() => setWbTypeFilter('')}
              />
              {kind === 'worldbuilding' &&
                wbPresentTypes.map((k) => (
                  <WbFilterChip
                    key={k}
                    label={t(`writing.wbTypeOptions.${k}`)}
                    active={wbTypeFilter === k}
                    accent={accent}
                    onClick={() => setWbTypeFilter(k)}
                  />
                ))}
              {overview.incomplete > 0 && (
                <WbFilterChip
                  label={t('writing.wbIncompleteShort')}
                  active={wbTypeFilter === '__incomplete__'}
                  accent={accent}
                  onClick={() => setWbTypeFilter(wbTypeFilter === '__incomplete__' ? '' : '__incomplete__')}
                />
              )}
            </div>
          )}
          <div style={paneBodyStyle}>
            {filteredList.length === 0 && <EmptyHint text={emptyText} />}
            {filteredList.map((x) => {
              const appearLabel =
                kind === 'character'
                  ? t(surfaceKeyForGenre(genre, 'appearUnits'))
                  : t(surfaceKeyForGenre(genre, 'relatedUnits'));
              const related = chaptersOfSetting(
                outlines,
                bookChapters,
                x.id,
                kind === 'character' ? 'character' : 'worldbuilding',
              );
              const unbound = bookChapters.filter((c) => !related.some((r) => r.id === c.id));
              return (
                <div key={x.id} style={{ ...rowStyle(), flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent, flexShrink: 0 }} />
                    <DraftInput
                      entityKey={x.id}
                      value={x.name}
                      onCommit={(v) => updateSetting(x.id, { name: v })}
                      placeholder={t('writingDesign.namePh')}
                      style={{ ...inputStyle, fontWeight: 600, flex: 1 }}
                    />
                    <button
                      type="button"
                      title={t('writingDesign.editProfile')}
                      onClick={() => openProfile(x.id)}
                      style={{ ...miniBtn(accent), flexShrink: 0 }}
                    >
                      {t('writingDesign.editProfile')}
                    </button>
                    <button
                      type="button"
                      title={t('writingDesign.viewDetail')}
                      onClick={() => useEditorStore.getState().selectSetting(x.id)}
                      style={{ ...miniBtn(accent), flexShrink: 0 }}
                    >
                      {t('writingDesign.viewDetail')}
                    </button>
                    <button
                      type="button"
                      title={t('writingDesign.deleteIdea')}
                      onClick={() => void deleteSetting(x.id)}
                      style={delBtnStyle}
                    >
                      ×
                    </button>
                  </div>
                  <DraftInput
                    entityKey={x.id}
                    value={x.subtitle}
                    onCommit={(v) => updateSetting(x.id, { subtitle: v })}
                    placeholder={kind === 'character' ? t('writingDesign.identityPh') : t('writingDesign.sceneKindPh')}
                    style={{ ...inputStyle, color: CV.text2, paddingLeft: 12 }}
                  />
                  {/* 反向联动：该设定出现在哪些章节（只读，与大纲/检视器同一口径） */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', paddingLeft: 12 }}>
                    <span style={{ fontSize: 8.5, color: CV.text3, flexShrink: 0 }}>{appearLabel}</span>
                    {related.length === 0 && (
                      <span style={{ fontSize: 9, color: CV.text3 }}>{t(surfaceKeyForGenre(genre, 'unitUnattached'))}</span>
                    )}
                    {related.slice(0, isExpanded(x.id) ? related.length : MAX_VISIBLE_CHAPTERS).map((c) => {
                      const ts = tagStyle(accent, true);
                      return (
                        <span
                          key={c.id}
                          style={{ ...ts, display: 'flex', alignItems: 'center', gap: 2, paddingRight: 5 }}
                        >
                          {c.title}
                          <button
                            type="button"
                            title={t('writingDesign.unbindChapter', { title: c.title })}
                            onClick={(e) => {
                              e.stopPropagation();
                              void bindToChapter(x.id, c.id);
                            }}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: 'rgba(255,255,255,0.7)',
                              fontSize: 10,
                              lineHeight: 1,
                              padding: '0 2px',
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                    {related.length > MAX_VISIBLE_CHAPTERS && !isExpanded(x.id) && (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(x.id)}
                        style={{
                          border: `1px solid ${accent}44`,
                          color: accent,
                          background: 'transparent',
                          borderRadius: 999,
                          fontSize: 9,
                          padding: '2px 8px',
                          cursor: 'pointer',
                          flexShrink: 0,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        +{related.length - MAX_VISIBLE_CHAPTERS}
                      </button>
                    )}
                    {related.length > MAX_VISIBLE_CHAPTERS && isExpanded(x.id) && (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(x.id)}
                        style={{
                          border: 'none',
                          color: CV.text3,
                          background: 'transparent',
                          fontSize: 9,
                          padding: '2px 6px',
                          cursor: 'pointer',
                          flexShrink: 0,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t('writing.collapseChapters')}
                      </button>
                    )}
                  </div>
                  {/* 从人物侧发起绑定：挂到未关联章节（双向闭环）。无可选章节时不渲染。 */}
                  {unbound.length > 0 && (
                    <ChapterPicker
                      uniqueKey={x.id}
                      chapters={unbound}
                      onSelect={(chapterId: string) => void bindToChapter(x.id, chapterId)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── 鸟瞰条：全书形状（按根节点泛化；卷/部/篇…任意根都聚合其子树进度） ───
function countSubtree(node: TreeNode): { total: number; finished: number; draft: number } {
  let total = 1;
  let finished = node.node.status === 'finished' ? 1 : 0;
  let draft = node.node.status === 'draft' ? 1 : 0;
  for (const c of node.children) {
    const s = countSubtree(c);
    total += s.total;
    finished += s.finished;
    draft += s.draft;
  }
  return { total, finished, draft };
}

function BirdEyeBar({ roots }: { roots: TreeNode[] }) {
  // 根太多（如遗留的扁平小说：几十个章都挂在根）时只给全书聚合，避免刷屏
  const showPerRoot = roots.length > 0 && roots.length <= 10;
  const all = roots.reduce(
    (acc, r) => {
      const s = countSubtree(r);
      return { total: acc.total + s.total, finished: acc.finished + s.finished, draft: acc.draft + s.draft };
    },
    { total: 0, finished: 0, draft: 0 },
  );
  // key 用节点 id，不用显示文案：卷名可自由起名，重名（两个「卷 2」）会让 label 撞 key
  const bar = (key: string, label: string, total: number, finished: number, draft: number) => {
    const finishedPct = total > 0 ? (finished / total) * 100 : 0;
    const draftPct = total > 0 ? (draft / total) * 100 : 0;
    return (
      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            fontSize: 10,
            color: CV.text2,
            width: 84,
            flexShrink: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
        <div
          style={{ flex: 1, height: 8, borderRadius: 4, background: '#D3D1C7', display: 'flex', overflow: 'hidden' }}
        >
          <div style={{ width: `${finishedPct}%`, background: '#639922' }} />
          <div style={{ width: `${draftPct}%`, background: '#BA7517' }} />
        </div>
        <span style={{ fontSize: 9, color: CV.text3, flexShrink: 0 }}>
          {finished}/{total}
        </span>
      </div>
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '2px 2px 6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: CV.text3 }}>{t('writingDesign.birdEye')}</span>
      </div>
      {roots.length === 0 && <EmptyHint text={t('writingDesign.emptyOutlineTree')} />}
      {showPerRoot
        ? roots.map((r) => {
            const s = countSubtree(r);
            const label = r.node.kind ? `${r.node.kind} · ${r.node.title}` : r.node.title;
            return bar(r.node.id, label, s.total, s.finished, s.draft);
          })
        : roots.length > 10 && bar('book-total', t('writingDesign.bookTotal'), all.total, all.finished, all.draft)}
    </div>
  );
}

// ─── 递归大纲树节点行（结构树 outliner） ───
// 每行直接操作：拖手柄 reparent / 状态点点击循环 / 层级名行内改 / 标题行内改 /
// 一键加子级（按默认层级顺延）/ 双击标题开写作视图。零配置起步，渐进式自定义。
function NodeRow({
  node,
  levels,
  accent,
  characters,
  scenes,
  bookId,
  bookTitle,
  genre,
}: {
  node: TreeNode;
  levels: string[];
  accent: string;
  characters: WritingSetting[];
  scenes: WritingSetting[];
  bookId: string;
  bookTitle: string;
  genre: string;
}) {
  const reparentNode = useWritingStore((s) => s.reparentNode);
  const renameNodeKind = useWritingStore((s) => s.renameNodeKind);
  const renameChapter = useWritingStore((s) => s.renameChapter);
  const deleteChapter = useWritingStore((s) => s.deleteChapter);
  const createChildNode = useWritingStore((s) => s.createChildNode);
  const outlines = useWritingStore((s) => s.outlines);
  // 大纲行锚点（2026-09-29）：点章节行 → 右栏「属性」tab 展示该章详情卡（与书封面卡同形态）。
  // 选中态走 editorStore.selectedChapterId（与设定/事件/剧情线/伏笔/灵感同一套互斥语义）。
  const chapterSelected = useEditorStore((s) => s.selectedChapterId === node.node.id);
  const selectChapter = useEditorStore((s) => s.selectChapter);
  // 折叠态走 store 内存字段（不落库）：载体卡与 L2 题材编辑面共用同一份展开/收起状态
  const collapsed = useWritingStore((s) => s.collapsedNodeIds.includes(node.node.id));
  const toggleNodeCollapse = useWritingStore((s) => s.toggleNodeCollapse);

  const [editingKind, setEditingKind] = useState(false);
  const [kindDraft, setKindDraft] = useState(node.node.kind);
  const [overNode, setOverNode] = useState(false);
  // 手柄悬停高亮：手柄太小太灰不好抓，悬停时加深 + 浅底，提示「可拖」
  const [hoverHandle, setHoverHandle] = useState(false);

  const childKind = suggestedChildKind(node.node.kind, node.depth, levels);
  const childCount = node.children.length;

  // G1 章级直连 · 大纲行剧情线归属标签：主线归属章在行内露线色点 + 线名（未挂线省略），
  // 点击跳剧情线轴并选中该线（与 StorylineDetail 涉及章节区同一套动线）。
  const storylines = useWritingStore((s) => s.storylines);
  const chapterLine = useMemo(
    () => (node.node.storylineId ? (storylines.find((l) => l.id === node.node.storylineId) ?? null) : null),
    [node.node.storylineId, storylines],
  );

  // 大纲行伏笔微型标识（2026-10-04）：本章有伏笔时显色点提示，pending 优先琥珀，无 pending 则灰点
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const selectForeshadowing = useEditorStore((s) => s.selectForeshadowing);

  const chapterForeshadows = useMemo(
    () => [
      ...foreshadowingsPlantedIn(foreshadowings, node.node.id),
      ...foreshadowingsPayableIn(foreshadowings, node.node.id),
    ],
    [foreshadowings, node.node.id],
  );
  const hasForeshadow = chapterForeshadows.length > 0;
  const fsPending = chapterForeshadows.filter((f) => f.status === 'pending');
  const pendingCount = fsPending.length;
  const firstPendingFs = fsPending[0];
  const firstFs = chapterForeshadows[0];
  const foreshadowTooltip =
    pendingCount > 0 ? `${pendingCount} ${t('writing.foreshadowPayableTitle')}` : t(surfaceKeyForGenre(genre, 'plantedHere'));

  // 大纲行灵感微型标识（2026-10-04）：本章有关联念头时显色点，点击跳灵感页签选中该念头
  const selectInspiration = useEditorStore((s) => s.selectInspiration);

  const chapterIdeas = useMemo(() => ideasOfChapter(outlines, node.node.id), [outlines, node.node.id]);
  const hasIdeas = chapterIdeas.length > 0;
  const firstIdea = chapterIdeas[0];
  const ideaTooltip = `${chapterIdeas.length} ${t('writing.inspirationTreeTooltip')}`;

  const openChapterLine = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (!chapterLine) return;
    try {
      useEditorStore.getState().selectStoryline(chapterLine.id);
      openTypedCarrierView(genre, 'storylines');
    } catch (err) {
      console.warn('NodeRow.openChapterLine failed', String(err));
    }
  };

  const commitKind = () => {
    setEditingKind(false);
    const v = kindDraft.trim();
    if (v && v !== node.node.kind) void renameNodeKind(node.node.id, v);
    else setKindDraft(node.node.kind);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(NODE_DND_MIME)) {
      e.preventDefault();
      setOverNode(true);
    }
  };
  const onDragLeave = (e: React.DragEvent) => {
    // 移出整行（而非滑入内部子元素）才熄灭高亮，避免子元素间移动时闪烁
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverNode(false);
  };
  const onDrop = (e: React.DragEvent) => {
    setOverNode(false);
    const draggedId = e.dataTransfer.getData(NODE_DND_MIME);
    if (draggedId && draggedId !== node.node.id) void reparentNode(draggedId, node.node.id);
  };

  const open = () =>
    openChapterCarrierView(
      node.node.id,
      bookTitle ? `${bookTitle} · ${node.node.title}` : node.node.title,
      genre,
      bookId,
    );

  // 严格按树形深度缩进：每层递进固定步长；INDENT_BASE/STEP 同时供竖向引导线对齐
  const INDENT_BASE = 8;
  const INDENT_STEP = 20;
  const indent = INDENT_BASE + node.depth * INDENT_STEP;

  return (
    <div style={{ position: 'relative' }}>
      {/* 竖向树引导线：每个祖先层一条竖线，贯穿整棵子树；末层再加一条从父线连到本节点的横钩（elbow），
          把「章挂在卷下」的从属关系画成看得见的分支（深层从属关系一眼可读） */}
      {Array.from({ length: node.depth }).map((_, i) => (
        <span
          key={`v${i}`}
          style={{
            position: 'absolute',
            left: INDENT_BASE + i * INDENT_STEP + INDENT_STEP / 2,
            top: 0,
            bottom: 0,
            width: 1,
            background: CV.divider,
            pointerEvents: 'none',
          }}
        />
      ))}
      {node.depth >= 1 && (
        <span
          key="elbow"
          style={{
            position: 'absolute',
            left: INDENT_BASE + (node.depth - 1) * INDENT_STEP + INDENT_STEP / 2,
            top: 11,
            width: INDENT_STEP / 2,
            height: 1,
            background: CV.divider,
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          // 注意 ${indent} 后必须带 px：数字模板插值不会自动加单位，
          // "3px 4px 3px 28" 是非法 CSS 会被整个丢弃（这正是缩进一直不生效的根因）
          padding: `3px 4px 3px ${indent}px`,
          borderRadius: 6,
          border: `1px solid ${chapterSelected ? accent : overNode ? accent : CV.divider}`,
          background: chapterSelected ? `${accent}14` : overNode ? `${accent}14` : 'transparent',
          boxShadow: chapterSelected ? `inset 2px 0 0 ${accent}` : 'none',
          cursor: 'pointer',
        }}
        onClick={() => selectChapter(node.node.id)}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* 拖动手柄：把本节点挂到别的节点下（reparent），串成任意深树。
            加大加深 + 悬停高亮，专治「太小太灰不好抓」。 */}
        <span
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(NODE_DND_MIME, node.node.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onMouseEnter={() => setHoverHandle(true)}
          onMouseLeave={() => setHoverHandle(false)}
          title={t('writingDesign.dropToNest')}
          style={{
            cursor: 'grab',
            color: hoverHandle ? CV.text : CV.text2,
            fontSize: 13,
            lineHeight: 1,
            flexShrink: 0,
            userSelect: 'none',
            padding: '2px 3px',
            borderRadius: 4,
            background: hoverHandle ? `${accent}14` : 'transparent',
          }}
        >
          ⠿
        </span>
        {/* 单点：色=层级（父级墨紫 / 子级天蓝），填充=进度（空心待写 / 半透草稿 / 实心已完）；点击循环状态 */}

        {/* 层级名徽章：点击行内改名（部/卷/章/节/幕/场…，创作者自填） */}
        {editingKind ? (
          <input
            autoFocus
            value={kindDraft}
            onChange={(e) => setKindDraft(e.target.value)}
            onBlur={commitKind}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitKind();
              if (e.key === 'Escape') {
                setKindDraft(node.node.kind);
                setEditingKind(false);
              }
            }}
            placeholder={t('writingDesign.kindPh')}
            style={{ ...inputStyle, width: 46, fontWeight: 600, color: accent, flexShrink: 0 }}
          />
        ) : (
          <span
            onClick={() => {
              setKindDraft(node.node.kind);
              setEditingKind(true);
            }}
            title={t('writingDesign.kindPh')}
            style={{
              fontSize: 9,
              lineHeight: 1,
              padding: '2px 6px',
              borderRadius: 999,
              border: `1px solid ${accent}55`,
              color: accent,
              background: 'transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {node.node.kind || '—'}
          </span>
        )}
        {/* 标题：行内改名；双击开写作视图（封面设置收敛到写作台章树/章详情面板，大纲行不做第二入口） */}
        <DraftInput
          entityKey={node.node.id}
          value={node.node.title}
          onCommit={(v) => renameChapter(node.node.id, v)}
          onDoubleClick={open}
          placeholder={t('writingDesign.titlePh')}
          title={t('writingDesign.openHint')}
          style={{ ...inputStyle, fontWeight: 600, flex: 1, minWidth: 0 }}
        />
        <span style={{ fontSize: 9, color: CV.text3, flexShrink: 0 }}>
          {t('writing.words', { n: node.node.wordCount })}
        </span>
        {/* 主线归属剧情线（G1 章级直连）：线色点 + 线名，点击跳剧情线轴并选中该线 */}
        {chapterLine && (
          <span
            role="button"
            tabIndex={0}
            onClick={openChapterLine}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') openChapterLine(e);
            }}
            title={`${t(surfaceKeyForGenre(genre, 'mainStorylineTitle'))} · ${chapterLine.name}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 9,
              lineHeight: 1,
              padding: '2px 6px',
              borderRadius: 999,
              border: `1px solid ${chapterLine.color || LANE_COLORS[hashStr(chapterLine.id) % LANE_COLORS.length]}55`,
              color: CV.text2,
              background: `${chapterLine.color || LANE_COLORS[hashStr(chapterLine.id) % LANE_COLORS.length]}14`,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: chapterLine.color || LANE_COLORS[hashStr(chapterLine.id) % LANE_COLORS.length],
                flexShrink: 0,
              }}
            />
            {chapterLine.name}
          </span>
        )}
        {/* 一键加子级：默认层级顺延（卷→章→节…），作者随时改名越级 */}
        <button
          type="button"
          onClick={() => void createChildNode(node.node.id, childKind, `${childKind} ${childCount + 1}`)}
          style={{ ...miniBtn(accent), flexShrink: 0 }}
        >
          {t('writingDesign.addChild')}
        </button>
        <button
          type="button"
          onClick={() => void deleteChapter(node.node.id)}
          title={t('writingDesign.deleteNode')}
          style={{ ...delBtnStyle, flexShrink: 0 }}
        >
          ×
        </button>
        {/* 伏笔微型标识：本章有埋设/回收时亮琥珀色点（pending 优先），点击跳伏笔页签 */}
        {hasForeshadow && (
          <span
            role="button"
            tabIndex={0}
            title={foreshadowTooltip}
            onClick={(e) => {
              e.stopPropagation();
              selectForeshadowing((firstPendingFs ?? firstFs).id);
              openTypedCarrierView(genre, 'foreshadowing');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                selectForeshadowing((firstPendingFs ?? firstFs).id);
                openTypedCarrierView(genre, 'foreshadowing');
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 16,
              height: 15,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: firstPendingFs ? foreshadowStatusColor('pending') : foreshadowStatusColor('paidoff'),
                display: 'inline-block',
              }}
            />
          </span>
        )}
        {hasIdeas && (
          <span
            role="button"
            tabIndex={0}
            title={ideaTooltip}
            onClick={(e) => {
              e.stopPropagation();
              if (firstIdea) {
                selectInspiration(firstIdea.id);
                openTypedCarrierView(genre, 'inspiration');
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                if (firstIdea) {
                  selectInspiration(firstIdea.id);
                  openTypedCarrierView(genre, 'inspiration');
                }
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 16,
              height: 15,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#b45309',
                display: 'inline-block',
              }}
            />
          </span>
        )}
        {/* 展开/收起：放**行尾**。下面有子级才出现；收起 = 整棵子树隐藏。与 ＋/× 同款同尺寸
            （delBtnStyle，15px 盒高）；尖角是固定几何 SVG，收起 = 同一图形旋转 -90°，盒子
            尺寸天生恒定，切换零偏移 */}
        {childCount > 0 && (
          <button
            type="button"
            onClick={() => toggleNodeCollapse(node.node.id)}
            title={collapsed ? t('writingDesign.expandNode') : t('writingDesign.collapseNode')}
            style={{
              ...delBtnStyle,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 15,
            }}
          >
            <svg
              width="9"
              height="9"
              viewBox="0 0 10 10"
              style={{
                flexShrink: 0,
                transform: collapsed ? 'translateY(1px) rotate(-90deg)' : 'translateY(1px)',
                transition: 'transform 100ms ease',
              }}
            >
              <path
                d="M2.6 3.4 L5 6.2 L7.4 3.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
      {/* 递归子节点（收起时整棵子树隐藏） */}
      {!collapsed &&
        node.children.map((c) => (
          <NodeRow
            key={c.node.id}
            node={c}
            levels={levels}
            accent={accent}
            characters={characters}
            scenes={scenes}
            bookId={bookId}
            bookTitle={bookTitle}
            genre={genre}
          />
        ))}
    </div>
  );
}

// ─── 小说：主线栏（递归大纲树 + capture-first 灵感箱） ───

// 剧情线管理面（「剧情线」L2 页签的编辑面）：线实体一览 + 新建/删线/跳时间线剧情线轴。
// 此前 storylines 页签不在 STUDIO_PANE_BY_KIND 表内 → 点开是空画布（真实缺陷，2026-09-18 修）。
export function StorylinesPane({ accent, bookId }: { accent: string; bookId: string }) {
  // ㉬ 认书第四例：卡头书名按「本卡 bookId」反查全局书目（父卡 WritingStudioPane 从 config.filePath
  // 现解递进来），与 ㉫ 三处、BookMetaPanel:140-141 同一张嘴。本卡所属的书与工作室当前书分叉可达
  // （写作台书切换器只翻后者）⇒ 旧口径会在诗集的剧情线卡上印小说的名字。
  // 零回归：活跃书 == 本卡书时两个表达式取自同一份 books、命中同一条目，取值逐字相同。
  const bookTitle = useWritingStore((s) => s.books.find((b) => b.id === bookId)?.title) ?? '';
  const storylines = useWritingStore((s) => s.storylines);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  // AI-12 ②（轮 30）：卡头书名与行表都认了本卡书，**只有栏头计数**还在吃活跃书缓存 ⇒ 诗集卡上印
  // 「剧情线 5」、下面只列 2 行。计数与行表必须同源。（selected 按 id 全局查那一眼属选态族，
  // 本轮按台账口径只记录不动手。）
  const bookStorylines = useMemo(() => storylines.filter((l) => l.bookId === bookId), [storylines, bookId]);
  const selectedStorylineId = useEditorStore((s) => s.selectedStorylineId);
  const selected = selectedStorylineId ? (storylines.find((sl) => sl.id === selectedStorylineId) ?? null) : null;
  // P2 视角切换（2026-09-19 / 2026-09-21）：manage=管理卡（编辑面）；narrative=线-事件叙事视角
  // （单线纵向事件链，纯阅读）；matrix=线×章交织总览（跨线横览，纯阅读，点格跳章）。
  // 视角面板不做编辑（编辑面唯一铁律）。
  const [paneMode, setPaneMode] = useState<'manage' | 'narrative' | 'matrix'>('manage');
  // P0-1 就地事件接管：manage 视角点线内事件行，右区就地渲染事件编辑卡（复用右栏 TimelineEventDetail，
  // 一份不写第二份），不触发全局 selectTimelineEvent 互斥清线选中（那是右栏语境语义）。
  // 返回按钮回落线编辑卡；事件被删（TimelineEventDetail 删除会 selectTimelineEvent(null) 清线）时
  // useEffect 兜底恢复线选中。
  const [picked, setPicked] = useState<{ lineId: string; eventId: string } | null>(null);
  const pickedEvent = picked ? (timelineEvents.find((e) => e.id === picked.eventId) ?? null) : null;
  // 事件删除兜底：TimelineEventDetail 删除路径会先 selectTimelineEvent(null) 清掉线选中，
  // 事件没了就把线选回来（picked 残留由渲染守卫 picked.lineId === selected?.id 兜底，
  // 下次点事件行/返回按钮即覆盖，无需在这里清 React state）。
  useEffect(() => {
    if (picked && !pickedEvent) useEditorStore.getState().selectStoryline(picked.lineId);
  }, [picked, pickedEvent]);

  const pillSx = (active: boolean) =>
    ({
      cursor: 'pointer',
      fontSize: 10,
      fontWeight: 700,
      px: 1,
      py: '2px 8px',
      borderRadius: 3,
      border: `1px solid ${active ? accent : CV.divider}`,
      background: active ? `${accent}14` : 'transparent',
      color: active ? accent : CV.text3,
    }) as const;
  return (
    <div style={{ ...paneStyle, borderColor: 'transparent' }}>
      <PaneHeader label={t('writing.viewKind.storylines')} count={bookStorylines.length} />
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <button type="button" style={pillSx(paneMode === 'manage')} onClick={() => setPaneMode('manage')}>
          {t('writing.storylineViewManage')}
        </button>
        <button type="button" style={pillSx(paneMode === 'narrative')} onClick={() => setPaneMode('narrative')}>
          {t('writing.storylineViewNarrative')}
        </button>
        <button type="button" style={pillSx(paneMode === 'matrix')} onClick={() => setPaneMode('matrix')}>
          {t('writing.storylineViewMatrix')}
        </button>
      </div>
      {/* 两栏就地编辑：左线行表（点行选中，不跳走）+ 右侧编辑卡（名/色板/描述/线内事件/联动）。
          编辑能力复用右栏同款 StorylineDetail / TimelineEventDetail，两处共享不写第二份。 */}
      <div style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        <div style={{ width: 232, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <StorylineSection accent={accent} bookId={bookId} embed="pane" />
          {bookTitle && <span style={{ fontSize: 9.5, color: CV.text3 }}>{bookTitle}</span>}
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            border: `1px solid ${CV.divider}`,
            borderRadius: 8,
            background: CV.paper,
          }}
        >
          {paneMode === 'matrix' ? (
            /* 交织总览不需要选中线：跨线横览正是未选中态的主价值 */
            <StorylineMatrixView accent={accent} bookId={bookId} />
          ) : picked && pickedEvent && picked.lineId === selected?.id ? (
            /* 就地事件卡：返回按钮回落线编辑卡，事件编辑复用右栏同款 */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 8px 0' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: CV.text3, textTransform: 'uppercase' }}>
                  {t('writing.timelineDetailTitle')}
                </span>
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  title={t('writing.storylineDetailBack')}
                  style={{ ...miniBtn(accent), fontSize: 9.5, padding: '1px 8px', marginLeft: 'auto' }}
                >
                  ← {t('writing.storylineDetailBack')}
                </button>
              </div>
              <TimelineEventDetail key={picked.eventId} event={pickedEvent} bookId={bookId} />
            </div>
          ) : !selected ? (
            <div
              style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
            >
              <EmptyHint text={t('writing.storylineNarrativePick')} />
            </div>
          ) : paneMode === 'narrative' ? (
            <StorylineNarrativeView key={selected.id} storyline={selected} bookId={bookId} />
          ) : (
            <StorylineDetail
              key={selected.id}
              storyline={selected}
              bookId={bookId}
              onEventPick={(eventId) => setPicked({ lineId: selected.id, eventId })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// 伏笔页签编辑面（对标 StorylinesPane 两栏）：左=状态分组行表（待回收/已回收/已弃置 + 跨章预警 ⚠），
// 右=选中伏笔编辑卡（复用右栏同款 ForeshadowingDetail，一份不写第二份）。
export function ForeshadowingsPane({ accent, bookId }: { accent: string; bookId: string }) {
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const chapters = useWritingStore((s) => s.chapters);
  // AI-12 ③（轮 30）：本卡三张嘴同病 —— 行表（sorted 全表）、栏头/小节计数、「新建伏笔」默认名，
  // 外加写侧 createForeshadowing 按工作室活跃书落库。统一按本卡书收源。
  // **chapters 那一眼不动**：本 pane 没有「按本卡书装载章节」的 loader，滤了会把回收章名读空
  //（装载 guard 族本轮不许顺手 = 轮 27 取证 (b)：强载会抽走活跃书缓存）。
  const bookForeshadowings = useMemo(() => foreshadowings.filter((f) => f.bookId === bookId), [foreshadowings, bookId]);
  const loadForeshadowings = useWritingStore((s) => s.loadForeshadowings);
  const createForeshadowing = useWritingStore((s) => s.createForeshadowing);
  const selectedForeshadowingId = useEditorStore((s) => s.selectedForeshadowingId);
  const selected = selectedForeshadowingId
    ? (foreshadowings.find((f) => f.id === selectedForeshadowingId) ?? null)
    : null;
  // 装载补齐：本 pane 可能先于其它入口挂载。
  useEffect(() => {
    const ws = useWritingStore.getState();
    if (ws.activeBookId && ws.foreshadowings.length === 0) void ws.loadForeshadowings().catch(() => {});
  }, [loadForeshadowings]);
  const [sortMode, setSortMode] = useState<'status' | 'payoff'>('status');
  const sorted = useMemo(
    () =>
      sortMode === 'status'
        ? sortForeshadowings(bookForeshadowings, chapters)
        : sortForeshadowingsByPayoff(bookForeshadowings, chapters),
    [sortMode, bookForeshadowings, chapters],
  );

  const handleCreate = async () => {
    // AI-12 ③ 写侧：先扳正本卡书再落（认书族同一道闸），扳不动宁可不建 —— 不扳正就是把伏笔静默
    // 建进工作室当前书；默认名也不再数整份缓存。
    if (!(await ensureWritingBookWired(bookId))) return;
    const item = await createForeshadowing(t('writing.foreshadowDefaultName', { n: bookForeshadowings.length + 1 }));
    if (item) useEditorStore.getState().selectForeshadowing(item.id);
  };

  // 回收时间线分组：按 payoff 排序后按章聚组（列表已保证同章连续），无回收章沉底。
  const payoffGroups = useMemo(() => {
    const groups: { chapterId: string | null; items: (typeof sorted)[number][] }[] = [];
    let current: (typeof groups)[number] | null = null;
    for (const f of sorted) {
      if (f.payoffChapterId && current && current.chapterId === f.payoffChapterId) {
        current.items.push(f);
      } else {
        current = { chapterId: f.payoffChapterId ?? null, items: [f] };
        groups.push(current);
      }
    }
    return groups;
  }, [sorted]);

  // 单行渲染复用（状态分组 / 回收时间线共用，口径同一份）。
  const renderForeshadowRow = (f: (typeof sorted)[number]) => {
    const active = selectedForeshadowingId === f.id;
    const overdue = isOverdue(f, chapters);
    const payoffCh = f.payoffChapterId ? chapters.find((c) => c.id === f.payoffChapterId) : null;
    return (
      <button
        key={f.id}
        type="button"
        onClick={() => useEditorStore.getState().selectForeshadowing(f.id)}
        title={t('writing.foreshadowSelect')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          width: '100%',
          textAlign: 'left',
          padding: '2px 4px',
          borderRadius: 4,
          border: 'none',
          cursor: 'pointer',
          minWidth: 0,
          background: active ? 'rgb(var(--template-palette-primary-mainChannel) / 0.08)' : 'transparent',
          boxShadow: active ? `inset 0 0 0 1px ${accent}` : 'none',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: foreshadowStatusColor(f.status),
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: CV.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {f.title || t('writing.foreshadowUntitled')}
        </span>
        {payoffCh?.title ? (
          <span
            style={{
              fontSize: 8.5,
              color: CV.text3,
              flexShrink: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 56,
            }}
          >
            {payoffCh.title}
          </span>
        ) : null}
        {overdue && (
          <span style={{ fontSize: 10, color: '#b45309', flexShrink: 0 }} title={t('writing.foreshadowOverdueTitle')}>
            ⚠
          </span>
        )}
      </button>
    );
  };

  return (
    <div style={{ ...paneStyle, borderColor: 'transparent' }}>
      <PaneHeader label={t('writing.viewKind.foreshadowing')} count={bookForeshadowings.length} />
      <div style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        {/* 左：状态分组行表 */}
        <div style={{ width: 232, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              border: `1px solid ${CV.divider}`,
              borderRadius: 8,
              background: CV.paper,
              padding: '6px 8px',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: bookForeshadowings.length > 0 ? 5 : 0,
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 700, color: CV.text3 }}>
                {t('writing.viewKind.foreshadowing')}
              </span>
              <span style={{ fontSize: 9, color: CV.text3 }}>{bookForeshadowings.length}</span>
              <button
                type="button"
                onClick={() => void handleCreate()}
                title={t('writing.foreshadowCreate')}
                style={{ ...miniBtn(accent), marginLeft: 'auto', fontSize: 9.5, padding: '1px 8px' }}
              >
                ＋ {t('writing.foreshadowCreate')}
              </button>
            </div>
            {bookForeshadowings.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                {(
                  [
                    ['status', t('writing.foreshadowSortStatus')],
                    ['payoff', t('writing.foreshadowSortPayoff')],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSortMode(mode)}
                    title={label}
                    style={{
                      flex: 1,
                      fontSize: 9,
                      padding: '2px 0',
                      borderRadius: 4,
                      border: '1px solid',
                      borderColor: sortMode === mode ? accent : CV.divider,
                      background: sortMode === mode ? 'rgb(var(--template-palette-primary-mainChannel) / 0.08)' : 'transparent',
                      color: sortMode === mode ? accent : CV.text3,
                      fontWeight: sortMode === mode ? 700 : 400,
                      cursor: 'pointer',
                      minWidth: 0,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {bookForeshadowings.length === 0 ? (
              <EmptyHint text={t('writing.foreshadowEmptyHint')} />
            ) : sortMode === 'status' ? (
              FORESHADOW_STATUSES.map((st) => {
                const group = sorted.filter((f) => f.status === st);
                if (group.length === 0) return null;
                return (
                  <div key={st} style={{ marginBottom: 4 }}>
                    <div
                      style={{ fontSize: 9, fontWeight: 700, color: foreshadowStatusColor(st), margin: '4px 0 2px' }}
                    >
                      {t(foreshadowStatusLabelKey(st))} · {group.length}
                    </div>
                    {group.map(renderForeshadowRow)}
                  </div>
                );
              })
            ) : (
              payoffGroups.map((g) => {
                const ch = g.chapterId ? chapters.find((c) => c.id === g.chapterId) : null;
                return (
                  <div key={g.chapterId ?? '__unanchored__'} style={{ marginBottom: 4 }}>
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: g.chapterId ? CV.text2 : CV.text3,
                        margin: '4px 0 2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={
                        g.chapterId ? ch?.title || t('writing.emptyChapterTitle') : t('writing.foreshadowNoChapter')
                      }
                    >
                      {g.chapterId ? ch?.title || t('writing.emptyChapterTitle') : t('writing.foreshadowNoChapter')} ·{' '}
                      {g.items.length}
                    </div>
                    {g.items.map(renderForeshadowRow)}
                  </div>
                );
              })
            )}
          </div>
          <span style={{ fontSize: 9.5, color: CV.text3 }}>
            {useWritingStore.getState().books.find((b) => b.id === bookId)?.title ?? ''}
          </span>
        </div>
        {/* 右：编辑卡（复用右栏同款） */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            border: `1px solid ${CV.divider}`,
            borderRadius: 8,
            background: CV.paper,
          }}
        >
          {selected ? (
            <ForeshadowingDetail key={selected.id} item={selected} bookId={bookId} />
          ) : (
            <div
              style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
            >
              <EmptyHint text={t('writing.foreshadowPaneEditHint')} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 灵感 pane（灵感页签编辑面）：念头池（outlines 中未挂载的松散条目，零新表） ───
// 与大纲页签「记个念头」/ 散文 IdeasPane 同池不分裂；本 pane 是念头的工作台：
// 左 = 零阻力速记输入（回车即建并选中）+ 念头行表；
// 右 = 编辑与分发卡（⇢转时间线草稿 / ⇢转伏笔草稿 / 删除）。
export function InspirationsPane({ accent, bookId }: { accent: string; bookId: string }) {
  const outlines = useWritingStore((s) => s.outlines);
  const chapters = useWritingStore((s) => s.chapters);
  const createOutline = useWritingStore((s) => s.createOutline);
  const selectedInspirationId = useEditorStore((s) => s.selectedInspirationId);
  // ㉮ 认书第六例（轮 27 · AI-10）：本 pane 的 bookId 早就是必填 prop（WritingStudioPane:214 递），
  // 改造前只用在栏尾书名一行（:1807），**池子、计数、选中态、落书四张嘴全吃工作室活跃书**——
  // 与 ㉫ 修过的 StorylinePane/PiecesPane 同族同形状。现在统一按本卡书：同书 = 装载器本就
  // list(bookId) 的 no-op（逐字 = 改造前）；分叉 = 行表宁缺不错、选中卡不隔书开、新增先扳正再落。
  const bookOutlines = useMemo(() => outlines.filter((o) => o.bookId === bookId), [outlines, bookId]);
  const selected = selectedInspirationId ? (bookOutlines.find((o) => o.id === selectedInspirationId) ?? null) : null;
  // 念头树 = 章节树（与大纲页签同构、同源）：念头本身无 parentId，树形只能来自
  // chapterId → buildTree 的章节树。与大纲一致的两件事：① 顺序按「绑定章节在章节树
  // 先序遍历中的位次」（forestPreorderIndex），不再按 outline 的 sortOrder 平铺；
  // ② 每条念头渲染祖先竖线 + 末层 elbow 引导线（与 NodeRow 同款），把从属关系画出来。
  // 未绑定 / 章节查不到的游离念头排最前（depth 0 基准，保持原相对顺序）。
  const forest = useMemo(() => buildTree(chapters), [chapters]);
  const preorder = useMemo(() => forestPreorderIndex(forest), [forest]);
  const sortedOutlines = useMemo(() => {
    const free: WritingOutline[] = [];
    const bound: WritingOutline[] = [];
    for (const o of bookOutlines) {
      const meta = o.chapterId ? preorder.get(o.chapterId) : undefined;
      if (meta) bound.push(o);
      else free.push(o);
    }
    bound.sort((a, b) => preorder.get(a.chapterId!)!.index - preorder.get(b.chapterId!)!.index);
    return [...free, ...bound];
  }, [bookOutlines, preorder]);
  // 零阻力速记：进页签光标即在输入框（capture-first）；回车落池后焦点回到输入框，
  // 连续记多条不断流（右卡标题 autoFocus 会抢焦点，这里显式抢回来）。
  const [capture, setCapture] = useState('');
  const [captureFocus, setCaptureFocus] = useState(false);
  const captureRef = useRef<HTMLInputElement>(null);

  const handleCapture = async () => {
    const text = capture.trim();
    if (!text) return;
    // ㉮ 写侧先扳正再落（㉫/㉭ 同一道闸）：createOutline 落在点回车那一刻的活跃书，
    // 不扳正就会把 B 卡上的速记静默建进 A；扳不动（无卡书/接线失败）宁可不建。
    if (!(await ensureWritingBookWired(bookId))) return;
    const item = await createOutline(text);
    setCapture('');
    if (item) useEditorStore.getState().selectInspiration(item.id);
    captureRef.current?.focus();
  };

  return (
    <div style={{ ...paneStyle, borderColor: 'transparent' }}>
      <PaneHeader label={t('writing.viewKind.inspiration')} count={bookOutlines.length} />
      <div style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        {/* 左：速记输入 + 念头行表 */}
        <div style={{ width: 232, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              border: `1px solid ${CV.divider}`,
              borderRadius: 8,
              background: CV.paper,
              padding: '6px 8px',
              flexShrink: 0,
            }}
          >
            <input
              ref={captureRef}
              autoFocus
              value={capture}
              onChange={(e) => setCapture(e.target.value)}
              onFocus={() => setCaptureFocus(true)}
              onBlur={() => setCaptureFocus(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void handleCapture();
              }}
              placeholder={t('writing.inspirationCapturePh')}
              style={{
                ...inputStyle,
                width: '100%',
                boxSizing: 'border-box',
                border: `1px solid ${captureFocus ? accent : CV.divider}`,
                borderRadius: 6,
                background: 'rgba(127,127,127,0.07)',
                padding: '5px 8px',
                fontSize: 12,
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
              <span style={{ fontSize: 9, color: CV.text3 }}>{t('writing.inspirationPoolLabel')}</span>
              <span style={{ fontSize: 9, color: CV.text3 }}>{bookOutlines.length}</span>
            </div>
            {sortedOutlines.length === 0 ? (
              <EmptyHint text={t('writing.inspirationEmptyHint')} />
            ) : (
              sortedOutlines.map((b) => {
                const active = selectedInspirationId === b.id;
                // 与大纲 NodeRow 同源同口径：depth 取绑定章节在章节树中的深度（未绑定/查不到 = 0）
                const depth = b.chapterId ? (preorder.get(b.chapterId)?.depth ?? 0) : 0;
                return (
                  <div key={b.id} style={{ position: 'relative' }}>
                    {/* 竖向树引导线 + elbow：与 NodeRow 同款，画祖先层级从属关系（缩进只表达层级，
                        引导线才把「挂在谁下面」画成看得见的分支） */}
                    {Array.from({ length: depth }).map((_, i) => (
                      <span
                        key={`v${i}`}
                        style={{
                          position: 'absolute',
                          left: INDENT_BASE + i * INDENT_STEP + INDENT_STEP / 2,
                          top: 0,
                          bottom: 0,
                          width: 1,
                          background: CV.divider,
                          pointerEvents: 'none',
                        }}
                      />
                    ))}
                    {depth >= 1 && (
                      <span
                        key="elbow"
                        style={{
                          position: 'absolute',
                          left: INDENT_BASE + (depth - 1) * INDENT_STEP + INDENT_STEP / 2,
                          top: 9,
                          width: INDENT_STEP / 2,
                          height: 1,
                          background: CV.divider,
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => useEditorStore.getState().selectInspiration(b.id)}
                      title={
                        b.summary && b.summary.trim() ? clipSummary(b.summary, 80) : t('writing.inspirationSelect')
                      }
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: 1,
                        width: '100%',
                        textAlign: 'left',
                        padding: `2px 4px 2px ${treeRowIndent(depth)}`,
                        borderRadius: 4,
                        border: 'none',
                        cursor: 'pointer',
                        minWidth: 0,
                        background: active ? 'rgb(var(--template-palette-primary-mainChannel) / 0.08)' : 'transparent',
                        boxShadow: active ? `inset 0 0 0 1px ${accent}` : 'none',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        <span style={{ fontSize: 8, color: accent, flexShrink: 0 }}>◆</span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: CV.text,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {b.title || b.summary || t('writing.inspirationUntitled')}
                        </span>
                      </span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <span style={{ fontSize: 9.5, color: CV.text3 }}>
            {useWritingStore.getState().books.find((b) => b.id === bookId)?.title ?? ''}
          </span>
        </div>
        {/* 右：编辑与分发卡（复用右栏同款，key 重挂） */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            border: `1px solid ${CV.divider}`,
            borderRadius: 8,
            background: CV.paper,
          }}
        >
          {selected ? (
            <InspirationDetail key={selected.id} beat={selected} bookId={bookId} />
          ) : (
            <div
              style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
            >
              <EmptyHint text={t('writing.inspirationPaneEditHint')} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 校对 pane（校对页签编辑面）：全书体检发现清单（纯本地派生，零新表） ───
// 六组维度（章文本/伏笔/时间线/剧情线/念头池/一致性），算法收拢 utils/writingProofread
// （与右栏总览卡同一份）。发现**即点即跳**：章→开章写作视图、伏笔→伏笔页签选中、
// 时间线事件→时间线选中、念头→灵感选中、设定→人物页签、汇总行→对应页签。
export function ProofreadPane({ accent, bookId }: { accent: string; bookId: string }) {
  const chapters = useWritingStore((s) => s.chapters);
  const outlines = useWritingStore((s) => s.outlines);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const storylines = useWritingStore((s) => s.storylines);
  const settings = useWritingStore((s) => s.settings);
  const books = useWritingStore((s) => s.books);
  const genre = books.find((b) => b.id === bookId)?.genre ?? '';
  // ㉯ 认书第七例（轮 28 · AI-11）：六组体检输入**全走本卡书**。这六份是「按工作室活跃书装载」的整份缓存，
  // 分叉可达且持久（写作台书切换器只翻 activeBookId，卡片挂载接线不重跑）⇒ 旧口径会在诗集 B 的校对 pane
  // 里报小说 A 的发现。它与右栏 ProofreadOverviewCard 是同名两张嘴，㉫ 已把那张的六组输入按本卡过滤
  // （形状同源，禁止第二份），这张补齐。**硬纪律（AI-11 在册）：六扇门必须同轮关**——半接会造出
  // 「A 的章病 + B 的念头」这类半真报告（AU-7 ⑨ 的 pane 版）。store 本就按书装载（loaders 全部 list(bookId)），
  // 同书过滤 no-op；分叉时宁可报空，不把别本书的体检数报在这本书的卡上（宁缺不错）。
  const report = useMemo(
    () =>
      buildProofreadReport(
        chapters.filter((c) => c.bookId === bookId),
        outlines.filter((o) => o.bookId === bookId),
        timelineEvents.filter((e) => e.bookId === bookId),
        foreshadowings.filter((f) => f.bookId === bookId),
        storylines.filter((l) => l.bookId === bookId),
        settings.filter((s) => s.bookId === bookId),
        // ㉬ N-21：体裁进报告。本 pane 的 genre 已按本卡书判好（上面第 1949 行），直接递
        genre,
      ),
    [chapters, outlines, timelineEvents, foreshadowings, storylines, settings, bookId, genre],
  );
  // T3 ③：挂载时从返回上下文取浏览态初值（正文容器「返回校对」切回时恢复；无则默认）。
  // 消费语义：返回上下文由跳转前写入、本 pane 挂载读取，恢复后立即清空防重复。
  const returnCtx = useEditorStore((s) => s.proofreadReturnCtx);
  const [activeGroup, setActiveGroup] = useState<ProofreadGroup>(() => returnCtx?.group ?? 'chapter-text');
  const [sevFilter, setSevFilter] = useState<ProofreadSeverityFilter>(() => returnCtx?.sev ?? 'all');
  const [sortMode, setSortMode] = useState<ProofreadSortMode>(() => returnCtx?.sort ?? 'default');
  // 列表滚动容器（返回上下文中的滚动位置恢复目标）
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!returnCtx) return;
    useEditorStore.getState().setProofreadReturnCtx(null); // 消费即清，防重复恢复
    if (returnCtx.scrollTop > 0) {
      // 列表渲染后再滚动（挂载早期 DOM 未就绪；不抢 flashKey 定位的滚动时机）。
      // 刻意不挂 effect cleanup：消费清空（returnCtx→null）会让本 effect 重跑并先执行
      // cleanup，若在此清定时器，返回后的滚动位置将永远无法恢复；定时器回调只操作
      // 已挂载 DOM，组件卸载后残留调用无害（与 locateJump 高亮熄灭定时器同一决策）。
      window.setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = returnCtx.scrollTop;
      }, 80);
    }
  }, [returnCtx]);
  const groupIssues = useMemo(() => {
    const base = report.issues.filter((i) => i.group === activeGroup);
    return sortProofreadIssues(
      filterProofreadIssues(base, sevFilter),
      sortMode,
      chapters.map((c) => c.id),
    );
  }, [report, activeGroup, sevFilter, sortMode, chapters]);

  // T5：章检视器 → 校对页签定位联动。消费 proofreadFocusKey：
  // 切到目标 issue 的组 → 重置过滤保证行可见 → 闪烁高亮定位行 → 消费清空防重复触发。
  const focusTarget = useEditorStore((s) => s.proofreadFocusKey);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  useEffect(() => {
    if (!focusTarget) return;
    const issue = report.issues.find((i) => i.key === focusTarget);
    if (!issue) return; // 已修复/不存在：只消费不清闪
    setActiveGroup(issue.group);
    setSevFilter('all');
    setFlashKey(focusTarget);
    useEditorStore.getState().setProofreadFocusKey(null);
  }, [focusTarget, report]);

  // 定位行渲染完成后滚动到可视区；闪烁 1.8s 后自动熄灭
  useEffect(() => {
    if (!flashKey) return;
    if (!groupIssues.some((i) => i.key === flashKey)) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`proofread-row-${flashKey}`)?.scrollIntoView({ block: 'nearest' });
    }, 60);
    const clear = window.setTimeout(() => setFlashKey((k) => (k === flashKey ? null : k)), 1800);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clear);
    };
  }, [flashKey, groupIssues]);

  /** 可一键修复的章集合：从报告派生——章文本聚合行携带引擎全量 textHits，任一命中带 fix 即可修。
   *  （引擎扫描只跑一次：报告生成时；不再对每章重跑 hasAutoFixableHtml，消除同一章第三遍扫描。） */
  const autoFixableChapterIds = useMemo(() => {
    const set = new Set<string>();
    for (const i of report.issues) {
      if (i.group !== 'chapter-text' || i.target?.type !== 'chapter') continue;
      // 文本层：命中带 fix 才可修；结构层（Struct* 前缀）由 applyAutoFixesHtml 一并规范化，同样可修
      const structFixable = i.messageKey.startsWith('Struct') && i.messageKey !== 'StructHeadingInBody';
      if (structFixable || i.textHits?.some((h) => h.fix)) set.add(i.target.id);
    }
    return set;
  }, [report]);

  /** 一键修复：对该章做可自动修复项的全量替换并落库（saveChapterContent 同步 store → 报告自动重算） */
  const fixChapter = async (chapterId: string) => {
    try {
      const c = chapters.find((x) => x.id === chapterId);
      if (!c || !c.content) return;
      const { html, fixedCount } = applyAutoFixesHtml(c.content);
      if (fixedCount === 0) return;
      await useWritingStore.getState().saveChapterContent(chapterId, html, wordCountOfHtml(html));
      logger.info('ProofreadPane', 'chapter auto-fix applied', { chapterId, fixedCount });
    } catch (e) {
      logger.warn('ProofreadPane', 'fixChapter failed', { chapterId, error: String(e) });
    }
  };

  /** 全书一键修复的结果回执（就地显示，不弹 toast：toast 会自己消失，
   *  用户来不及看清"改了哪些章、其中几章动的是排版"）。 */
  const [fixAllReceipt, setFixAllReceipt] = useState<string | null>(null);
  const [fixingAll, setFixingAll] = useState(false);

  const runFixAllChapters = async (ids: string[]) => {
    setFixingAll(true);
    let chaptersFixed = 0;
    let hits = 0;
    let structChapters = 0;
    try {
      for (const id of ids) {
        const c = chapters.find((x) => x.id === id);
        if (!c?.content) continue;
        // 与单章修复**同一个函数**：结构层规范化 + 文本层带 fix 的替换
        const r = applyAutoFixesHtml(c.content);
        if (r.fixedCount === 0) continue;
        await useWritingStore
          .getState()
          .saveChapterContent(id, r.html, wordCountOfHtml(r.html));
        chaptersFixed += 1;
        hits += r.fixedCount;
        if (r.structFixed) structChapters += 1;
      }
      setFixAllReceipt(t('writing.proofreadFixAllDone', { c: chaptersFixed, n: hits, s: structChapters }));
      logger.info('ProofreadPane', 'fix all chapters applied', { chaptersFixed, hits, structChapters });
    } catch (e) {
      logger.warn('ProofreadPane', 'fixAllChapters failed', { error: String(e) });
      setFixAllReceipt(t('writing.proofreadFixAllFailed'));
    } finally {
      setFixingAll(false);
    }
  };

  /** 动手前先说清后果（全局确认出口，禁 window.confirm）：改的是正文、能不能撤回 */
  const fixAllChapters = () => {
    const ids = [...autoFixableChapterIds];
    if (ids.length === 0) return;
    confirmDestructive({
      title: t('writing.proofreadFixAllTitle', { n: ids.length }),
      impact: [
        t('writing.proofreadFixAllImpactScope', { n: ids.length }),
        t('writing.proofreadFixAllImpactKind'),
        t('writing.proofreadFixAllImpactUndo'),
      ],
      confirmLabel: t('writing.proofreadFixAllConfirm'),
      cancelLabel: t('ui.cancel'),
      onConfirm: () => {
        void runFixAllChapters(ids);
      },
    });
  };

  /** 发现即点即跳（renderable ≠ useful：每条发现都必须可行动） */
  const jumpIssue = (issue: ProofreadFinding) => {
    try {
      const tg = issue.target;
      if (!tg) return;
      const es = useEditorStore.getState();
      if (tg.type === 'chapter') {
        if (!bookId) return; // openChapterCarrierView 需要有效 bookId
        // T3 ①：离开校对前保存返回上下文（组/过滤/排序 + 列表滚动位置），
        // 正文容器「返回校对」切回后由 ProofreadPane 挂载恢复（消费后清空）。
        es.setProofreadReturnCtx({
          group: activeGroup,
          sev: sevFilter,
          sort: sortMode,
          scrollTop: listRef.current?.scrollTop ?? 0,
        });
        // T3 ②：文本类聚合行携带首个命中片段，正文编辑器按包含匹配滚动高亮（章内粗定位）；
        // 报告行携引擎全量 textHits（punct/redundant 等也随行带出）→ 正文容器展开「章内逐条闭环」。
        if (issue.textHits?.length && issue.textHits[0]) {
          es.setProofreadJumpAnchor({
            chapterId: tg.id,
            anchor: issue.locator?.anchor ?? stripHtmlText(issue.textHits[0].excerpt).slice(0, 16),
            textHits: issue.textHits,
          });
        } else if (issue.locator?.anchor) {
          es.setProofreadJumpAnchor({ chapterId: tg.id, anchor: issue.locator.anchor });
        }
        const ch = chapters.find((c) => c.id === tg.id);
        openChapterCarrierView(tg.id, ch?.title ?? '', genre, bookId);
      } else if (tg.type === 'foreshadowing') {
        es.selectForeshadowing(tg.id);
        openTypedCarrierView(genre, 'foreshadowing');
      } else if (tg.type === 'timeline-event') {
        es.selectTimelineEvent(tg.id);
        openTypedCarrierView(genre, 'timeline');
      } else if (tg.type === 'idea') {
        es.selectInspiration(tg.id);
        openTypedCarrierView(genre, 'inspiration');
      } else if (tg.type === 'setting') {
        // 一致性发现：选中那张卡再开人物页签（卡不在画布上，光跳页签看不到重点）
        es.selectSetting(tg.id);
        openTypedCarrierView(genre, 'characters');
      } else if (tg.type === 'storyline') {
        // 线级发现（悬空/搁置）：切剧情线视角并选中这条线，与写作台跳转同语义。
        // 不切视角的话 selectStoryline 在主窗口里可能根本没有可见效果。
        if (es.timelineViewMode !== 'storyline') es.setTimelineViewMode('storyline');
        es.selectStoryline(tg.id);
        openTypedCarrierView(genre, 'storylines');
      } else {
        openTypedCarrierView(genre, tg.id);
      }
    } catch (e) {
      logger.warn('ProofreadPane', 'jumpIssue failed', { key: issue.key, error: String(e) });
    }
  };

  return (
    <div style={{ ...paneStyle, borderColor: 'transparent' }}>
      <PaneHeader label={t('writing.viewKind.proofread')} count={report.issues.length} />
      <div style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        {/* 左：六组维度导航 */}
        <div style={{ width: 200, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              border: `1px solid ${CV.divider}`,
              borderRadius: 8,
              background: CV.paper,
              padding: '6px 8px',
              flexShrink: 0,
            }}
          >
            {PROOFREAD_GROUPS.map((g) => {
              const n = report.counts[g];
              const active = activeGroup === g;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setActiveGroup(g)}
                  title={t('writing.proofreadGroupSwitch')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    width: '100%',
                    textAlign: 'left',
                    padding: '4px 6px',
                    borderRadius: 4,
                    border: 'none',
                    cursor: 'pointer',
                    minWidth: 0,
                    background: active ? 'rgb(var(--template-palette-primary-mainChannel) / 0.08)' : 'transparent',
                    boxShadow: active ? `inset 0 0 0 1px ${accent}` : 'none',
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: n > 0 ? CV.text : CV.text3,
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t(proofreadGroupLabelKey(g))}
                  </span>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: n > 0 ? '#b45309' : CV.text3, flexShrink: 0 }}>
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
          {/* 浏览控件（T2）：严重性过滤 + 排序，组合生效——按优先级浏览发现 */}
          <div
            style={{
              border: `1px solid ${CV.divider}`,
              borderRadius: 8,
              background: CV.paper,
              padding: '6px 8px',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', gap: 4 }}>
              {(
                [
                  ['all', t('writing.proofreadFilterAll')],
                  ['block', t('writing.proofreadFilterBlock')],
                  ['warning', t('writing.proofreadFilterWarning')],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSevFilter(mode)}
                  title={t('writing.proofreadFilterHint')}
                  style={{
                    flex: 1,
                    fontSize: 9,
                    padding: '2px 0',
                    borderRadius: 4,
                    border: '1px solid',
                    borderColor: sevFilter === mode ? accent : CV.divider,
                    background: sevFilter === mode ? 'rgb(var(--template-palette-primary-mainChannel) / 0.08)' : 'transparent',
                    color: sevFilter === mode ? accent : CV.text3,
                    fontWeight: sevFilter === mode ? 700 : 400,
                    cursor: 'pointer',
                    minWidth: 0,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(
                [
                  ['default', t('writing.proofreadSortDefault')],
                  ['severity', t('writing.proofreadSortSeverity')],
                  ['chapter', t('writing.proofreadSortChapter')],
                  ['type', t('writing.proofreadSortType')],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSortMode(mode)}
                  title={t('writing.proofreadSortHint')}
                  style={{
                    flex: 1,
                    fontSize: 9,
                    padding: '2px 0',
                    borderRadius: 4,
                    border: '1px solid',
                    borderColor: sortMode === mode ? accent : CV.divider,
                    background: sortMode === mode ? 'rgb(var(--template-palette-primary-mainChannel) / 0.08)' : 'transparent',
                    color: sortMode === mode ? accent : CV.text3,
                    fontWeight: sortMode === mode ? 700 : 400,
                    cursor: 'pointer',
                    minWidth: 0,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <span style={{ fontSize: 9.5, color: CV.text3 }}>
            {useWritingStore.getState().books.find((b) => b.id === bookId)?.title ?? ''}
          </span>
          {/* 全书一键修复：与单章修复同一套判据与同一个函数，只是把范围拉满整本 */}
          {autoFixableChapterIds.size > 0 && (
            <button
              type="button"
              onClick={fixAllChapters}
              disabled={fixingAll}
              aria-label={t('writing.proofreadFixAll')}
              style={{ ...miniBtn(accent), fontSize: 9.5, padding: '2px 8px', width: 'fit-content' }}
            >
              {fixingAll ? t('writing.proofreadFixAllRunning') : t('writing.proofreadFixAll')}
            </button>
          )}
          {fixAllReceipt && (
            <span style={{ fontSize: 9.5, color: CV.text3 }}>{fixAllReceipt}</span>
          )}
          {/* 骨架互联（P1-B）：校对 ←→ 统计双向打通——此处跳统计视角看体量分布 */}
          <button
            type="button"
            onClick={() => {
              try {
                openTypedCarrierView(genre, 'stats');
              } catch (e) {
                logger.warn('ProofreadPane', 'goStats failed', { error: String(e) });
              }
            }}
            title={t('writing.proofreadGoStats')}
            style={{ ...miniBtn(accent), fontSize: 9.5, padding: '2px 8px', width: 'fit-content' }}
          >
            {t('writing.proofreadGoStats')}
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                openTypedCarrierView(genre, 'overview');
              } catch (e) {
                logger.warn('ProofreadPane', 'goOverview failed', { error: String(e) });
              }
            }}
            title={t('writing.proofreadGoOverview')}
            style={{ ...miniBtn(accent), fontSize: 9.5, padding: '2px 8px', width: 'fit-content' }}
          >
            {t('writing.proofreadGoOverview')}
          </button>
        </div>
        {/* 右：选中维度的发现明细（行可点即跳） */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            border: `1px solid ${CV.divider}`,
            borderRadius: 8,
            background: CV.paper,
            padding: '6px 8px',
          }}
        >
          {groupIssues.length === 0 ? (
            <EmptyHint text={t('writing.proofreadPaneEmpty')} />
          ) : (
            (() => {
              // 一键修复按章去重：按钮语义是「修复整章」，同一章多行 issue 只渲染一个按钮（挂在行上）。
              const fixShown = new Set<string>();
              return groupIssues.map((issue) => {
                const jumpable = !!issue.target;
                const sevDot = proofreadSeverityColor(issue.severity);
                const sevLabelKey =
                  issue.severity === 'block'
                    ? 'proofreadSeverityBlock'
                    : issue.severity === 'warning'
                      ? 'proofreadSeverityWarning'
                      : 'proofreadSeverityNormal';
                const issueText = t(`writing.proofreadIssue.${issue.messageKey}`, issue.args);
                const chapterTarget = issue.target && issue.target.type === 'chapter' ? issue.target : undefined;
                const chapterName = chapterTarget ? (chapters.find((c) => c.id === chapterTarget.id)?.title ?? '') : '';
                const summary = clipSummary(chapterName ? `${issueText} · 《${chapterName}》` : issueText, 80);
                const canFix = chapterTarget
                  ? autoFixableChapterIds.has(chapterTarget.id) && !fixShown.has(chapterTarget.id)
                  : false;
                if (canFix && chapterTarget) fixShown.add(chapterTarget.id);
                return (
                  <div
                    key={issue.key}
                    id={`proofread-row-${issue.key}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      width: '100%',
                      borderRadius: 4,
                      background: flashKey === issue.key ? 'rgb(var(--template-palette-primary-mainChannel) / 0.14)' : 'transparent',
                      transition: 'background 0.25s ease',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => jumpIssue(issue)}
                      title={`${summary}\n${t(`writing.${sevLabelKey}`)}${jumpable ? ' · ' + t('writing.proofreadJump') : ''}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flex: 1,
                        minWidth: 0,
                        textAlign: 'left',
                        padding: '4px 6px',
                        borderRadius: 4,
                        border: 'none',
                        cursor: jumpable ? 'pointer' : 'default',
                        background: 'transparent',
                      }}
                    >
                      <span
                        title={t(`writing.${sevLabelKey}`)}
                        style={{
                          flexShrink: 0,
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: sevDot,
                          boxShadow: issue.severity ? `0 0 0 2px ${sevDot}33` : 'none',
                        }}
                      />
                      <span
                        style={{
                          fontSize: 11.5,
                          color: CV.text,
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t(`writing.proofreadIssue.${issue.messageKey}`, issue.args)}
                      </span>
                      {chapterName && (
                        <span
                          title={`《${chapterName}》`}
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: accent,
                            flexShrink: 0,
                            maxWidth: 240,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            background: 'rgb(var(--template-palette-primary-mainChannel) / 0.08)',
                            borderRadius: 4,
                            padding: '0 5px',
                          }}
                        >
                          《{chapterName}》
                        </span>
                      )}
                      {jumpable && <span style={{ fontSize: 10, color: accent, flexShrink: 0 }}>⇢</span>}
                    </button>
                    {canFix && (
                      <button
                        type="button"
                        title={t('writing.proofreadFix')}
                        onClick={(e) => {
                          e.stopPropagation();
                          void fixChapter(chapterTarget!.id);
                        }}
                        style={{ ...miniBtn(accent), fontSize: 9, padding: '1px 6px', flexShrink: 0 }}
                      >
                        {t('writing.proofreadFix')}
                      </button>
                    )}
                  </div>
                );
              });
            })()
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 统计 pane（统计页签编辑面）：全书体量与节奏总览（纯本地派生 + Rust 日更快照） ───
// KPI 行 → 日更目标/趋势（快照差分）→ 卷分布（点卷行展开章明细）→ 章节体量（离群标注、点行跳章）。
// 口径收拢 utils/writingStats（与右栏总览卡/AI 语料同一份，禁止第二份）；数据源 writingStore
// （writing_chapters/writing_settings 域，与校对等页签同口径）。旧画布统计板不再 seed：
// 进入本视图由 reconcileStudioPaneView 按 isLegacyBoardCard 签名无条件清场。
export function StatsPane({ accent, bookId }: { accent: string; bookId: string }) {
  const chapters = useWritingStore((s) => s.chapters);
  const settings = useWritingStore((s) => s.settings);
  const setDailyGoal = useWritingStore((s) => s.setDailyGoal);
  const book = useWritingStore((s) => s.books.find((b) => b.id === bookId));
  const bookChapters = useMemo(() => chapters.filter((c) => c.bookId === bookId), [chapters, bookId]);
  const bookSettings = useMemo(() => settings.filter((s) => s.bookId === bookId), [settings, bookId]);
  const kpis = useMemo(() => computeWritingKpis(bookChapters, bookSettings), [bookChapters, bookSettings]);
  // 三格读数按体裁（⑭ 刀C）：诗集不该出现「章节数 / 卷数 / 平均章长」；小说取原键原字
  const kk = kpiLabelKeys(book?.genre ?? '');
  const volRows = useMemo(() => buildVolumeRows(bookChapters), [bookChapters]);
  const [chFilter, setChFilter] = useState<StatsChapterFilter>('all');
  const [chSort, setChSort] = useState<StatsChapterSort>('default');
  const chRows = useMemo(
    // genre 也要传给行构造：本页签的三格读数已按体裁（⑭ 刀C），但离群列若不吃体裁，
    // 诗集仍会在「章均」口径下被标成一堆偏短/偏长的章（长短悬殊是诗集常态）。
    () => sortChapterRows(filterChapterRows(buildChapterWordRows(bookChapters, book?.genre ?? ''), chFilter), chSort),
    [bookChapters, book?.genre, chFilter, chSort],
  );

  // S4：章检视器 → 统计页签定位联动。消费 statsFocusChapterId：
  // 重置过滤保证行可见 → 闪烁高亮定位行 → 消费清空防重复触发。
  const focusChId = useEditorStore((s) => s.statsFocusChapterId);
  const [flashChId, setFlashChId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusChId) return;
    if (!bookChapters.some((c) => c.id === focusChId)) return;
    setChFilter('all');
    setChSort('default');
    setFlashChId(focusChId);
    useEditorStore.getState().setStatsFocusChapterId(null);
  }, [focusChId, bookChapters]);

  // 定位行渲染完成后滚动到可视区；闪烁 1.8s 后自动熄灭
  useEffect(() => {
    if (!flashChId) return;
    if (!chRows.some((r) => r.id === flashChId)) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`stats-row-${flashChId}`)?.scrollIntoView({ block: 'nearest' });
    }, 60);
    const clear = window.setTimeout(() => setFlashChId((k) => (k === flashChId ? null : k)), 1800);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clear);
    };
  }, [flashChId, chRows]);

  // 日更快照（Rust 落库）：开面板/切书拉一次；写章落库即出新快照，切出再进即刷新
  const [stats, setStats] = useState<WritingDailyStat[] | null>(null);
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    setStats(null);
    writingStatsApi
      .listDailyStats(bookId, WINDOW_DAYS + 1)
      .then((rows) => {
        if (!cancelled) setStats(rows);
      })
      .catch((e) => {
        logger.warn('StatsPane', 'load daily stats failed', { bookId, error: String(e) });
        if (!cancelled) setStats([]);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);
  const deltas = useMemo(() => (stats ? diffDailyStats(stats, new Date()) : []), [stats]);
  const maxDelta = Math.max(1, ...deltas.map((d) => d.delta));
  const totalDelta = deltas.reduce((sum, d) => sum + d.delta, 0);
  const todayDelta = deltas.length > 0 ? deltas[deltas.length - 1].delta : 0;
  const dailyGoal = book?.dailyGoal ?? 0;
  const goalPct = dailyGoal > 0 ? Math.min(100, Math.round((todayDelta / dailyGoal) * 100)) : 0;

  // 日更目标就地编辑（null=未在编辑；失焦/回车提交，落库 setDailyGoal）
  const [goalInput, setGoalInput] = useState<string | null>(null);
  const commitGoal = () => {
    if (goalInput === null) return;
    const n = parseInt(goalInput, 10);
    if (Number.isFinite(n) && n > 0 && n !== dailyGoal) {
      void setDailyGoal(bookId, n).catch((e) =>
        logger.warn('StatsPane', 'setDailyGoal failed', { bookId, error: String(e) }),
      );
    }
    setGoalInput(null);
  };

  // 卷行展开：点卷行展开该卷章节明细（本地 state，单开）
  const [expandedVol, setExpandedVol] = useState<string | null>(null);
  const jumpChapter = (chId: string, title: string) => {
    try {
      openChapterCarrierView(chId, title, book?.genre ?? '', bookId);
    } catch (e) {
      logger.warn('StatsPane', 'jumpChapter failed', { chId, error: String(e) });
    }
  };

  // 骨架互联（P1-B）：统计发现 → 校对体检（校对面四段式 jumpIssue 已支持章定位）
  const goProofread = () => {
    try {
      openTypedCarrierView(book?.genre ?? '', 'proofread');
    } catch (e) {
      logger.warn('StatsPane', 'goProofread failed', { error: String(e) });
    }
  };

  const goOverview = () => {
    try {
      openTypedCarrierView(book?.genre ?? '', 'overview');
    } catch (e) {
      logger.warn('StatsPane', 'goOverview failed', { error: String(e) });
    }
  };

  const sectionStyle: React.CSSProperties = {
    border: `1px solid ${CV.divider}`,
    borderRadius: 8,
    background: CV.paper,
    padding: '8px 10px',
    flexShrink: 0,
  };
  const sectionTitleStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: CV.text3, marginBottom: 6 };

  return (
    <div style={paneStyle}>
      <PaneHeader
        label={t('writing.viewKind.stats')}
        count={bookChapters.length}
        action={t('writing.statsGoOverview')}
        onAction={goOverview}
      />
      {bookChapters.length === 0 ? (
        <div style={paneBodyStyle}>
          <EmptyHint text={t(surfaceKeyForGenre(book?.genre ?? '', 'statsEmpty'))} />
        </div>
      ) : (
        <div style={{ ...paneBodyStyle, gap: 10 }}>
          {/* KPI 行：一行读完这本书「有多少」 */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
            {[
              {
                label: t('writing.totalWords'),
                value: kpis.totalWords.toLocaleString(),
                sub: t('editor.writing.stats.kpiWordsSub'),
              },
              {
                label: t(kk.count),
                value: String(kpis.chapterCount),
                sub: t(kk.countSub),
              },
              {
                label: t(kk.group),
                value: String(kpis.volumeCount),
                sub: t(kk.groupSub),
              },
              {
                label: t('editor.writing.stats.kpiSettings'),
                value: String(kpis.settingCount),
                sub: t('editor.writing.stats.kpiSettingsSub'),
              },
              {
                label: t(kk.avg),
                value: String(kpis.avgWords),
                sub: t(kk.avgSub),
              },
            ].map((k) => (
              <div
                key={k.label}
                style={{
                  flex: 1,
                  minWidth: 110,
                  border: `1px solid ${CV.divider}`,
                  borderRadius: 8,
                  padding: '6px 10px',
                }}
              >
                <div style={{ fontSize: 10, color: CV.text3 }}>{k.label}</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: CV.text }}>{k.value}</div>
                <div style={{ fontSize: 9, color: CV.text3 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* 日更趋势：目标进度 + 30 天新增条形（快照差分，算法 utils/writingStats） */}
          <div style={sectionStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={sectionTitleStyle}>
                {t('writing.dailyTrend')} · {totalDelta.toLocaleString()}
              </span>
              <span style={{ fontSize: 10, color: CV.text3 }}>
                {t('writing.todayProgress', { n: todayDelta.toLocaleString() })}
                {dailyGoal > 0 && (
                  <span style={{ fontWeight: 700, color: goalPct >= 100 ? '#2e7d32' : CV.text3 }}>
                    {' '}
                    · {goalPct}%{goalPct >= 100 ? ` ${t('writing.goalReached')}` : ''}
                  </span>
                )}
              </span>
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: CV.text3 }}>{t('writing.dailyGoal')}</span>
                <input
                  type="number"
                  value={goalInput ?? (dailyGoal > 0 ? String(dailyGoal) : '')}
                  placeholder="0"
                  onChange={(e) => setGoalInput(e.target.value)}
                  onBlur={commitGoal}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitGoal();
                  }}
                  style={{
                    width: 72,
                    fontSize: 11,
                    padding: '2px 6px',
                    border: `1px solid ${CV.divider}`,
                    borderRadius: 4,
                    background: 'transparent',
                    color: CV.text,
                    textAlign: 'right',
                  }}
                />
                <span style={{ fontSize: 9, color: CV.text3 }}>{t('writing.goalUnit')}</span>
              </span>
            </div>
            {dailyGoal > 0 && (
              <div style={{ height: 5, borderRadius: 3, background: CV.divider, marginBottom: 8, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${goalPct}%`,
                    height: '100%',
                    borderRadius: 3,
                    background: goalPct >= 100 ? '#2e7d32' : accent,
                  }}
                />
              </div>
            )}
            {stats !== null && deltas.some((d) => d.delta > 0) && (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: 2,
                    height: 72,
                    borderBottom: `1px solid ${CV.divider}`,
                  }}
                >
                  {deltas.map((d) => (
                    <span
                      key={d.day}
                      title={`${d.day} · +${d.delta.toLocaleString()}`}
                      style={{
                        flex: 1,
                        minWidth: 2,
                        height: `${Math.max(d.delta > 0 ? 5 : 0, (d.delta / maxDelta) * 100)}%`,
                        background: d.delta > 0 ? accent : 'transparent',
                        borderRadius: '2px 2px 0 0',
                      }}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                  <span style={{ fontSize: 9, color: CV.text3 }}>{deltas[0]?.day}</span>
                  <span style={{ fontSize: 9, color: CV.text3 }}>{deltas[deltas.length - 1]?.day}</span>
                </div>
              </>
            )}
            {stats !== null && !deltas.some((d) => d.delta > 0) && (
              <div style={{ fontSize: 10, color: CV.text3, textAlign: 'center', padding: '10px 0' }}>
                {t('writing.noStats')}
              </div>
            )}
          </div>

          {/* 分组分布：点分组行展开明细（明细行可点跳章）。㉓-1 标题按体裁——日记说「年月分布」；
              ㉜ T-F′：三张嘴一起收 —— 段标题改了、兜底组名还顶着「未分卷」就是半截话 */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{t(surfaceKeyForGenre(book?.genre ?? '', 'bandGroup'))}</div>
            {volRows.map((v) => (
              <div key={v.volume || '__uncat__'}>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedVol(expandedVol === (v.volume || '__uncat__') ? null : v.volume || '__uncat__')
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    textAlign: 'left',
                    padding: '3px 4px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    borderRadius: 4,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11.5,
                      color: CV.text,
                      width: 120,
                      flexShrink: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {v.volume || t(surfaceKeyForGenre(book?.genre ?? '', 'bandUncategorized'))}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: 8,
                      borderRadius: 4,
                      background: CV.divider,
                      overflow: 'hidden',
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        width: `${kpis.maxVolumeWords > 0 ? Math.max(2, (v.words / kpis.maxVolumeWords) * 100) : 0}%`,
                        height: '100%',
                        borderRadius: 4,
                        background: accent,
                      }}
                    />
                  </span>
                  <span style={{ fontSize: 10, color: CV.text3, flexShrink: 0 }}>
                    {t('editor.writing.stats.finishedOf', { done: v.finished, total: v.chapters })} ·{' '}
                    {v.words.toLocaleString()}
                  </span>
                  <span style={{ fontSize: 9, color: CV.text3, flexShrink: 0 }}>
                    {expandedVol === (v.volume || '__uncat__') ? '▾' : '▸'}
                  </span>
                </button>
                {expandedVol === (v.volume || '__uncat__') && (
                  <div style={{ paddingLeft: 16, paddingBottom: 4 }}>
                    {chRows
                      .filter((r) => (r.volume || '') === v.volume)
                      .map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => jumpChapter(r.id, r.title)}
                          title={t('writing.statsJumpChapter')}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            width: '100%',
                            textAlign: 'left',
                            padding: '2px 4px',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            borderRadius: 4,
                            minWidth: 0,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 10.5,
                              color: CV.text3,
                              flex: 1,
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {r.title}
                          </span>
                          <span style={{ fontSize: 10, color: CV.text3, flexShrink: 0 }}>
                            {r.words.toLocaleString()}
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 章节体量：离群标注（advisory 软提示），点行跳章 */}
          <div style={sectionStyle}>
            <div style={{ ...sectionTitleStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{t(surfaceKeyForGenre(book?.genre ?? '', 'bandUnitSize'))}</span>
              <span style={{ fontSize: 9, fontWeight: 400, color: CV.text3 }}>{t('writing.statsOutlierLegend')}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {(['all', 'outlier', 'normal'] as StatsChapterFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setChFilter(f)}
                  style={{
                    fontSize: 10,
                    padding: '1px 7px',
                    borderRadius: 10,
                    border: `1px solid ${chFilter === f ? accent : CV.divider}`,
                    background: chFilter === f ? accent : 'transparent',
                    color: chFilter === f ? '#fff' : CV.text3,
                    cursor: 'pointer',
                    lineHeight: 1.4,
                  }}
                >
                  {t(`writing.statsChFilter.${f}`)}
                </button>
              ))}
              {(['default', 'words'] as StatsChapterSort[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setChSort(s)}
                  style={{
                    fontSize: 10,
                    padding: '1px 7px',
                    borderRadius: 10,
                    border: `1px solid ${chSort === s ? accent : CV.divider}`,
                    background: chSort === s ? accent : 'transparent',
                    color: chSort === s ? '#fff' : CV.text3,
                    cursor: 'pointer',
                    lineHeight: 1.4,
                  }}
                >
                  {t(`writing.statsChSort.${s}`)}
                </button>
              ))}
            </div>
            {chRows.map((r) => {
              const share = kpis.totalWords > 0 ? Math.round((r.words / kpis.totalWords) * 100) : 0;
              return (
                <button
                  key={r.id}
                  id={`stats-row-${r.id}`}
                  type="button"
                  onClick={() => jumpChapter(r.id, r.title)}
                  title={`《${r.title}》 · ${r.words.toLocaleString()} · ${share}%${r.outlier ? ' · ' + t(`writing.statsOutlier${r.outlier === 'long' ? 'Long' : 'Short'}`) : ''} · ${t('writing.statsJumpChapter')}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    textAlign: 'left',
                    padding: '3px 4px',
                    border: 'none',
                    background:
                      flashChId === r.id
                        ? 'rgb(var(--template-palette-primary-mainChannel) / 0.14)'
                        : r.outlier
                          ? 'rgba(180, 83, 9, 0.06)'
                          : 'transparent',
                    cursor: 'pointer',
                    borderRadius: 4,
                    minWidth: 0,
                    transition: 'background 0.25s ease',
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: CV.text,
                      width: 160,
                      flexShrink: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.title}
                  </span>
                  {r.outlier && (
                    <>
                      <span style={{ fontSize: 9, fontWeight: 700, color: '#b45309', flexShrink: 0 }}>
                        {r.outlier === 'long' ? t('writing.statsOutlierLong') : t('writing.statsOutlierShort')}
                      </span>
                      {/* 骨架互联（P1-B）：离群发现一键进校对体检，不再止步于「知道」 */}
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          goProofread();
                        }}
                        title={t('writing.statsGoProofread')}
                        style={{ fontSize: 9, color: accent, flexShrink: 0, cursor: 'pointer' }}
                      >
                        {t('writing.statsGoProofread')}
                      </span>
                    </>
                  )}
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: 8,
                      borderRadius: 4,
                      background: CV.divider,
                      overflow: 'hidden',
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        width: `${kpis.maxChapterWords > 0 ? Math.max(2, (r.words / kpis.maxChapterWords) * 100) : 0}%`,
                        height: '100%',
                        borderRadius: 4,
                        background: r.outlier ? '#b45309' : accent,
                      }}
                    />
                  </span>
                  <span style={{ fontSize: 10, color: CV.text3, width: 64, textAlign: 'right', flexShrink: 0 }}>
                    {r.words.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// 剧情线实体区（P1 整合）：一行一线（色点/名/事件数），点行**选中**该线——
// 页签语境（embed="pane"）就地联动右侧编辑卡；时间线语境（embed="timeline"）选中并切到剧情线轴。
// 新建动线闭环：建线后自动选中新线（编辑卡直入改名），不留「剧情线 1」死端。
function StorylineSection({
  accent,
  bookId,
  embed,
}: {
  accent: string;
  bookId: string;
  embed: 'pane' | 'timeline';
}) {
  const storylines = useWritingStore((s) => s.storylines);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const loadStorylines = useWritingStore((s) => s.loadStorylines);
  const createStoryline = useWritingStore((s) => s.createStoryline);
  const deleteStoryline = useWritingStore((s) => s.deleteStoryline);
  const selectedStorylineId = useEditorStore((s) => s.selectedStorylineId);
  // ㉫ bookId 曾是「传了不用」的孤儿 prop（本仓为这个形状付过四次钱）：实体区既然端在这张卡里，
  // 线清单就只准列本卡书的（store 按活跃书装载，正常路径 no-op；分叉时宁缺不错）。
  const lines = useMemo(() => storylines.filter((l) => l.bookId === bookId), [storylines, bookId]);
  // AI-12 ①（轮 30）：认书第三例把「算好的 lines」只接到了计数与新增命名，**行表本体仍渲染未过滤的
  // storylines**（AU-7 ⑨「算好了没接到行上」的残余）。行尾那个事件数属于同一行，照旧数整份缓存 ⇒
  // 跨书脏事件能被计进本卡线的行。同书装载下两处 filter 都是 no-op（逐字 = 改造前）。
  const bookEvents = useMemo(() => timelineEvents.filter((e) => e.bookId === bookId), [timelineEvents, bookId]);
  // 线-事件数一次性分组（避免每行 filter O(线×事件)）
  const eventCountByLine = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of bookEvents) {
      if (e.storylineId) m.set(e.storylineId, (m.get(e.storylineId) ?? 0) + 1);
    }
    return m;
  }, [bookEvents]);
  // 装载补齐：本 pane 可能先于时间线 pane 挂载（用户直接点「剧情线」tab）。
  useEffect(() => {
    const ws = useWritingStore.getState();
    if (ws.activeBookId && ws.storylines.length === 0) void ws.loadStorylines().catch(() => {});
  }, [loadStorylines]);

  const pickStoryline = (slId: string) => {
    try {
      const es = useEditorStore.getState();
      es.selectStoryline(slId);
      if (embed === 'timeline' && es.timelineViewMode !== 'storyline') es.setTimelineViewMode('storyline');
    } catch (e) {
      logger.warn('StorylineSection', 'pickStoryline failed', { slId, error: String(e) });
    }
  };

  // P2-3 状态卫生：删的是当前选中线就先清选中，再删（与 StorylineDetail.remove 口径一致，
  // 避免 selectedStorylineId 残留指向已删除线）。
  const handleDelete = (slId: string) => {
    try {
      const es = useEditorStore.getState();
      if (es.selectedStorylineId === slId) es.selectStoryline(null);
      void deleteStoryline(slId);
    } catch (e) {
      logger.warn('StorylineSection', 'deleteStoryline failed', { slId, error: String(e) });
    }
  };

  const handleCreate = async () => {
    // ㉫ 先扳正再落：线要长在**本卡书**上，不是工作室当前书上。
    if (!(await ensureWritingBookWired(bookId))) return;
    const sl = await createStoryline(t('writing.storylineDefaultName', { n: lines.length + 1 }));
    if (sl) {
      const es = useEditorStore.getState();
      es.selectStoryline(sl.id);
      if (embed === 'timeline' && es.timelineViewMode !== 'storyline') es.setTimelineViewMode('storyline');
    }
  };

  return (
    <div
      style={{
        border: `1px solid ${CV.divider}`,
        borderRadius: 8,
        background: CV.paper,
        padding: '6px 8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: lines.length > 0 ? 5 : 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: CV.text3 }}>{t('writing.timelineViewStoryline')}</span>
        <span style={{ fontSize: 9, color: CV.text3 }}>{lines.length}</span>
        <button
          type="button"
          onClick={() => void handleCreate()}
          title={t('writing.storylineCreate')}
          style={{ ...miniBtn(accent), marginLeft: 'auto', fontSize: 9.5, padding: '1px 8px' }}
        >
          ＋ {t('writing.storylineCreate')}
        </button>
      </div>
      {lines.length === 0 ? (
        <EmptyHint text={t('writing.storylineEmptyHint')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {lines.map((sl) => {
            const color = sl.color || LANE_COLORS[hashStr(sl.id) % LANE_COLORS.length];
            const n = eventCountByLine.get(sl.id) ?? 0;
            const active = selectedStorylineId === sl.id;
            return (
              <div
                key={sl.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '2px 4px',
                  borderRadius: 4,
                  minWidth: 0,
                  background: active ? 'rgb(var(--template-palette-primary-mainChannel) / 0.08)' : 'transparent',
                  boxShadow: active ? `inset 0 0 0 1px ${accent}` : 'none',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <button
                  type="button"
                  onClick={() => pickStoryline(sl.id)}
                  title={t('writing.storylineSelect')}
                  style={{
                    ...miniBtn(color),
                    border: 'none',
                    padding: 0,
                    fontSize: 11,
                    fontWeight: 700,
                    color: CV.text,
                    background: 'transparent',
                    textAlign: 'left',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {sl.name}
                </button>
                <span style={{ fontSize: 9, color: CV.text3, flexShrink: 0 }}>
                  {t('editor.writing.timelineEventCount', { n })}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(sl.id)}
                  title={t('writing.storylineDelete')}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = CV.error;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = CV.text3;
                  }}
                  style={{ ...delBtnStyle, fontSize: 12, fontWeight: 700, lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function StorylinePane({
  accent,
  bookId,
  chapters,
  settings,
}: {
  accent: string;
  /** ㉫ 本卡所属的书（父卡从 config.filePath 现解）——认书唯一来源，不再吃工作室活跃书。 */
  bookId: string;
  chapters: WritingChapter[];
  outlines: WritingOutline[];
  settings: WritingSetting[];
}) {
  const createChapter = useWritingStore((s) => s.createChapter);
  // 注意：章节列表只在**编辑区（设计视图，页面本体）**呈现，绝不进左栏（铁律 #9）。
  // ㉫ 书名与体裁按「本卡 bookId」反查全局书目，与 BookMetaPanel:140-141 / ArchitectureLayersPanel:651
  // 同一条在册口径；卡片所属的书与工作室当前书分叉可达（写作台书切换器只翻后者）。
  const books = useWritingStore((s) => s.books);
  const bookTitle = books.find((b) => b.id === bookId)?.title ?? '';
  const genre = books.find((b) => b.id === bookId)?.genre ?? '';

  // ㉫ 渲染清单按本卡书过滤：store 各集合按活跃书装载，正常路径（活跃书==本卡书）下是 no-op；
  // 分叉时宁可空，不把别本书的行挂在本卡上（与 StatsPanels.tsx:19 / BookOverviewPanel.tsx:74 同一张嘴）。
  const bookChapters = useMemo(() => chapters.filter((c) => c.bookId === bookId), [chapters, bookId]);
  const bookSettings = useMemo(() => settings.filter((x) => x.bookId === bookId), [settings, bookId]);
  const characters = useMemo(() => bookSettings.filter((s) => s.kind === 'character'), [bookSettings]);
  const scenes = useMemo(() => bookSettings.filter((s) => s.kind === 'worldbuilding'), [bookSettings]);
  // 默认层级（卷›章 / 篇›节）只用于「加子级」的默认建议，零配置起步。
  const levels = useMemo(() => defaultLevels(genre), [genre]);
  // 扁平章节 → 结构树（任意深），递归渲染。
  const forest = useMemo(() => buildTree(bookChapters), [bookChapters]);

  const addRoot = () => {
    void (async () => {
      if (!(await ensureWritingBookWired(bookId))) return;
      const rootKind = levels[0] ?? '章';
      void createChapter(`${rootKind} ${forest.length + 1}`);
    })();
  };

  return (
    <div style={paneStyle}>
      <PaneHeader
        label={t('writingDesign.pane.storyline')}
        count={bookChapters.length}
        action={t('writingDesign.addNode')}
        onAction={addRoot}
      />
      <div style={paneBodyStyle}>
        {/* 剧情线实体区（P1 整合）：线一目了然——新建/删线/点行选中并切到剧情线轴。
            就地改名在剧情线轴的轨道标签列，编辑卡在右栏详情（选中即就位）。 */}
        <StorylineSection accent={accent} bookId={bookId} embed="timeline" />
        {/* 鸟瞰条：作者第一眼看到「全书形状」，决定下一章写哪。 */}
        <BirdEyeBar roots={forest} />
        {chapters.length === 0 && <EmptyHint text={t('writingDesign.emptyOutlineTree')} />}
        {forest.map((node) => (
          <NodeRow
            key={node.node.id}
            node={node}
            levels={levels}
            accent={accent}
            characters={characters}
            scenes={scenes}
            bookId={bookId}
            bookTitle={bookTitle}
            genre={genre}
          />
        ))}
      </div>
    </div>
  );
}

// ─── 合集型体裁：正文单位一览（散文=篇目 / 诗歌=诗作；可增） ───
export function PiecesPane({
  accent,
  bookId,
  chapters,
  labelKey = 'writingDesign.pane.pieces',
  emptyKey = 'writingDesign.emptyPieces',
}: {
  accent: string;
  /** ㉫ 本卡所属的书（父卡从 config.filePath 现解）——认书唯一来源，不再吃工作室活跃书。 */
  bookId: string;
  chapters: WritingChapter[];
  /**
   * 单位名随体裁（诗书这一栏叫「诗作」）。传 **i18n key** 而不是成品文案：
   * 默认值也在渲染期才求值，模块级调 t() 会固化语言（本仓事故先例 ×2，见 writingSchema 头注释）。
   */
  labelKey?: string;
  emptyKey?: string;
}) {
  const createChapter = useWritingStore((s) => s.createChapter);
  // 篇目拖出同协议（页面本体内操作，不进左栏）：拖到画布即开该篇写作视图。
  // ㉫ 书名与体裁按本卡 bookId 反查（口径同 StorylinePane / BookMetaPanel:140-141）。
  const books = useWritingStore((s) => s.books);
  const bookTitle = books.find((b) => b.id === bookId)?.title ?? '';
  const genre = books.find((b) => b.id === bookId)?.genre ?? '';
  // ㉫ 只列本卡书的篇目：正常路径（活跃书==本卡书）no-op；分叉时宁缺不错。
  const bookChapters = useMemo(() => chapters.filter((c) => c.bookId === bookId), [chapters, bookId]);
  return (
    <div style={paneStyle}>
      <PaneHeader
        label={t(labelKey)}
        count={bookChapters.length}
        action={t('writingDesign.add')}
        onAction={() => {
          void (async () => {
            // ㉫ 先扳正再建：新篇目要长在**本卡书**上，单位词（首/篇/天）也才与它同源。
            if (!(await ensureWritingBookWired(bookId))) return;
            void createChapter(t(unitNameKey(genre), { n: bookChapters.length + 1 }));
          })();
        }}
      />
      <div style={paneBodyStyle}>
        {bookChapters.length === 0 && <EmptyHint text={t(emptyKey)} />}
        {bookChapters.map((c) => (
          <div key={c.id} style={rowStyle()}>
            <span style={{ fontSize: 8, color: accent, flexShrink: 0 }}>◆</span>
            <span
              draggable
              onClick={() =>
                openChapterCarrierView(c.id, bookTitle ? `${bookTitle} · ${c.title}` : c.title, genre, bookId)
              }
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-project-entity', 'writing-workbench');
                e.dataTransfer.setData(
                  'application/x-project-entity-data',
                  JSON.stringify({ name: c.title, config: { __blank: true, genre, chapterId: c.id } }),
                );
                e.dataTransfer.effectAllowed = 'copy';
              }}
              title={t('writingLeft.chapterDragHint')}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: CV.text,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                minWidth: 0,
                cursor: 'pointer',
              }}
            >
              {c.title}
            </span>
            <span style={{ fontSize: 9, color: CV.text3, flexShrink: 0 }}>
              {t('writing.words', { n: c.wordCount })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 合集型体裁：立意 / 素材栏（散文=立意素材，诗歌=意象素材；可增删改） ───
export function IdeasPane({
  accent,
  bookId,
  outlines,
  labelKey = 'writingDesign.pane.ideas',
}: {
  accent: string;
  /** ㉮ 认书第六例（轮 27 · AI-10）：必填、无默认值（轮 21 签名翻面先例）。改造前本栏只吃
   *  outlines prop（两个宿主都递 store 原样清单 = 工作室活跃书缓存），与 ㉫ 栏头注释
   *  「卡内认书只准吃这个 bookId」对不上——素材栏这一整列正是念头池的另一张嘴。 */
  bookId: string;
  outlines: WritingOutline[];
  /** 同 PiecesPane：传 key，渲染期才 t()。诗歌这一栏换成「意象素材」 */
  labelKey?: string;
}) {
  const createOutline = useWritingStore((s) => s.createOutline);
  const updateOutline = useWritingStore((s) => s.updateOutline);
  const deleteOutline = useWritingStore((s) => s.deleteOutline);
  const ideas = useMemo(
    () => outlines.filter((o) => o.bookId === bookId && !o.chapterId),
    [outlines, bookId],
  );
  return (
    <div style={paneStyle}>
      <PaneHeader
        label={t(labelKey)}
        count={ideas.length}
        action={t('writingDesign.addIdea')}
        onAction={() => {
          void (async () => {
            // ㉮ 与 PiecesPane 新增（㉫）同闸：素材也要长在本卡书上，扳不动宁可不建。
            if (!(await ensureWritingBookWired(bookId))) return;
            void createOutline(t('writingDesign.ideaN', { n: ideas.length + 1 }));
          })();
        }}
      />
      <div style={paneBodyStyle}>
        {ideas.length === 0 && <EmptyHint text={t('writingDesign.emptyIdeas')} />}
        {ideas.map((o) => (
          <div key={o.id} style={{ ...rowStyle(), flexDirection: 'column', alignItems: 'stretch', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
              <span style={{ fontSize: 8, color: accent, flexShrink: 0 }}>◆</span>
              <DraftInput
                entityKey={o.id}
                value={o.title}
                onCommit={(v) => updateOutline(o.id, { title: v })}
                style={{ ...inputStyle, fontWeight: 600, flex: 1 }}
              />
              <button
                type="button"
                title={t('writingDesign.deleteIdea')}
                onClick={() => {
                  // 删除铁律（③e）：工作室画布的念头 × 此前一点即删。
                  // 两个后果必须写在脸上：① 它只解除章节绑定，**章节本身不动**（不说用户会以为连章节一起删）；
                  // ② 写作域**没有撤销栈**（writingStore 里查无 undo），删掉就没了。
                  // 仓里另有一个 delete-outline 确认弹窗，但长在写作台的弹窗状态机里、工作室根本调不到，
                  // 已随本片一并拆除（见 useDialogActions）。
                  confirmDestructive({
                    title: t('writingDesign.deleteIdeaConfirmTitle', { title: o.title }),
                                        impact: [
                      t('writingDesign.deleteIdeaConfirmImpactBindings'),
                      t('writingDesign.deleteIdeaConfirmImpactUndo'),
                    ],
                    confirmLabel: t('nav.delete'),
                    cancelLabel: t('ui.cancel'),
                    onConfirm: () => {
                      void deleteOutline(o.id);
                    },
                  });
                }}
                style={delBtnStyle}
              >
                ×
              </button>
            </div>
            <DraftInput
              entityKey={o.id}
              value={o.summary}
              onCommit={(v) => updateOutline(o.id, { summary: v })}
              placeholder={t('writingDesign.ideaSummaryPh')}
              style={{ ...inputStyle, color: CV.text2, paddingLeft: 13 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 时间线 pane（工作室级，目的构建；与 storyline/characters/worldview 同形态）───
// Direction A 重做：不再走 buildTimelineBoard 只读板（那是「通用卡片板 + 网格背景」，
// "时间线"只是卡片上的刻度），而是铺满画布的目的构建编辑面，直接订阅 writingStore。
// 轴 = 忠实秩轴：每条 lane 内事件按可排序键排序，刻度=作者原文 at，混合尺度天然安全。
/**
 * ㉭ M1a 记录条的小工具（2026-11-11 轮 72 续七班）。
 *
 * 真人定的方向原话：「日记的主要目的是记录：什么事情、几点钟发生的、按时间线走、跟什么人物
 * 见过面说过话、心里的感想。完了以后通过 AI 直接给它润色……有些人不愿意花太多时间润色它，
 * 我们就抓住这个痛点。」⇒ 日记的主入口不该是"写"，是"记"，一条录入必须三秒钟完成。
 *
 * 时刻为什么要单独一小函数：日记的 `at` 现成字段是**自由文本**，全站其他地方写的是
 * 「第三日」「第3章」这类散文时点；日记侧统一写 `HH:mm` 才能在一天的竖排里排得出先后。
 * 这里不改 `at` 的类型、不加新列（第 8 条铁律：不新增表/不改快照指纹），只约定格式。
 */
function diaryClockNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 星期名走 Intl locale（它是**语言数据**，不是界面文案）。
 * 塞进 i18n 反而会造出第二个真源：i18n 里那份「星期三」不会跟着系统历法走。
 */
function diaryWeekdayShort(): string {
  // `Lang` 目前只有 zh-CN / en-US 两值（在这里手写第三枚会被 TS 判成"永假比较"），
  // 所以直接把界面语言交给映射表，将来开新语言只改这一处。
  const loc = getLang() === 'zh-CN' ? 'zh-CN' : 'en-US';
  try {
    return new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(new Date());
  } catch {
    return '';
  }
}

/**
 * ㉥ M1a：日记书时间线栏顶部的「此刻记一笔」。
 *
 * 四个控件 = 真人列的记录要素里可结构化的那几个：**几点**（默认此刻，可改）/ **什么事**
 * （一句话，回车即入库）/ **跟谁**（可空，从本卡人物里选）/ **哪一天**（自动落今天那个条目，
 * 今天还没开条目就当场建一条，走 `diaryEntry` 现成工具，不新增表不新增字段）。
 *
 * 落库 = 现成 `WritingTimelineEvent`（`at`=HH:mm、`event`=那句话、`settingId`=谁、
 * `chapterId`=今天条目）⇒ 当天竖排、按天统计、AI 全书语料、以及上一把刚接的**校对体裁闸**
 * 全部自动吃到这条记录，不需要任何新消费点（本仓「定义了没人消费 = 孤儿定义」的头号病灶）。
 *
 * 认书口径与同栏「＋新建事件」一字不差：先过写侧扳正助手（见 studioBook 的 ensureWritingBookWired），
 * 扳不动宁可不记 —— 否则会出现「在 B 卡上记的日记静默进了 A 书」（AI-12 ④-e 在册同族）。
 *
 * 感想（他列的第五样）本片**不另立控件**：先由这一句话承载，进念头池是 M1c 的事，
 * 别一次铺四张脸。
 */
export function DiaryCaptureBar({ accent, bookId, genre }: { accent: string; bookId: string; genre: string }) {
  const chapters = useWritingStore((s) => s.chapters);
  const settings = useWritingStore((s) => s.settings);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const createTimelineEvent = useWritingStore((s) => s.createTimelineEvent);
  const createChapter = useWritingStore((s) => s.createChapter);
  const [clock, setClock] = useState(diaryClockNow);
  const [what, setWhat] = useState('');
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const dayKey = todayDateKey();
  const todayEntry = useMemo(
    () => findEntryByDate(chapters.filter((c) => c.bookId === bookId), dayKey),
    [chapters, bookId, dayKey],
  );
  const people = useMemo(
    () => settings.filter((s) => s.bookId === bookId && (s.kind ?? 'character') === 'character'),
    [settings, bookId],
  );
  const todayCount = useMemo(
    () => (todayEntry ? timelineEvents.filter((e) => e.chapterId === todayEntry.id).length : 0),
    [timelineEvents, todayEntry],
  );

  // 判据 = 「这个载体是一条一天吗」的既有唯一口径（写作台那颗「今天」用的就是它），
  // 不在这里抄一份体裁清单。
  if (!hasTodayEntryMode(genre)) return null;

  const submit = async () => {
    const text = what.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      if (!(await ensureWritingBookWired(bookId))) return;
      let entry = findEntryByDate(
        useWritingStore.getState().chapters.filter((c) => c.bookId === bookId),
        dayKey,
      );
      // createChapter 返回 `WritingChapter | null`（扳正失败给 null），条目变量是 `| undefined`
      // ⇒ 显式收一次，别把 null 混进"有没有今天条目"这套判据
      if (!entry) entry = (await createChapter(diaryEntryTitle(dayKey), writeDiaryDate(undefined, dayKey))) ?? undefined;
      await createTimelineEvent({
        chapterId: entry?.id ?? null,
        settingId: who || null,
        storylineId: null,
        at: clock,
        event: text,
      });
      // 记完清空那句话、时刻跟着走：下一条就是"此刻"的下一件事
      setWhat('');
      setClock(diaryClockNow());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        flexWrap: 'wrap',
        padding: '4px 8px',
        borderBottom: `1px solid ${CV.divider}`,
        background: 'transparent',
      }}
    >
      <input
        type="time"
        value={clock}
        onChange={(e) => setClock(e.target.value)}
        aria-label={t('writing.diary.captureWhenLabel')}
        style={{
          fontSize: uiFontSize(10),
          padding: '2px 4px',
          border: `1px solid ${CV.divider}`,
          borderRadius: 6,
          background: 'transparent',
          color: CV.text,
          width: 76,
        }}
      />
      <input
        value={what}
        onChange={(e) => setWhat(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={t('writing.diary.captureWhatPh')}
        aria-label={t('writing.diary.captureWhatPh')}
        style={{
          flex: '1 1 120px',
          minWidth: 120,
          fontSize: uiFontSize(11),
          padding: '3px 6px',
          border: `1px solid ${CV.divider}`,
          borderRadius: 6,
          background: 'transparent',
          color: CV.text,
        }}
      />
      <select
        value={who}
        onChange={(e) => setWho(e.target.value)}
        aria-label={t('writing.diary.captureWhoLabel')}
        style={{
          fontSize: uiFontSize(10),
          padding: '2px 4px',
          border: `1px solid ${CV.divider}`,
          borderRadius: 6,
          background: 'transparent',
          color: CV.text2,
          maxWidth: 110,
        }}
      >
        <option value="">{t('writing.diary.captureWhoNone')}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy || !what.trim()}
        onClick={() => void submit()}
        style={{
          ...miniBtn(accent),
          fontSize: uiFontSize(10),
          padding: '2px 8px',
          opacity: busy || !what.trim() ? 0.45 : 1,
        }}
      >
        {t('writing.diary.captureSubmit')}
      </button>
      <span style={{ fontSize: uiFontSize(9.5), color: CV.text3, width: '100%' }}>
        {t('writing.diary.captureCount', {
          date: todayEntry?.title || diaryEntryTitle(dayKey),
          weekday: diaryWeekdayShort(),
          n: todayCount,
        })}
      </span>
    </div>
  );
}

export function TimelinePane({ accent, bookId }: { accent: string; bookId: string }) {
  const settings = useWritingStore((s) => s.settings);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const storylines = useWritingStore((s) => s.storylines);
  const loadStorylines = useWritingStore((s) => s.loadStorylines);
  const createStoryline = useWritingStore((s) => s.createStoryline);
  const updateStoryline = useWritingStore((s) => s.updateStoryline);
  const deleteStoryline = useWritingStore((s) => s.deleteStoryline);
  const createTimelineEvent = useWritingStore((s) => s.createTimelineEvent);
  const updateTimelineEvent = useWritingStore((s) => s.updateTimelineEvent);
  const deleteTimelineEvent = useWritingStore((s) => s.deleteTimelineEvent);
  const loadTimelineEvents = useWritingStore((s) => s.loadTimelineEvents);
  const loadSettings = useWritingStore((s) => s.loadSettings);
  const chapters = useWritingStore((s) => s.chapters);
  // ⑲ 体裁闸口：这条轴上有「＋ 新建剧情线」，所以它必须知道这本书是什么体裁。
  // ⑨ 只裁了 storylines 页签，结果诗集作者能在**没被裁的时间线页签**里造出一条
  // 再也看不见的剧情线 —— 视图藏了、入口没关，等于化妆。
  const tlGenre = useWritingStore((s) => s.books.find((b) => b.id === bookId)?.genre ?? '');
  const loadChapters = useWritingStore((s) => s.loadChapters);
  const selectedTimelineEventId = useEditorStore((s) => s.selectedTimelineEventId);
  const bookScopedSettings = useMemo(
    () => (bookId ? settings.filter((s) => s.bookId === bookId) : settings),
    [settings, bookId],
  );
  // 章视图（按章 / 全书）切换；口径放 editorStore 共享（右栏总览冲突点选需切换口径），默认全书轴。
  const timelineView = useEditorStore((s) => s.timelineViewMode);
  // 轨道过滤器（pane 本地 UI 偏好，P1-B）：all=全部 / withEvents=有事件 / empty=未锚定(空轨道) / conflicted=有冲突。
  const [laneFilter, setLaneFilter] = useState<'all' | 'withEvents' | 'empty' | 'conflicted'>('all');
  // 新建动线闭环（方案 B）：刚创建的事件 id——用于滚动定位到它的落点卡（空草稿落「待补全」区）。
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  // chapter 视图：按 volume 分组折叠——章节量增长时避免纵向无限膨胀（与 stats 面板卷展开同范式）
  const [expandedVolLanes, setExpandedVolLanes] = useState<Set<string>>(new Set());
  const isVolExpanded = (id: string) => expandedVolLanes.has(id);
  const toggleVolExpanded = (id: string) =>
    setExpandedVolLanes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // 本书章按 sortOrder 排成阅读顺序轴（章节级时间线的唯一可计算骨架）。
  const bookChapters = useMemo(
    () => (bookId ? chapters.filter((c) => c.bookId === bookId).sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [chapters, bookId],
  );
  // AI-12 ④（轮 30）：这张卡是「半张换源」的形状——settings/chapters 两嘴早已按本卡书滤，事件与线
  // 四嘴照旧吃活跃书缓存 ⇒ 诗集的轴上排着小说的事件、给小说的线挂线。与 InspirationPanels 当时的
  // 灵感卡同形。装载 guard（下方 useEffect）按 activeBookId，本轮不许顺手。
  const bookEvents = useMemo(() => timelineEvents.filter((e) => e.bookId === bookId), [timelineEvents, bookId]);
  const bookStorylines = useMemo(() => storylines.filter((l) => l.bookId === bookId), [storylines, bookId]);

  // 时间线数据可能尚未 load（本视图不再走 seed 异步加载）：挂载时按书补齐。
  useEffect(() => {
    const ws = useWritingStore.getState();
    if (!ws.activeBookId) return;
    if (ws.settings.length === 0) void ws.loadSettings().catch(() => {});
    if (ws.timelineEvents.length === 0) void ws.loadTimelineEvents().catch(() => {});
    if (!ws.chapters.some((c) => c.bookId === bookId)) void ws.loadChapters(bookId).catch(() => {});
    if (ws.storylines.length === 0) void ws.loadStorylines().catch(() => {});
  }, [loadTimelineEvents, loadSettings, loadChapters, loadStorylines, bookId]);

  // 完整事件（同时有 at 与 event）才进主时间轴 / 合并轴；空 at 或空 event 的草稿归入「待补全」，不污染主时间轴。
  const { completeEvents, incompleteEvents } = useMemo(() => {
    const comp: WritingTimelineEvent[] = [];
    const inc: WritingTimelineEvent[] = [];
    for (const ev of bookEvents) (isComplete(ev) ? comp : inc).push(ev);
    return { completeEvents: comp, incompleteEvents: inc };
  }, [bookEvents]);

  // 事件 at 排序统一走 utils 唯一口径 compareByAt（空 at 排后），不再本地 new Collator（禁止第二份）。
  // eslint-disable-next-line react-hooks/exhaustive-deps -- sortEventsByAt 是普通函数（每次 render 新建），内部只调用 utils.compareByAt，闭包纯净
  const sortEventsByAt = (a: WritingTimelineEvent, b: WritingTimelineEvent) => compareByAt(a.at, b.at);

  // 全书合并轴：跨所有 lane 的完整事件按 at 混排，作为「全书的」总览（每个 chip 标注来源 lane）。
  const mergedLane = useMemo<Lane>(
    () => ({
      id: '__merged__',
      name: t('writing.timelineMerged'),
      isBook: false,
      settingId: null,
      events: [...completeEvents].sort(sortEventsByAt),
    }),
    [completeEvents],
  );

  // 事件来源 lane 名（用于合并轴 / 待补全的 chip 标注）
  const laneNameOf = (settingId: string | null): string =>
    settingId
      ? bookScopedSettings.find((s) => s.id === settingId)?.name || t('writingWorkbench.untitled')
      : t('writing.timelineBookLevel');

  // lane：全书级(settingId=null) 优先；其余仅展示「有事件」的设定，按最早 at 排序否则按名。
  const settingLanes = useMemo<Lane[]>(() => {
    const bookName = t('writing.timelineBookLevel');
    const laneMap = new Map<string, Lane>();
    laneMap.set('__book__', { id: '__book__', name: bookName, isBook: true, settingId: null, events: [] });
    for (const s of bookScopedSettings) {
      laneMap.set(s.id, {
        id: s.id,
        name: s.name || t('writingWorkbench.untitled'),
        isBook: false,
        settingId: s.id,
        events: [],
      });
    }
    for (const ev of completeEvents) {
      const lid = ev.settingId ?? '__book__';
      const lane = laneMap.get(lid);
      if (lane) lane.events.push(ev);
    }
    const list = [...laneMap.values()].filter((l) => l.isBook || l.events.length > 0);
    for (const l of list) l.events.sort(sortEventsByAt);
    list.sort((a, b) => {
      if (a.isBook) return -1;
      if (b.isBook) return 1;
      const ea = a.events.find((e) => e.at?.trim())?.at?.trim() || '';
      const eb = b.events.find((e) => e.at?.trim())?.at?.trim() || '';
      if (ea && eb) return compareByAt(ea, eb) || a.name.localeCompare(b.name, 'zh');
      if (ea) return -1;
      if (eb) return 1;
      return a.name.localeCompare(b.name, 'zh');
    });
    return list;
  }, [completeEvents, bookScopedSettings,  sortEventsByAt]);

  // 章节级 lane：本书章按 sortOrder 为骨架，每章一组其绑定事件；末尾「未绑章」组收纳 chapterId 为空的事件。
  // 空章（无绑定事件）也列出并标「未锚定」，作为规划空缺提示。
  const chapterLanes = useMemo<Lane[]>(
    () =>
      buildChapterLanes(
        bookChapters,
        completeEvents,
        {
          unbound: t(surfaceKeyForGenre(tlGenre, 'tlUnbound')),
          untitled: t('writingWorkbench.untitled'),
        },
        { groupByVolume: true },
      ),
    [bookChapters, completeEvents, tlGenre],
  );

  // 剧情线 lane（P0）：每条线一轨（color=线配色），末尾「未挂线」组收纳 storylineId 为空的事件。
  // 空线也列出（规划空缺提示，与章轴未锚定同语义）。
  const storylineLanes = useMemo<Lane[]>(() => {
    const lanes: Lane[] = bookStorylines.map((sl) => ({
      id: sl.id,
      name: sl.name,
      isBook: false,
      settingId: null,
      events: completeEvents.filter((e) => e.storylineId === sl.id).sort(sortEventsByAt),
    }));
    lanes.push({
      id: '__unlined__',
      name: t('writing.storylineUnlined'),
      isBook: false,
      settingId: null,
      events: completeEvents.filter((e) => !e.storylineId).sort(sortEventsByAt),
    });
    return lanes;
  }, [bookStorylines, completeEvents]);

  // 视图切换：全书轴（按设定分轨）/ 按章轴（按章分轨）/ 剧情线轴（按线分轨）
  const lanes = timelineView === 'book' ? settingLanes : timelineView === 'chapter' ? chapterLanes : storylineLanes;

  // P2 冲突检测（派生视图 / 软提示，琥珀色不强制）：同轨 at 碰撞 + 跨章时间倒挂。
  // 直接基于 events 计算（与右栏总览共用同一算法，避免 lane 构建口径分裂）。
  const conflictIds = useMemo<Set<string>>(
    () => computeTimelineConflicts(bookEvents, { view: timelineView, chapters: bookChapters }),
    [timelineView, bookEvents, bookChapters],
  );

  // P2 覆盖率：已锚定章 / 总章；未绑章事件数（章节视图用）
  const coverage = useMemo(() => computeCoverage(bookChapters, completeEvents), [bookChapters, completeEvents]);

  // P1-B 轨道过滤器：只过滤轨道渲染，不动合并轴 / 待补全 / 覆盖率仪表（统计口径保持全局）。
  const [eventQuery, setEventQuery] = useState('');
  const eventFilter = useMemo(() => {
    const q = eventQuery.trim().toLowerCase();
    if (!q) return null;
    return (ev: WritingTimelineEvent) => ev.at?.toLowerCase().includes(q) || ev.event?.toLowerCase().includes(q);
  }, [eventQuery]);
  const filteredLanes = useMemo(() => {
    let base = lanes;
    if (laneFilter === 'withEvents') base = base.filter((l) => l.events.length > 0);
    if (laneFilter === 'empty') base = base.filter((l) => l.events.length === 0);
    if (laneFilter === 'conflicted') base = base.filter((l) => l.events.some((e) => conflictIds.has(e.id)));
    if (!eventFilter) return base;
    return base
      .map((l) => ({ ...l, events: l.events.filter(eventFilter) }))
      .filter((l) => l.events.length > 0 || l.group);
  }, [lanes, laneFilter, conflictIds, eventFilter]);

  // 事件跳转：绑了章优先跳章，否则跳来源设定（合并轴 / 轨道 / 待补全通用）
  const jumpForEvent = (ev: WritingTimelineEvent) => {
    if (ev.chapterId) {
      const b = useWritingStore.getState().books.find((x) => x.id === bookId);
      openChapterCarrierView(ev.chapterId, ev.event || t('writingWorkbench.untitled'), b?.genre ?? '', bookId);
    } else if (ev.settingId) {
      openSettingProfile(ev.settingId);
    }
  };

  // 统一新建入口（方案 B）：创建空草稿后立即选中（SceneEditor effect 自动带动右栏详情 tab）
  // 并登记 justCreatedId 供下方 effect 滚动定位——空 at/event 草稿会落「待补全」区而非当前轨道，
  // 不选中不定位的话用户会以为「点了没反应」。
  const handleCreateEvent = async (opts: {
    settingId?: string | null;
    chapterId?: string | null;
    storylineId?: string | null;
  }) => {
    // AI-12 ④-e（落刀普查并入，同卡同形状）：事件按 store 活跃书落库 ⇒ 在 B 卡上「＋新建事件」
    // 会静默建进 A。与建线同一道闸，扳不动宁可不建。
    if (!(await ensureWritingBookWired(bookId))) return;
    const ev = await createTimelineEvent({
      settingId: opts.settingId ?? null,
      chapterId: opts.chapterId ?? null,
      storylineId: opts.storylineId ?? null,
      at: '',
      event: '',
    });
    if (!ev) return;
    useEditorStore.getState().selectTimelineEvent(ev.id);
    setJustCreatedId(ev.id);
  };

  // 新建后滚动定位：等一帧让新卡渲染进 DOM，再滚到落点卡（选中高亮环本身即视觉反馈）。
  useEffect(() => {
    if (!justCreatedId) return;
    const raf = requestAnimationFrame(() => {
      document
        .querySelector(`[data-ev-id="${justCreatedId}"]`)
        ?.scrollIntoView({ behavior: currentScrollBehavior(), block: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [justCreatedId]);

  // AI-12 ④-d（轮 30）：建线按活跃书落库 + 默认名数整份缓存，两处同病 ⇒ 与 StorylineSection 建线
  // 同一口径：先扳正本卡书，扳不动宁可不建。
  const handleCreateStoryline = async () => {
    if (!(await ensureWritingBookWired(bookId))) return;
    await createStoryline(t('writing.storylineDefaultName', { n: bookStorylines.length + 1 }));
  };

  const totalEvents = useMemo(() => filteredLanes.reduce((n, l) => n + l.events.length, 0), [filteredLanes]);

  const laneColor = (lane: { id: string; isBook: boolean; settingId: string | null }): string => {
    if (lane.isBook) return accent;
    if (lane.settingId) {
      const s = bookScopedSettings.find((x) => x.id === lane.settingId);
      if (s && s.kind === 'worldbuilding') {
        const subtype = parseSettingExtra(s.extra).worldbuildingProfile?.type;
        if (subtype && WB_TYPE_COLORS[subtype]) return WB_TYPE_COLORS[subtype].fg;
      }
    }
    return LANE_COLORS[hashStr(lane.id) % LANE_COLORS.length];
  };

  const openSettingProfile = (settingId: string) => {
    void openWritingDesk({ bookId, settingId });
  };

  return (
    <div style={paneStyle}>
      <PaneHeader label={t('writing.viewKind.timeline')} count={totalEvents} />
      {/* ㉭ M1a：只有「一条一天」的载体挂记录条；其余四体裁这一栏逐字不变（零回归线） */}
      <DiaryCaptureBar accent={accent} bookId={bookId} genre={tlGenre} />
      {/* 视图口径（全书轴/按章轴/剧情线轴）+ 剧情线管理 + 全局新建；行首小节标签让「口径/创建」与下方「筛选」语义分层 */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px 0', flexShrink: 0, flexWrap: 'wrap' }}
      >
        <span style={{ fontSize: 9.5, color: CV.text3, flexShrink: 0 }}>{t('writing.timelineGroupView')}</span>
        {(['book', 'chapter', 'storyline'] as const)
          // ⑲ 体裁不允许造剧情线时，这条轴本身就不出现（不是只禁按钮 —— 禁了按钮留着空轴更困惑）
          .filter((v) => v !== 'storyline' || canCreateEntityForGenre(tlGenre, 'storyline'))
          .map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => useEditorStore.getState().setTimelineViewMode(v)}
            style={{
              ...miniBtn(v === timelineView ? accent : '#64748b'),
              fontSize: 10.5,
              padding: '2px 10px',
              fontWeight: v === timelineView ? 700 : 400,
              borderColor: v === timelineView ? accent : CV.divider,
              background: v === timelineView ? `${accent}1a` : CV.paper,
              color: v === timelineView ? accent : CV.text2,
            }}
          >
            {t(
              v === 'book'
                ? 'writing.timelineViewBook'
                : v === 'chapter'
                  ? surfaceKeyForGenre(tlGenre, 'tlAxisUnit')
                  : 'writing.timelineViewStoryline',
            )}
          </button>
        ))}
        {/* 剧情线管理：仅剧情线口径显示——建线动作发生在挂线语境里，不混进其他轴 */}
        {timelineView === 'storyline' && canCreateEntityForGenre(tlGenre, 'storyline') && (
          <button
            type="button"
            onClick={() => void handleCreateStoryline()}
            style={{ ...miniBtn(accent), fontSize: 10, padding: '2px 8px' }}
          >
            ＋ {t('writing.storylineCreate')}
          </button>
        )}
        {/* 全局新建：book 视图默认全书级、chapter 视图默认未绑章、storyline 视图默认未挂线（可再绑）；
            创建后自动选中 → 右栏详情即编 + 滚动定位到落点卡，动线零寻找成本 */}
        <button
          type="button"
          onClick={() =>
            void handleCreateEvent(
              timelineView === 'book'
                ? { settingId: null }
                : timelineView === 'chapter'
                  ? { chapterId: null }
                  : { storylineId: null },
            )
          }
          style={{
            ...miniBtn(accent),
            marginLeft: 'auto',
            fontSize: 10.5,
            padding: '2px 10px',
            fontWeight: 700,
          }}
        >
          ＋ {t('writing.timelineCreateEvent')}
        </button>
      </div>
      {/* P1-B 轨道过滤器：只影响轨道列表；合并轴 / 待补全 / 覆盖率保持全局口径 */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px 0', flexShrink: 0, flexWrap: 'wrap' }}
      >
        <input
          type="text"
          value={eventQuery}
          onChange={(e) => setEventQuery(e.target.value)}
          placeholder={t('writing.timelineSearchPlaceholder')}
          style={{
            fontSize: 10,
            padding: '2px 8px',
            border: `1px solid ${CV.divider}`,
            borderRadius: 5,
            background: 'transparent',
            color: CV.text,
            outline: 'none',
            width: 120,
            minWidth: 0,
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 9.5, color: CV.text3, flexShrink: 0 }}>{t('writing.timelineGroupFilter')}</span>
        {(['all', 'withEvents', 'empty', 'conflicted'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setLaneFilter(f)}
            style={{
              ...miniBtn(laneFilter === f ? accent : '#64748b'),
              fontSize: 9.5,
              padding: '1px 8px',
              fontWeight: laneFilter === f ? 700 : 400,
              borderColor: laneFilter === f ? accent : CV.divider,
              background: laneFilter === f ? `${accent}1a` : CV.paper,
              color: laneFilter === f ? accent : CV.text2,
            }}
          >
            {t(
              f === 'all'
                ? 'writing.timelineFilterAll'
                : f === 'withEvents'
                  ? 'writing.timelineFilterWithEvents'
                  : f === 'empty'
                    ? 'writing.timelineFilterUnanchored'
                    : 'writing.timelineFilterConflicted',
            )}
          </button>
        ))}
      </div>
      <div style={paneBodyStyle}>
        {/* P2 章节视图：锚定覆盖率仪表 + 冲突提示图例（均仅 advisory，不强制） */}
        {timelineView === 'chapter' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 6px 6px',
              flexShrink: 0,
              fontSize: 10.5,
              color: CV.text2,
              flexWrap: 'wrap',
              border: `1px solid ${CV.divider}`,
              borderRadius: 8,
              background: CV.paper,
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <span style={{ fontWeight: 700, color: CV.text, fontVariantNumeric: 'tabular-nums' }}>
              {t('writing.timelineCoverage', { a: coverage.anchoredChapterCount, t: coverage.totalChapters })}
            </span>
            <div
              style={{
                flex: '1 1 160px',
                maxWidth: 220,
                height: 5,
                borderRadius: 3,
                background: CV.divider,
                overflow: 'hidden',
                minWidth: 60,
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${coverage.totalChapters ? Math.round((coverage.anchoredChapterCount / coverage.totalChapters) * 100) : 0}%`,
                  background: accent,
                  borderRadius: 3,
                  transition: 'width 120ms',
                }}
              />
            </div>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {t(surfaceKeyForGenre(tlGenre, 'tlUnbound'))} {coverage.unboundEventCount}
            </span>
          </div>
        )}
        {timelineView === 'chapter' && conflictIds.size > 0 && (
          <div style={{ fontSize: 9.5, color: CV.warning, padding: '0 2px 4px' }}>
            ⚠ {t('writing.timelineConflict')}：{t(surfaceKeyForGenre(tlGenre, 'tlConflictHint'))}
          </div>
        )}
        {/* 待补全：空 at / 空 event 的草稿归此处，不污染主时间轴（零阻力捕获，可暂留） */}
        {incompleteEvents.length > 0 ? (
          <div
            style={{
              border: `1px solid ${CV.warning}`,
              borderRadius: 8,
              background: CV.warningSoft,
              padding: '8px 10px',
              flexShrink: 0,
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            {/* 头部：刚性两行，消除 flex-wrap 折行混乱 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: CV.text }}>{t('writing.timelineIncomplete')}</span>
                <span style={{ fontSize: 10, color: CV.text3, flexShrink: 0 }}>
                  {t('editor.writing.timelineEventCount', { n: incompleteEvents.length })}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  // 删除铁律（2026-11-04 全仓删除账 ③c）：批量 + 不可撤销的动作不许一点即删。
                  // 后果走全局确认出口，条数写进标题（旧实现一个按钮直接 Promise.all 掉全部草稿，
                  // 既不说几条、也不说能不能反悔）。
                  confirmDestructive({
                    title: t('writing.timelineClearIncompleteConfirmTitle', { n: incompleteEvents.length }),
                    impact: [
                      t('writing.timelineClearIncompleteImpactCanvas'),
                      t('writing.timelineClearIncompleteImpactUndo'),
                    ],
                    confirmLabel: t('writing.timelineClearIncomplete'),
                    cancelLabel: t('ui.cancel'),
                    onConfirm: () => {
                      void Promise.all(incompleteEvents.map((ev) => deleteTimelineEvent(ev.id)));
                    },
                  });
                }}
                style={{ ...miniBtn(CV.error), fontSize: 9.5, padding: '1px 8px', flexShrink: 0 }}
              >
                {t('writing.timelineClearIncomplete')}
              </button>
            </div>
            <div style={{ fontSize: 9.5, color: CV.text3, marginBottom: 8, lineHeight: 1.35 }}>
              {t('writing.timelineIncompleteHint')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
              {incompleteEvents.map((ev) => (
                <EventChip
                  key={ev.id}
                  ev={ev}
                  color={CV.text2}
                  sourceLabel={laneNameOf(ev.settingId)}
                  chapters={bookChapters}
                  storylines={bookStorylines}
                  warn={conflictIds.has(ev.id)}
                  onJump={() => jumpForEvent(ev)}
                  onDelete={() => void deleteTimelineEvent(ev.id)}
                  onUpdate={(patch) => updateTimelineEvent(ev.id, patch)}
                  onSelect={() => useEditorStore.getState().selectTimelineEvent(ev.id)}
                  selected={selectedTimelineEventId === ev.id}
                  fill
                />
              ))}
            </div>
          </div>
        ) : (
          <div
            style={{
              border: `1px dashed ${CV.divider}`,
              borderRadius: 8,
              padding: '10px',
              textAlign: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 10, color: CV.text3 }}>{t('writing.timelineNoIncomplete')}</span>
          </div>
        )}
        {/* 全书合并轴：跨 lane 的总览，每个事件标注来源 lane，按 at 混排。
            两种口径都显示（拍板 2026-09-18）：合并轴是全书总览、独立于轨道口径，
            曾经仅全书模式显示 → 口径持久在章视图时合并轴无声消失（用户「看不到」根因）。 */}
        <div
          style={{
            border: `1.5px solid ${accent}`,
            borderRadius: 8,
            background: CV.paper,
            minWidth: 0,
            flexShrink: 0,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 8px',
              borderBottom: `1px solid ${CV.divider}`,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, fontWeight: 700, color: CV.text }}>{mergedLane.name}</span>
            <span style={{ fontSize: 9.5, color: CV.text3 }}>
              {t('editor.writing.timelineEventCount', { n: mergedLane.events.length })}
            </span>
          </div>
          <div style={{ padding: '10px 10px 12px', overflowX: 'auto' }}>
            {mergedLane.events.length === 0 ? (
              <div style={{ fontSize: 10.5, color: CV.text3 }}>—</div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 10,
                  minWidth: 'max-content',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 2,
                    height: 1.5,
                    background: CV.divider,
                    borderRadius: 1,
                  }}
                />
                {mergedLane.events.map((ev) => (
                  <EventChip
                    key={ev.id}
                    ev={ev}
                    color={laneColor({
                      id: ev.settingId ?? '__book__',
                      isBook: !ev.settingId,
                      settingId: ev.settingId,
                    })}
                    sourceLabel={laneNameOf(ev.settingId)}
                    chapters={bookChapters}
                    storylines={bookStorylines}
                    warn={conflictIds.has(ev.id)}
                    onJump={() => jumpForEvent(ev)}
                    onDelete={() => void deleteTimelineEvent(ev.id)}
                    onUpdate={(patch) => updateTimelineEvent(ev.id, patch)}
                    onSelect={() => useEditorStore.getState().selectTimelineEvent(ev.id)}
                    selected={selectedTimelineEventId === ev.id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        {filteredLanes.length === 0 && incompleteEvents.length === 0 && (
          <EmptyHint text={t(surfaceKeyForGenre(tlGenre, 'tlEmptyHint'))} />
        )}
        {filteredLanes.map((lane) => {
          // storyline 视图：轨道色 = 线自定义色（空则 id 哈希兜底）；「未挂线」组恒灰
          const color =
            timelineView === 'storyline'
              ? lane.id === '__unlined__'
                ? '#64748b'
                : storylines.find((sl) => sl.id === lane.id)?.color ||
                  LANE_COLORS[hashStr(lane.id) % LANE_COLORS.length]
              : laneColor(lane);
          // chapter 视图聚合节点：group 存在即折叠容器，默认折叠
          if (timelineView === 'chapter' && lane.group && !isVolExpanded(lane.id)) {
            return (
              <div
                key={lane.id}
                style={{
                  border: `1px solid ${CV.divider}`,
                  borderRadius: 8,
                  background: CV.paper,
                  flexShrink: 0,
                  marginTop: 4,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleVolExpanded(lane.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 10px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 10, color: CV.text3 }}>{'▸'}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: CV.text }}>
                    {/* ㉞ T-F″：无组那一组的名字按体裁（chapter 视图的组 = 卷 / 分组 / 幕 / 年月） */}
                    {lane.name || t(surfaceKeyForGenre(tlGenre, 'bandUncategorized'))}
                  </span>
                  <span style={{ fontSize: 9.5, color: CV.text3 }}>
                    {t('editor.writing.timelineEventCount', { n: lane.events.length })} ·{' '}
                    {t(surfaceKeyForGenre(tlGenre, 'childCount'), { n: lane.group.chapters.length })}
                  </span>
                  {lane.events.length === 0 &&
                    lane.group.chapters.some((l) => l.chapterId && l.events.length === 0) && (
                      <span style={{ fontSize: 9, color: CV.warning }}>{t('writing.timelineGap')}</span>
                    )}
                </button>
              </div>
            );
          }
          // chapter 视图聚合节点：展开后渲染组头 + 内部章节轨道
          if (timelineView === 'chapter' && lane.group && isVolExpanded(lane.id)) {
            return (
              <div
                key={lane.id}
                style={{
                  border: `1px solid ${CV.divider}`,
                  borderRadius: 8,
                  background: CV.paper,
                  minWidth: 0,
                  flexShrink: 0,
                  marginTop: 4,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleVolExpanded(lane.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 10px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    borderBottom: `1px solid ${CV.divider}`,
                  }}
                >
                  <span style={{ fontSize: 10, color: CV.text3 }}>{'▾'}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: CV.text }}>
                    {/* ㉞ T-F″：无组那一组的名字按体裁（chapter 视图的组 = 卷 / 分组 / 幕 / 年月） */}
                    {lane.name || t(surfaceKeyForGenre(tlGenre, 'bandUncategorized'))}
                  </span>
                  <span style={{ fontSize: 9.5, color: CV.text3 }}>
                    {t('editor.writing.timelineEventCount', { n: lane.events.length })} ·{' '}
                    {t(surfaceKeyForGenre(tlGenre, 'childCount'), { n: lane.group.chapters.length })}
                  </span>
                </button>
                {lane.group.chapters.map((chLane) => {
                  const chColor = laneColor(chLane);
                  return (
                    <div
                      key={chLane.id}
                      style={{ display: 'flex', alignItems: 'stretch', borderTop: `1px solid ${CV.divider}` }}
                    >
                      <div
                        style={{
                          position: 'sticky',
                          left: 0,
                          zIndex: 1,
                          flexShrink: 0,
                          minWidth: 132,
                          maxWidth: 132,
                          background: CV.paper,
                          borderRight: `1px solid ${CV.divider}`,
                          padding: '6px 8px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const b = useWritingStore.getState().books.find((x) => x.id === bookId);
                            openChapterCarrierView(chLane.chapterId!, chLane.name, b?.genre ?? '', bookId);
                          }}
                          title={t(surfaceKeyForGenre(tlGenre, 'tlJumpUnit'))}
                          style={{
                            ...miniBtn(chColor),
                            border: 'none',
                            padding: 0,
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: CV.text,
                            background: 'transparent',
                            textAlign: 'left',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {chLane.name}
                        </button>
                        {chLane.subtitle && <span style={{ fontSize: 9.5, color: CV.text3 }}>{chLane.subtitle}</span>}
                        <span style={{ fontSize: 9.5, color: CV.text3 }}>
                          {t('editor.writing.timelineEventCount', { n: chLane.events.length })}
                        </span>
                        {chLane.chapterId && chLane.events.length === 0 && (
                          <span style={{ fontSize: 9.5, color: CV.warning }}>{t('writing.timelineGap')}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleCreateEvent({ chapterId: chLane.chapterId })}
                          style={{ ...miniBtn(chColor), marginTop: 2 }}
                        >
                          {t('writingDesign.add')}
                        </button>
                      </div>
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflowX: 'auto',
                          position: 'relative',
                          padding: '10px 10px 12px',
                        }}
                      >
                        {chLane.events.length === 0 ? (
                          <div
                            style={{
                              fontSize: 10,
                              color: CV.text3,
                              border: `1px dashed ${CV.divider}`,
                              borderRadius: 6,
                              padding: '10px 12px',
                            }}
                          >
                            {t('writing.timelineLaneEmptyHint')}
                          </div>
                        ) : (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'flex-end',
                              gap: 10,
                              minWidth: 'max-content',
                              position: 'relative',
                            }}
                          >
                            <div
                              style={{
                                position: 'absolute',
                                left: 0,
                                right: 0,
                                bottom: 2,
                                height: 1.5,
                                background: CV.divider,
                                borderRadius: 1,
                              }}
                            />
                            {chLane.events.map((ev) => (
                              <EventChip
                                key={ev.id}
                                ev={ev}
                                color={chColor}
                                chapters={bookChapters}
                                storylines={bookStorylines}
                                warn={conflictIds.has(ev.id)}
                                onJump={() => jumpForEvent(ev)}
                                onDelete={() => void deleteTimelineEvent(ev.id)}
                                onUpdate={(patch) => updateTimelineEvent(ev.id, patch)}
                                onSelect={() => useEditorStore.getState().selectTimelineEvent(ev.id)}
                                selected={selectedTimelineEventId === ev.id}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          }
          return (
            <div
              key={lane.id}
              style={{
                display: 'flex',
                alignItems: 'stretch',
                border: `1px solid ${CV.divider}`,
                borderRadius: 8,
                background: CV.paper,
                minWidth: 0,
                flexShrink: 0,
                marginTop: 4,
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              }}
            >
              {/* 轨道标签（左侧固定列，可点进要素检查器） */}
              <div
                style={{
                  position: 'sticky',
                  left: 0,
                  zIndex: 1,
                  flexShrink: 0,
                  minWidth: 132,
                  maxWidth: 132,
                  background: CV.paper,
                  borderRight: `1px solid ${CV.divider}`,
                  padding: '6px 8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: color,
                      flexShrink: 0,
                      cursor: timelineView === 'storyline' && lane.id !== '__unlined__' ? 'pointer' : 'default',
                    }}
                    onClick={() => {
                      if (timelineView === 'storyline' && lane.id !== '__unlined__')
                        useEditorStore.getState().selectStoryline(lane.id);
                    }}
                    onDoubleClick={() => {
                      if (timelineView === 'storyline' && lane.id !== '__unlined__')
                        openTypedCarrierView(
                          useWritingStore.getState().books.find((b) => b.id === bookId)?.genre ?? '',
                          'storylines',
                        );
                    }}
                    title={
                      timelineView === 'storyline' && lane.id !== '__unlined__'
                        ? `${t('writing.storylineSelect')}｜双击 → ${t('writing.storylineOpenPane')}`
                        : undefined
                    }
                  />
                  {timelineView === 'storyline' && !lane.isBook ? (
                    // 剧情线轨：线名就地可编辑（失焦/回车保存）+ 删线（删线不删事件，事件回「未挂线」）
                    <>
                      <DraftInput
                        entityKey={lane.id}
                        value={lane.name}
                        onCommit={(v) => updateStoryline(lane.id, { name: v })}
                        title={t('writing.storylineRename')}
                        style={{ ...inputStyle, fontSize: 11.5, fontWeight: 700, color: CV.text, minWidth: 0, flex: 1 }}
                      />
                      {lane.id !== '__unlined__' && (
                        <button
                          type="button"
                          onClick={() => void deleteStoryline(lane.id)}
                          title={t('writing.storylineDelete')}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.color = CV.error;
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.color = CV.text3;
                          }}
                          style={{ ...delBtnStyle, fontSize: 12, fontWeight: 700, lineHeight: 1 }}
                        >
                          ×
                        </button>
                      )}
                    </>
                  ) : lane.isBook ? (
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: CV.text,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {lane.name}
                    </span>
                  ) : lane.chapterId ? (
                    <button
                      type="button"
                      onClick={() => {
                        const b = useWritingStore.getState().books.find((x) => x.id === bookId);
                        openChapterCarrierView(lane.chapterId!, lane.name, b?.genre ?? '', bookId);
                      }}
                      title={t(surfaceKeyForGenre(tlGenre, 'tlJumpUnit'))}
                      style={{
                        ...miniBtn(color),
                        border: 'none',
                        padding: 0,
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: CV.text,
                        background: 'transparent',
                        textAlign: 'left',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {lane.name}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => useEditorStore.getState().selectSetting(lane.settingId)}
                      title={t('writingDesign.viewDetail')}
                      style={{
                        ...miniBtn(color),
                        border: 'none',
                        padding: 0,
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: CV.text,
                        background: 'transparent',
                        textAlign: 'left',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {lane.name}
                    </button>
                  )}
                </div>
                {lane.subtitle && <span style={{ fontSize: 9.5, color: CV.text3 }}>{lane.subtitle}</span>}
                <span style={{ fontSize: 9.5, color: CV.text3 }}>
                  {t('editor.writing.timelineEventCount', { n: lane.events.length })}
                </span>
                {timelineView === 'chapter' && lane.chapterId && lane.events.length === 0 && (
                  <span style={{ fontSize: 9.5, color: CV.warning }}>{t('writing.timelineGap')}</span>
                )}
                <button
                  type="button"
                  onClick={() =>
                    void handleCreateEvent(
                      lane.isBook
                        ? { settingId: null }
                        : timelineView === 'storyline'
                          ? { storylineId: lane.id === '__unlined__' ? null : lane.id }
                          : lane.chapterId
                            ? { chapterId: lane.chapterId }
                            : { settingId: lane.settingId },
                    )
                  }
                  style={{ ...miniBtn(color), marginTop: 2 }}
                >
                  {t('writingDesign.add')}
                </button>
              </div>
              {/* 轨道时间轴区（横向滚动；事件按序排开，刻度=作者原文 at） */}
              <div style={{ flex: 1, minWidth: 0, overflowX: 'auto', position: 'relative', padding: '10px 10px 12px' }}>
                {lane.events.length === 0 ? (
                  <div
                    style={{
                      fontSize: 10,
                      color: CV.text3,
                      border: `1px dashed ${CV.divider}`,
                      borderRadius: 6,
                      padding: '10px 12px',
                    }}
                  >
                    {t('writing.timelineLaneEmptyHint')}
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-end',
                      gap: 10,
                      minWidth: 'max-content',
                      position: 'relative',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: 2,
                        height: 1.5,
                        background: CV.divider,
                        borderRadius: 1,
                      }}
                    />
                    {lane.events.map((ev) => (
                      <EventChip
                        key={ev.id}
                        ev={ev}
                        color={color}
                        chapters={bookChapters}
                        storylines={bookStorylines}
                        warn={conflictIds.has(ev.id)}
                        onJump={() => jumpForEvent(ev)}
                        onDelete={() => void deleteTimelineEvent(ev.id)}
                        onUpdate={(patch) => updateTimelineEvent(ev.id, patch)}
                        onSelect={() => useEditorStore.getState().selectTimelineEvent(ev.id)}
                        selected={selectedTimelineEventId === ev.id}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 时间线事件卡（轨道内一格）：at 徽标 + 事件正文（可内联编辑）+ 跳编辑 / 删除。
function EventChip({
  ev,
  color,
  sourceLabel,
  chapters,
  storylines,
  onJump,
  onDelete,
  onUpdate,
  warn,
  onSelect,
  selected,
  /** 纵向网格容器（待补全区）撑满单元格；横向 flex 轨道默认内容自适应宽度 */
  fill,
}: {
  ev: WritingTimelineEvent;
  color: string;
  /** 来源 lane 名（合并轴 / 待补全里标注事件归属，普通 lane 不传） */
  sourceLabel?: string;
  /** 本书章列表（用于「绑到章」选择器；为空则不显示选择器） */
  chapters?: WritingChapter[];
  /** 本书剧情线列表（用于「挂线」选择器；为空则不显示选择器） */
  storylines?: { id: string; name: string }[];
  onJump: () => void;
  onDelete: () => void;
  onUpdate: (
    patch: Partial<Pick<WritingTimelineEvent, 'at' | 'event' | 'chapterId' | 'storylineId' | 'timeKey'>>,
  ) => void | Promise<unknown>;
  /** 冲突提示（同轨 at 碰撞 / 跨章时间倒挂）：仅琥珀色软提示，不强制 */
  warn?: boolean;
  /** 选中事件以在右侧栏编辑：点 chip（非输入/按钮区）即选中 */
  onSelect?: () => void;
  /** 是否当前右栏编辑目标（选中高亮环） */
  selected?: boolean;
  /** 纵向网格容器（待补全区）撑满单元格；横向 flex 轨道默认内容自适应宽度 */
  fill?: boolean;
}) {
  const tlChipGenre = useWritingStore((s) => s.books.find((b) => b.id === ev.bookId)?.genre ?? '');
  // 颜色拼接安全：仅 #RRGGBB 可拼 8 位 alpha；CSS 变量（CV.text2 等 var() 引用）拼后缀
  // 是无效 CSS（浏览器整条丢弃 border/background），此处回退中性灰半透明，保证边框/底色始终可见。
  const isHex = /^#[\da-fA-F]{6}$/.test(color);
  const borderColor = selected ? color : warn ? CV.warning : isHex ? `${color}66` : 'rgba(128,128,128,0.4)';
  // hover 反馈（视觉打磨）：悬停时底色/描边加深一档；warn 背景必须用字面 rgba——
  // CV.warning 是 var() 引用，拼 alpha 后缀是无效 CSS（曾导致冲突卡片琥珀底从未渲染）。
  const [hov, setHov] = useState(false);
  const [delHov, setDelHov] = useState(false);
  const bg = warn
    ? hov
      ? 'rgba(237,108,2,0.14)'
      : 'rgba(237,108,2,0.08)'
    : hov
      ? isHex
        ? `${color}1f`
        : 'rgba(128,128,128,0.12)'
      : isHex
        ? `${color}12`
        : 'rgba(128,128,128,0.06)';
  return (
    <div
      data-ev-id={ev.id}
      onMouseEnter={onSelect ? () => setHov(true) : undefined}
      onMouseLeave={onSelect ? () => setHov(false) : undefined}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest('button') || el.closest('input') || el.closest('textarea') || el.closest('[data-picker]'))
          return;
        onSelect?.();
      }}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        cursor: onSelect ? 'pointer' : 'default',
        border: `1px solid ${hov && !selected && !warn ? (isHex ? `${color}99` : 'rgba(128,128,128,0.6)') : borderColor}`,
        borderRadius: 6,
        background: bg,
        boxShadow: selected ? `0 0 0 2px ${isHex ? `${color}33` : 'rgba(128,128,128,0.25)'}` : undefined,
        padding: '4px 6px',
        minWidth: 168,
        width: fill ? '100%' : undefined,
        flex: fill ? undefined : '0 0 auto',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {warn && (
          <span
            title={t(surfaceKeyForGenre(tlChipGenre, 'tlConflictHint'))}
            style={{ fontSize: 10, lineHeight: 1, color: CV.warning, fontWeight: 700, flexShrink: 0 }}
          >
            ⚠
          </span>
        )}
        <DraftInput
          entityKey={ev.id}
          value={ev.at ?? ''}
          onCommit={(v) => onUpdate({ at: v })}
          placeholder={t(surfaceKeyForGenre(tlChipGenre, 'tlAtPlaceholder'))}
          style={{ ...inputStyle, flex: 1, minWidth: 0, fontSize: 10, color, fontWeight: 600 }}
        />
        {/* 可排序时点：填了才参与「跨章时间往回走」检查（口径见 eventSortKey）。
            非整数的提交直接丢弃——把「初五」存成 0 会凭空造出一个假冲突。 */}
        <span title={t('writing.timelineTimeKeyTip')} style={{ flexShrink: 0 }}>
          <DraftInput
            entityKey={`${ev.id}-tk`}
            value={ev.timeKey === null || ev.timeKey === undefined ? '' : String(ev.timeKey)}
            onCommit={(v) => {
              const raw = v.trim();
              if (raw === '') onUpdate({ timeKey: null });
              else if (/^-?\d+$/.test(raw)) onUpdate({ timeKey: Number(raw) });
            }}
            placeholder="#"
            style={{ ...inputStyle, width: 34, fontSize: 10, color }}
          />
        </span>
        <button
          type="button"
          onClick={onJump}
          title={ev.chapterId ? t(surfaceKeyForGenre(tlChipGenre, 'tlJumpUnit')) : t('writingDesign.editProfile')}
          style={{ ...miniBtn(color), fontSize: 9.5, padding: '1px 6px', flexShrink: 0 }}
        >
          {ev.chapterId ? t(surfaceKeyForGenre(tlChipGenre, 'tlJumpUnit')) : t('writingDesign.editProfile')}
        </button>
        <button
          type="button"
          onClick={onDelete}
          onMouseEnter={() => setDelHov(true)}
          onMouseLeave={() => setDelHov(false)}
          title={t('writingDesign.deleteIdea')}
          style={{
            ...delBtnStyle,
            color: delHov ? CV.error : CV.text3,
            fontSize: 12,
            fontWeight: 700,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>
      <DraftInput
        as="textarea"
        rows={2}
        entityKey={ev.id}
        value={ev.event ?? ''}
        onCommit={(v) => onUpdate({ event: v })}
        placeholder={t('writing.timelineEventPh')}
        style={{ ...inputStyle, fontSize: 10.5, resize: 'vertical', lineHeight: 1.35 }}
      />
      {chapters && chapters.length > 0 && (
        <ChapterPicker
          uniqueKey={ev.id}
          chapters={chapters}
          onSelect={(chId) => onUpdate({ chapterId: chId })}
          compact
          width="100%"
          value={ev.chapterId}
          onClear={() => onUpdate({ chapterId: null })}
        />
      )}
      {storylines && storylines.length > 0 && (
        <EntityPicker
          uniqueKey={ev.id}
          items={storylines.map((sl) => ({ id: sl.id, name: sl.name }))}
          placeholder={t('writing.storylineUnlined')}
          onSelect={(slId) => onUpdate({ storylineId: slId })}
          compact
          width="100%"
          value={ev.storylineId}
          onClear={() => onUpdate({ storylineId: null })}
        />
      )}
      {sourceLabel && (
        <span
          style={{ fontSize: 9, color: CV.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {sourceLabel}
        </span>
      )}
    </div>
  );
}
