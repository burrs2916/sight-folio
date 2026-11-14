// L2 题材视图的编辑面（铺满画布的单 pane）
//
// 为什么有这个文件：L2 题材视图（大纲 / 人物设定 / 世界观）此前铺的是**只读分析板**
// （utils/writingBoards 的 buildStoryboard / buildRelationBoard / buildWorldviewBoard，
// 渲染器 WritingEntityRenderer 零 input/onChange/button），数据源是扫描产物
// project_files.metadata.appearances。结果就是「在大纲视图里编辑不了大纲」——
// 可编辑的设计面只存在于「左栏拖体裁载体 → writing-workbench 卡」那条通路上。
// 2026-09-28 收口：L2 编辑面即主编辑面。左栏拖体裁载体（projectCanvas：空书画布
// 打开当前书、有内容新建书）与 L2 页签点击（SceneTabBar → openTypedCarrierView）
// 两条通路已收敛到同一链路；writing-workbench 卡只服务已落库的旧卡。全书总览
// 仪表盘也收口到本 pane 的 L2「overview」页签一份（见 BookOverviewPanel）。
//
// 本渲染器把同一条编辑面直接铺进 L2 视图：一个视图一个 pane，铺满画布，
// 读写真实的 writing_chapters / writing_outlines / writing_settings。
// pane 实现与 WritingDesignView 共用 ./writingPanes，绝不各写一份。
//
// 只读分析板没有删除：buildStoryboard 等仍由「全书总览 / 分镜板 / 人物关系」入口
// 提供（SceneEditorPage.buildBookBoard），它们读的是「扫描到的实况」，定位是结构体检。
import { useEffect } from 'react';
import type { ComponentRendererProps } from '../../types/editor';
import { useWritingStore } from '../../store/writingStore';
import { t } from '../../i18n';
import { CV } from './canvasTheme';
import {
  accentForGenre,
  CastPane,
  collectionPaneKeys,
  ForeshadowingsPane,
  IdeasPane,
  InspirationsPane,
  isCollectionGenre,
  PiecesPane,
  ProofreadPane,
  StatsPane,
  StorylinePane,
  StorylinesPane,
  TimelinePane,
} from './writingPanes';
import { BookOverviewPanel } from '../panels/BookOverviewPanel';
import { studioPaneHintKey, surfaceKeyForGenre, viewKindLabelKey } from '../../utils/writingSchema';

/** 十种可编辑 pane；kind 与 L2 固定功能视图一一对应（含 overview 全书总览） */
export type StudioPaneKind =
  | 'storyline'
  | 'characters'
  | 'worldview'
  | 'timeline'
  | 'storylines'
  | 'foreshadowings'
  | 'inspirations'
  | 'proofread'
  | 'stats'
  | 'overview';

export function isStudioPaneKind(v: unknown): v is StudioPaneKind {
  return (
    v === 'storyline' ||
    v === 'characters' ||
    v === 'worldview' ||
    v === 'timeline' ||
    v === 'storylines' ||
    v === 'foreshadowings' ||
    v === 'inspirations' ||
    v === 'proofread' ||
    v === 'stats' ||
    v === 'overview'
  );
}

/**
 * pane → 它对应的那枚 L2 固定视图 kind（㉛ 表头改吃 `viewKindLabelKey`）。
 *
 * 为什么留这张表而删掉下面那张：它是** pane 与视图 kind 的对应关系**，不是文案
 * ——`foreshadowings` 这枚 pane 对应的 kind 叫 `foreshadowing`（单数），拼不出来，只能登记。
 * 原先它存的是 i18n 键，于是剧本页签已经改叫「角色表」、栏头还顶着「人物设定」，
 * 同一个概念在同一个屏幕上两张嘴。改成存 kind，词就只有一份（在槽位表里）。
 */
const PANE_VIEW_KIND: Record<StudioPaneKind, string> = {
  storyline: 'catalog',
  characters: 'characters',
  worldview: 'worldview',
  timeline: 'timeline',
  storylines: 'storylines',
  foreshadowings: 'foreshadowing',
  inspirations: 'inspiration',
  proofread: 'proofread',
  stats: 'stats',
  overview: 'overview',
};

// ㉛ pane → 引导语的表**已删除**：十句全部由 `studioPaneHintKey(genre, pane)` 现算，
// 回落键就是本表删除前的那十条原键（小说与旧书逐字不变）。留着它 = 留第二份真源。

