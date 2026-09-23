// L2 题材视图的编辑面（铺满画布的单 pane）
//
// 为什么有这个文件：L2 题材视图（大纲 / 人物设定 / 世界观）此前铺的是**只读分析板**
// （utils/writingBoards 的 buildStoryboard / buildRelationBoard / buildWorldviewBoard，
// 渲染器 WritingEntityRenderer 零 input/onChange/button），数据源是扫描产物
// project_files.metadata.appearances。结果就是「在大纲视图里编辑不了大纲」——
// 可编辑的设计面只存在于「左栏拖体裁载体 → writing-workbench 卡」那条通路上。
//
// 本渲染器把同一条编辑面直接铺进 L2 视图：一个视图一个 pane，铺满画布，
// 读写真实的 writing_chapters / writing_outlines / writing_settings。
// pane 实现与 WritingDesignView 共用 ./writingPanes，绝不各写一份。
//
// 只读分析板没有删除：buildStoryboard 等仍由「全书总览 / 分镜板 / 人物关系」入口
// 提供（SceneEditorPage.buildBookBoard），它们读的是「扫描到的实况」，定位是结构体检。
import { useEffect } from "react";
import type { ComponentRendererProps } from "../../types/editor";
import { useWritingStore } from "../../store/writingStore";
import { t } from "../../i18n";
import { CV } from "./canvasTheme";
import {
  CastPane,
  ESSAY_ACCENT,
  ForeshadowingsPane,
  IdeasPane,
  InspirationsPane,
  NOVEL_ACCENT,
  PiecesPane,
  ProofreadPane,
  StatsPane,
  StorylinePane,
  StorylinesPane,
  TimelinePane,
} from "./writingPanes";
import { BookOverviewPanel } from "../panels/BookOverviewPanel";

/** 十种可编辑 pane；kind 与 L2 固定功能视图一一对应（含 overview 全书总览） */
export type StudioPaneKind = "storyline" | "characters" | "worldview" | "timeline" | "storylines" | "foreshadowings" | "inspirations" | "proofread" | "stats" | "overview";

export function isStudioPaneKind(v: unknown): v is StudioPaneKind {
  return v === "storyline" || v === "characters" || v === "worldview" || v === "timeline" || v === "storylines" || v === "foreshadowings" || v === "inspirations" || v === "proofread" || v === "stats" || v === "overview";
}

/** pane → 表头标题（复用 L2 页签文案，让视图自述身份，零新键） */
const PANE_LABEL_KEY: Record<StudioPaneKind, string> = {
  storyline: "writing.viewKind.catalog",
  characters: "writing.viewKind.characters",
  worldview: "writing.viewKind.worldview",
  timeline: "writing.viewKind.timeline",
  storylines: "writing.viewKind.storylines",
  foreshadowings: "writing.viewKind.foreshadowing",
  inspirations: "writing.viewKind.inspiration",
  proofread: "writing.viewKind.proofread",
  stats: "writing.viewKind.stats",
  overview: "writing.viewKind.overview",
};

/** pane → 一句话引导（说清「在这里能做什么」） */
const PANE_HINT_KEY: Record<StudioPaneKind, string> = {
  storyline: "editor.writing.studioPane.storylineHint",
  characters: "editor.writing.studioPane.charactersHint",
  worldview: "editor.writing.studioPane.worldviewHint",
  timeline: "editor.writing.studioPane.timelineHint",
  storylines: "editor.writing.studioPane.storylinesHint",
  foreshadowings: "editor.writing.studioPane.foreshadowingsHint",
  inspirations: "editor.writing.studioPane.inspirationsHint",
  proofread: "editor.writing.studioPane.proofreadHint",
  stats: "editor.writing.studioPane.statsHint",
  overview: "editor.writing.studioPane.overviewHint",
};