export function WritingStudioPane({ config }: ComponentRendererProps) {
  const filePath = typeof config.filePath === 'string' ? config.filePath : '';
  const bookId = filePath.match(/^writing:\/\/([^/]+)\//)?.[1] ?? '';
  const pane: StudioPaneKind = isStudioPaneKind(config.pane) ? config.pane : 'storyline';

  const chapters = useWritingStore((s) => s.chapters);
  const outlines = useWritingStore((s) => s.outlines);
  const settings = useWritingStore((s) => s.settings);
  const book = useWritingStore((s) => s.books.find((b) => b.id === bookId));

  // 书接线：从场景直接打开（应用重启后）时 writingStore 可能还没接线
  useEffect(() => {
    if (!bookId) return;
    const ws = useWritingStore.getState();
    if (ws.books.length === 0) void ws.loadBooks().catch(() => {});
    if (ws.activeBookId !== bookId) {
      void ws.setActiveBook(bookId).catch(() => {});
    }
  }, [bookId]);

  if (!bookId) {
    return (
      <div style={{ ...centeredStyle, fontSize: 12, color: CV.text3, padding: 16 }}>
        {t('writingWorkbench.unbound')}
      </div>
    );
  }

  const genre = book?.genre ?? '';
  // 分支判据与设计卡（WritingDesignView）**同一个函数**：以前这里写死 `genre === 'essay'`，
  // 设计卡那边已经换成 isCollectionGenre，于是诗集 / 日记本在 L2 大纲页领到小说的「主线」pane
  // —— 节题还写着「写每一章要发生什么」（T-D，2026-11-10）。
  const isCollection = isCollectionGenre(genre);
  const accent = accentForGenre(genre);
  const paneKeys = collectionPaneKeys(genre);

  return (
    <div
      // 铺满画布的编辑面：整个编辑区不可拖动、不可被画布点选；
      // 卡内 input/button 的事件在拦截层之内，照常工作（与载体卡同一约定）。
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        // 无边框无圆角：本渲染器由 SceneEditor 以「视口贴面」铺满整块画布
        // （见 writingPaneSeed.findFullBleedCard），四面顶到边 —— 留圆角会在四角
        // 漏出画布底纹，留边框就成了「画布里浮着一张带框的卡」，都不是
        // 「编辑区覆盖整个画布」。accent 改由表头承担层级。
        borderRadius: 0,
        border: 'none',
        background: CV.paper,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderBottom: `1px solid ${accent}33`,
          background: `${accent}0f`,
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 700, color: CV.text, flexShrink: 0 }}>
          {t(pane === 'storyline' ? surfaceKeyForGenre(genre, 'paneLabel') : viewKindLabelKey(genre, PANE_VIEW_KIND[pane]))}
        </span>
        <span
          style={{
            fontSize: 10.5,
            color: CV.text3,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {t(studioPaneHintKey(genre, pane))}
        </span>
        {book?.title && (
          <span style={{ fontSize: 10, color: CV.text3, marginLeft: 'auto', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {book.title}
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 8, padding: 8 }}>
        {pane === 'characters' ? (
          <CastPane
            kind="character"
            accent={accent}
            paneLabel={t('writingDesign.pane.characters')}
            emptyText={t('writingDesign.emptyCharacters')}
            bookId={bookId}
          />
        ) : pane === 'worldview' ? (
          <CastPane
            kind="worldbuilding"
            accent={accent}
            paneLabel={t('writingDesign.pane.scenes')}
            emptyText={t('writingDesign.emptyScenes')}
            bookId={bookId}
          />
        ) : pane === 'timeline' ? (
          <TimelinePane accent={accent} bookId={bookId} />
        ) : pane === 'storylines' ? (
          // 剧情线管理面：线实体一览 + 新建/删线/跳时间线剧情线轴（此前该页签无 pane → 空画布）
          <StorylinesPane accent={accent} bookId={bookId} />
        ) : pane === 'foreshadowings' ? (
          // 伏笔管理面：状态分组行表（跨章预警）+ 编辑卡（埋设/回收章/状态三态/挂线）
          <ForeshadowingsPane accent={accent} bookId={bookId} />
        ) : pane === 'inspirations' ? (
          // 灵感工作台：速记念头池（loose beats，零新表）+ 编辑分发卡（转时间线/挂章/转伏笔）
          <InspirationsPane accent={accent} bookId={bookId} />
        ) : pane === 'proofread' ? (
          // 校对工作台：全书体检发现清单（六组维度，纯本地派生），行可点即跳
          <ProofreadPane accent={accent} bookId={bookId} />
        ) : pane === 'stats' ? (
          // 统计工作台：体量 KPI + 日更目标/趋势 + 卷分布 + 章节体量（口径 utils/writingStats）
          <StatsPane accent={accent} bookId={bookId} />
        ) : pane === 'overview' ? (
          // 全书总览工作台：跨维度统一仪表盘（KPI/九大题材导航/风险预警，口径 utils/writingOverview）
          // 内容区是横向 flex，BookOverviewPanel 根是纵向 flex —— 必须外层包一个撑满的纵向容器，
          // 否则面板宽度只等于内容宽度、画布右侧留大片白（其它 pane 用 paneStyle 自带 flex:1）。
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <BookOverviewPanel bookId={bookId} />
          </div>
        ) : isCollection ? (
          // 合集型的「大纲」= 正文单位 + 素材/要点（与设计视图同一分支口径）。
          // 措辞必须一起换：只换分支不换键，诗集这一栏会顶着散文的「篇目 / 立意」（⑩ 的旧账）。
          <>
            {/* ㉫ 本卡书逐字递下去：卡内认书只准吃这个 bookId（config.filePath 现解），不吃工作室活跃书 */}
            <PiecesPane
              accent={accent}
              bookId={bookId}
              chapters={chapters}
              labelKey={paneKeys.pieces}
              emptyKey={paneKeys.piecesEmpty}
            />
            {/* ㉮ 素材栏同 PiecesPane：认书吃本卡 bookId（轮 27 · AI-10，outlines prop 仍是 store 原样缓存，池内过滤在栏内） */}
            <IdeasPane accent={accent} bookId={bookId} outlines={outlines} labelKey={paneKeys.ideas} />
          </>
        ) : (
          <StorylinePane accent={accent} bookId={bookId} chapters={chapters} outlines={outlines} settings={settings} />
        )}
      </div>
    </div>
  );
}

const centeredStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  lineHeight: 1.7,
};