export function WritingStudioPane({ config }: ComponentRendererProps) {
  const filePath = typeof config.filePath === "string" ? config.filePath : "";
  const bookId = filePath.match(/^writing:\/\/([^/]+)\//)?.[1] ?? "";
  const pane: StudioPaneKind = isStudioPaneKind(config.pane) ? config.pane : "storyline";

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
    return <div style={{ ...centeredStyle, fontSize: 12, color: CV.text3, padding: 16 }}>{t("writingWorkbench.unbound")}</div>;
  }

  const genre = book?.genre ?? "";
  const isEssay = genre === "essay";
  const accent = isEssay ? ESSAY_ACCENT : NOVEL_ACCENT;

  return (
    <div
      // 铺满画布的编辑面：整个编辑区不可拖动、不可被画布点选；
      // 卡内 input/button 的事件在拦截层之内，照常工作（与载体卡同一约定）。
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        // 无边框无圆角：本渲染器由 SceneEditor 以「视口贴面」铺满整块画布
        // （见 writingPaneSeed.findFullBleedCard），四面顶到边 —— 留圆角会在四角
        // 漏出画布底纹，留边框就成了「画布里浮着一张带框的卡」，都不是
        // 「编辑区覆盖整个画布」。accent 改由表头承担层级。
        borderRadius: 0,
        border: "none",
        background: CV.paper,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderBottom: `1px solid ${accent}33`,
          background: `${accent}0f`,
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 700, color: CV.text, flexShrink: 0 }}>
          {t(PANE_LABEL_KEY[pane])}
        </span>
        <span style={{ fontSize: 10.5, color: CV.text3, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t(PANE_HINT_KEY[pane])}
        </span>
        {book?.title && (
          <span style={{ fontSize: 10, color: CV.text3, marginLeft: "auto", flexShrink: 0, whiteSpace: "nowrap" }}>
            {book.title}
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 8, padding: 8 }}>
        {pane === "characters" ? (
          <CastPane
            kind="character"
            accent={accent}
            paneLabel={t("writingDesign.pane.characters")}
            emptyText={t("writingDesign.emptyCharacters")}
            bookId={bookId}
          />
        ) : pane === "worldview" ? (
          <CastPane
            kind="worldbuilding"
            accent={accent}
            paneLabel={t("writingDesign.pane.scenes")}
            emptyText={t("writingDesign.emptyScenes")}
            bookId={bookId}
          />
        ) : pane === "timeline" ? (
          <TimelinePane accent={accent} bookId={bookId} />
        ) : pane === "storylines" ? (
          // 剧情线管理面：线实体一览 + 新建/删线/跳时间线剧情线轴（此前该页签无 pane → 空画布）
          <StorylinesPane accent={accent} bookId={bookId} />
        ) : pane === "foreshadowings" ? (
          // 伏笔管理面：状态分组行表（跨章预警）+ 编辑卡（埋设/回收章/状态三态/挂线）
          <ForeshadowingsPane accent={accent} bookId={bookId} />
        ) : pane === "inspirations" ? (
          // 灵感工作台：速记念头池（loose beats，零新表）+ 编辑分发卡（转时间线/挂章/转伏笔）
          <InspirationsPane accent={accent} bookId={bookId} />
        ) : pane === "proofread" ? (
          // 校对工作台：全书体检发现清单（六组维度，纯本地派生），行可点即跳
          <ProofreadPane accent={accent} bookId={bookId} />
        ) : pane === "stats" ? (
          // 统计工作台：体量 KPI + 日更目标/趋势 + 卷分布 + 章节体量（口径 utils/writingStats）
          <StatsPane accent={accent} bookId={bookId} />
        ) : pane === "overview" ? (
          // 全书总览工作台：跨维度统一仪表盘（KPI/九大题材导航/风险预警，口径 utils/writingOverview）
          <BookOverviewPanel bookId={bookId} />
        ) : isEssay ? (
          // 散文的「大纲」= 篇目 + 立意/素材（与设计视图同一分支口径）
          <>
            <PiecesPane accent={accent} chapters={chapters} />
            <IdeasPane accent={accent} outlines={outlines} />
          </>
        ) : (
          <StorylinePane accent={accent} chapters={chapters} outlines={outlines} settings={settings} />
        )}
      </div>
    </div>
  );
}

const centeredStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  lineHeight: 1.7,
};
