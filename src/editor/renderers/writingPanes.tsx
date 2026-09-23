// 写作编辑面 pane 集合（从 WritingDesignView 抽出，供两处共用）
//
// 为什么抽出来：这些 pane 是**唯一的内容编辑面**（节拍 / 挂载 / 人物 / 世界观 /
// 篇目 / 立意），直接读写 writing_chapters / writing_outlines / writing_settings。
// 它们原本内嵌在 WritingDesignView 里，只有「左栏拖体裁载体 → writing-workbench 卡」
// 一条通路能到达；而 L2 题材视图（大纲/人物/世界观）铺的是只读分析板 —— 结果
// 「在大纲视图里编辑不了大纲」。抽出后：
//   - WritingDesignView   → 载体卡里的三栏设计视图（原样，行为零变化）；
//   - WritingStudioPane   → L2 题材视图里铺满画布的单 pane（新增通路）。
// 两处共用同一实现，绝不再各写一份（口径分裂是这类 bug 的根源）。
//
// 零 Emotion：纯 div/input/span + inline style + CV 主题助手。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openWritingDesk } from "../../utils/writingDeskWindow";
import { useWritingStore } from "../../store/writingStore";
import { useEditorStore } from "../../store/editorStore";
import { WB_TYPE_COLORS } from "../panels/WritingInspectorPanel";
import { WORLDBUILDING_TYPE_KEYS, parseSettingExtra, writingStatsApi, type WritingChapter, type WritingDailyStat, type WritingOutline, type WritingSetting, type WritingTimelineEvent } from "../../services/tauri";
import { openChapterCarrierView, openTypedCarrierView } from "../../utils/studioBook";
import { logger } from "../../utils/logger";
import { looseBeats, parseBeatExtra, toggleBeatMount, chaptersOfSetting, toggleSettingOnChapter, settingCompleteness } from "../../utils/writingOutline";
import { buildTree, defaultLevels, suggestedChildKind, type TreeNode } from "../../utils/writingTree";
import { t } from "../../i18n";
import { CV } from "./canvasTheme";
import { pureInt, isComplete, buildChapterLanes, computeCoverage, computeTimelineConflicts, beatEventText, beatImported, LANE_COLORS, hashStr, type Lane } from "../../utils/writingTimeline";
import { sortForeshadowings, isOverdue, foreshadowStatusColor, foreshadowStatusLabelKey, FORESHADOW_STATUSES } from "../../utils/writingForeshadowing";
import { foreshadowingFromBeat, beatPlantedAsForeshadowing } from "../../utils/writingInspiration";
import { buildProofreadReport, PROOFREAD_GROUPS, type ProofreadGroup, type ProofreadIssue } from "../../utils/writingProofread";
import { buildChapterWordRows, buildVolumeRows, computeWritingKpis, diffDailyStats, WINDOW_DAYS } from "../../utils/writingStats";
import { StorylineDetail, StorylineNarrativeView, StorylineMatrixView } from "../panels/TimelineSidePanels";
import { ForeshadowingDetail } from "../panels/ForeshadowingPanels";
import { InspirationDetail } from "../panels/InspirationPanels";
import { proofreadGroupLabelKey, proofreadGroupView } from "../panels/ProofreadPanels";
import { ChapterStatusDot } from "../components/ChapterStatusDot";
import { DraftInput } from "../components/DraftInput";

export const NOVEL_ACCENT = "#4A338F";
export const ESSAY_ACCENT = "#0ea5e9";

// ─── 节拍挂载（outline.extra JSON 透传）───
// 解析入口已收拢到 utils/writingOutline（右栏「要素」与编辑区共用同一份，禁止再写第二份）。
type BeatStatus = "todo" | "draft" | "written";

// 节拍拖拽归位的专用 MIME（与章节载体拖出的 application/x-project-entity 区分，
// 章节行只在拖的是节拍时才允许 drop）
export const BEAT_DND_MIME = "application/x-outline-beat";

// 节点拖拽 reparent 的专用 MIME（拖动行首手柄把任意节点挂到另一节点下，串成树）。
export const NODE_DND_MIME = "application/x-outline-node";

// ─── 通用小件（inline style 常量，全部纯 div/input/span） ───
export const paneStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  border: `1px solid ${CV.divider}`,
  borderRadius: 8,
  overflow: "hidden",
  background: CV.paper,
};

export const paneHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  borderBottom: `1px solid ${CV.divider}`,
  flexShrink: 0,
};

export const paneBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  // 预留滚动条槽位：树收起/展开时内容高度突变，滚动条出现/消失会让整列横向偏移
  scrollbarGutter: "stable",
  padding: "6px 8px",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

export function rowStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 6px",
    borderRadius: 6,
    border: `1px solid ${CV.divider}`,
    minWidth: 0,
  };
}

export function tagStyle(accent: string, active: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 9,
    lineHeight: 1,
    padding: "3px 7px",
    borderRadius: 999,
    whiteSpace: "nowrap",
    cursor: "pointer",
    flexShrink: 0,
    border: `1px solid ${active ? accent : `${accent}44`}`,
  };
  return active
    ? { ...base, color: "#fff", background: accent }
    : { ...base, color: accent, background: "transparent" };
}

/** 节拍状态 chip（todo→draft→written 循环，存 extra.status）：给作者进度账 */
export function beatStatusStyle(status: BeatStatus): React.CSSProperties {
  const color = status === "written" ? "#639922" : status === "draft" ? "#BA7517" : "#888780";
  return {
    fontSize: 9,
    lineHeight: 1,
    padding: "2px 7px",
    borderRadius: 999,
    whiteSpace: "nowrap",
    cursor: "pointer",
    flexShrink: 0,
    border: `1px solid ${color}66`,
    color,
    background: "transparent",
  };
}

export const inputStyle: React.CSSProperties = {
  border: "none",
  outline: "none",
  background: "transparent",
  color: CV.text,
  fontSize: 11,
  padding: 0,
  minWidth: 0,
  fontFamily: "inherit",
};

export const delBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: CV.text3,
  fontSize: 11,
  lineHeight: 1,
  padding: "2px 4px",
  cursor: "pointer",
  flexShrink: 0,
};

export function miniBtn(accent: string): React.CSSProperties {
  return {
    border: `1px solid ${accent}55`,
    color: accent,
    background: "transparent",
    borderRadius: 6,
    fontSize: 10,
    padding: "2px 8px",
    cursor: "pointer",
    flexShrink: 0,
    whiteSpace: "nowrap",
  };
}

export function PaneHeader({ label, count, action, onAction }: {
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
        <button type="button" onClick={onAction} style={{ ...miniBtn("#64748b"), marginLeft: "auto" }}>
          {action}
        </button>
      )}
    </div>
  );
}

export function EmptyHint({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 10.5, color: CV.text3, lineHeight: 1.6, padding: "6px 4px" }}>{text}</div>
  );
}

// ─── 人物 / 场景 栏（character 与 worldbuilding 同构，kind 参数化；可编辑） ───
// A+C：每个设定卡现在三件事齐全 ——
//   1) 反向联动：展示该设定出现在哪些章节（chaptersOfSetting，与大纲/检视器同一口径）；
//   2) 从人物侧发起绑定：把该设定挂到未关联章节（toggleSettingOnChapter，与章检视器同一写入口）；
//   3) 编辑档案入口：跳 WritingPage 定位到该设定，复用已做好的档案/关系编辑器。
// 世界观子类型筛选 chip（仅 kind==="worldbuilding" 时渲染；读 worldbuildingProfile.type）
function WbFilterChip({ label, active, accent, onClick }: { label: string; active: boolean; accent: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 11,
        lineHeight: 1.2,
        padding: "3px 9px",
        borderRadius: 999,
        border: `1px solid ${active ? accent : CV.divider}`,
        background: active ? accent : "transparent",
        color: active ? "#fff" : CV.text2,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

export function CastPane({ kind, accent, paneLabel, emptyText, bookId }: {
  kind: "character" | "worldbuilding";
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
    () => settings
      .filter((x) => x.kind === kind && (bookId ? x.bookId === bookId : true))
      .sort((a, b) => a.sortOrder - b.sortOrder),
    [settings, kind, bookId]
  );
  const bookChapters = useMemo(
    () => chapters.filter((c) => (bookId ? c.bookId === bookId : true)),
    [chapters, bookId]
  );

  // 设定完整性筛选（character + worldbuilding 共用，判定走 settingCompleteness，零迁移）
  const [wbTypeFilter, setWbTypeFilter] = useState("");
  const filteredList = useMemo(
    () => {
      if (!wbTypeFilter) return list;
      if (wbTypeFilter === "__incomplete__") {
        return list.filter((s) => !settingCompleteness(kind, s.extra).complete);
      }
      if (kind === "worldbuilding") {
        return list.filter((s) => parseSettingExtra(s.extra).worldbuildingProfile?.type === wbTypeFilter);
      }
      return list;
    },
    [list, kind, wbTypeFilter]
  );

  // 概览（总数 / 待补全数；worldbuilding 额外算子类型计数），零迁移
  const overview = useMemo(() => {
    let incomplete = 0;
    const subtypeCounts: Record<string, number> = {};
    for (const s of list) {
      if (!settingCompleteness(kind, s.extra).complete) incomplete += 1;
      if (kind === "worldbuilding") {
        const p = parseSettingExtra(s.extra).worldbuildingProfile;
        const type = typeof p?.type === "string" && p.type.length > 0 ? p.type : "";
        if (type) subtypeCounts[type] = (subtypeCounts[type] ?? 0) + 1;
      }
    }
    return { total: list.length, incomplete, subtypeCounts };
  }, [list, kind]);

  // 已设置子类型的种类集合（仅 worldbuilding 用于筛选 chip 行，零迁移）
  const wbPresentTypes = useMemo(
    () => (kind === "worldbuilding" ? Object.keys(overview.subtypeCounts) : []),
    [overview, kind]
  );

  const handleAdd = () => {
    const name = kind === "character"
      ? t("writing.newCharacterName", { n: list.length + 1 })
      : t("writing.newWorldbuildingName", { n: list.length + 1 });
    void createSetting(kind, name);
  };

  // 从人物侧把该设定挂到某章（双向闭环）：人物→cast / 场景→scenes。
  // 走 utils/writingOutline.toggleSettingOnChapter —— 与章检视器同一个写入口。
  const bindToChapter = (settingId: string, chapterId: string) => {
    if (!chapterId) return;
    const key = kind === "character" ? "cast" : "scenes";
    const chapter = bookChapters.find((c) => c.id === chapterId);
    void toggleSettingOnChapter(
      { outlines, createOutline, updateOutline },
      chapterId,
      key,
      settingId,
      chapter?.title || t("editor.writing.inspector.beat")
    );
  };

  // 跳到写作台独立窗口并定位到该设定：复用已做好的档案/关系编辑器（与场景栏同一跳转通道）。
  const openProfile = (settingId: string) => {
    void openWritingDesk({ bookId, settingId });
  };

  return (
    <div style={paneStyle}>
      <PaneHeader label={paneLabel} count={list.length} action={t("writingDesign.add")} onAction={handleAdd} />
      {overview.total > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline", padding: "7px 8px 3px", fontSize: 10.5, color: CV.text2, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600, color: CV.text }}>{t("writing.wbOverviewTotal", { n: overview.total })}</span>
          {kind === "worldbuilding" && WORLDBUILDING_TYPE_KEYS.filter((k) => (overview.subtypeCounts[k] ?? 0) > 0).map((k) => (
            <span key={k}>{t(`writing.wbTypeOptions.${k}`)} <b style={{ color: CV.text }}>{overview.subtypeCounts[k]}</b></span>
          ))}
          <span style={{ color: overview.incomplete > 0 ? "#d9822b" : CV.text3 }}>{t("writing.wbIncomplete", { n: overview.incomplete })}</span>
        </div>
      )}
      {list.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "6px 8px", borderBottom: `1px solid ${CV.divider}` }}>
          <WbFilterChip label={t("writing.wbFilterAll")} active={wbTypeFilter === ""} accent={accent} onClick={() => setWbTypeFilter("")} />
          {kind === "worldbuilding" && wbPresentTypes.map((k) => (
            <WbFilterChip key={k} label={t(`writing.wbTypeOptions.${k}`)} active={wbTypeFilter === k} accent={accent} onClick={() => setWbTypeFilter(k)} />
          ))}
          {overview.incomplete > 0 && (
            <WbFilterChip
              label={t("writing.wbIncompleteShort")}
              active={wbTypeFilter === "__incomplete__"}
              accent={accent}
              onClick={() => setWbTypeFilter(wbTypeFilter === "__incomplete__" ? "" : "__incomplete__")}
            />
          )}
        </div>
      )}
      <div style={paneBodyStyle}>
        {filteredList.length === 0 && <EmptyHint text={emptyText} />}
        {filteredList.map((x) => {
          const appearLabel = kind === "character"
            ? t("editor.writing.inspector.appearChapters")
            : t("editor.writing.inspector.relatedChapters");
          const related = chaptersOfSetting(
            outlines,
            bookChapters,
            x.id,
            kind === "character" ? "character" : "worldbuilding"
          );
          const unbound = bookChapters.filter((c) => !related.some((r) => r.id === c.id));
          return (
            <div key={x.id} style={{ ...rowStyle(), flexDirection: "column", alignItems: "stretch", gap: 2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: accent, flexShrink: 0 }} />
                <DraftInput
                  entityKey={x.id}
                  value={x.name}
                  onCommit={(v) => updateSetting(x.id, { name: v })}
                  placeholder={t("writingDesign.namePh")}
                  style={{ ...inputStyle, fontWeight: 600, flex: 1 }}
                />
                <button
                  type="button"
                  title={t("writingDesign.editProfile")}
                  onClick={() => openProfile(x.id)}
                  style={{ ...miniBtn(accent), flexShrink: 0 }}
                >
                  {t("writingDesign.editProfile")}
                </button>
                <button
                  type="button"
                  title={t("writingDesign.viewDetail")}
                  onClick={() => useEditorStore.getState().selectSetting(x.id)}
                  style={{ ...miniBtn(accent), flexShrink: 0 }}
                >
                  {t("writingDesign.viewDetail")}
                </button>
                <button
                  type="button"
                  title={t("writingDesign.deleteIdea")}
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
                placeholder={kind === "character" ? t("writingDesign.identityPh") : t("writingDesign.sceneKindPh")}
                style={{ ...inputStyle, color: CV.text2, paddingLeft: 12 }}
              />
              {/* 反向联动：该设定出现在哪些章节（只读，与大纲/检视器同一口径） */}
              <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap", paddingLeft: 12 }}>
                <span style={{ fontSize: 8.5, color: CV.text3, flexShrink: 0 }}>{appearLabel}</span>
                {related.length === 0 && (
                  <span style={{ fontSize: 9, color: CV.text3 }}>{t("editor.writing.inspector.notAttached")}</span>
                )}
                {related.map((c) => (
                  <span key={c.id} style={tagStyle(accent, true)}>{c.title}</span>
                ))}
              </div>
              {/* 从人物侧发起绑定：挂到未关联章节（双向闭环）。无可选章节时不渲染。 */}
              {unbound.length > 0 && (
                <select
                  value=""
                  title={t("writingDesign.bindChapter")}
                  style={{ ...bindSelectStyle, marginLeft: 12, maxWidth: "100%" }}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) void bindToChapter(x.id, v);
                  }}
                >
                  <option value="">{t("writingDesign.bindChapter")}</option>
                  {unbound.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 节拍行（章节内节拍 / 未落章节拍 共用同一渲染，口径绝不分裂） ───
function BeatRow({
  beat,
  accent,
  characters,
  scenes,
  bindSlot,
  draggable,
  onDragStart,
}: {
  beat: WritingOutline;
  accent: string;
  characters: WritingSetting[];
  scenes: WritingSetting[];
  /** 未落章的节拍额外给「落章」下拉 —— 落章能力只在编辑区有 */
  bindSlot?: React.ReactNode;
  /** 未落章的节拍可拖拽，拖到章节行即归位 */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const updateOutline = useWritingStore((s) => s.updateOutline);
  const deleteOutline = useWritingStore((s) => s.deleteOutline);
  // beat → 时间线草稿导入（骨架关联第一批）：标题行「⇢」按钮，导入后查重置灰
  const createTimelineEvent = useWritingStore((s) => s.createTimelineEvent);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const beatText = beatEventText(beat);
  const beatDone = beatImported(timelineEvents, beatText);
  const importBeat = () => {
    if (!beatDone && beatText) void createTimelineEvent({ chapterId: beat.chapterId, settingId: null, at: "", event: beatText });
  };
  const extra = parseBeatExtra(beat.extra);
  const beatStatus = (parseBeatExtra(beat.extra).status ?? "todo") as BeatStatus;
  const cycleStatus = () => {
    const order: BeatStatus[] = ["todo", "draft", "written"];
    const next = order[(order.indexOf(beatStatus) + 1) % 3];
    void updateOutline(beat.id, { extra: JSON.stringify({ ...extra, status: next }) });
  };

  // 挂载 chips：点击切换 extra.cast / extra.scenes 成员（写口径收拢 utils/writingOutline.toggleBeatMount，
  // 与灵感工作台编辑卡共用同一份，禁写第二份）
  const toggleMount = (key: "cast" | "scenes", settingId: string) => {
    void updateOutline(beat.id, { extra: toggleBeatMount(beat.extra, key, settingId) });
  };

  return (
    <div style={{ ...rowStyle(), flexDirection: "column", alignItems: "stretch", gap: 3, paddingLeft: 12 }} draggable={draggable} onDragStart={onDragStart}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
        <span style={{ fontSize: 8, color: accent, flexShrink: 0 }}>◆</span>
        <DraftInput
          entityKey={beat.id}
          value={beat.title}
          onCommit={(v) => updateOutline(beat.id, { title: v })}
          placeholder={t("writingDesign.beatTitlePh")}
          style={{ ...inputStyle, fontWeight: 600, flex: 1 }}
        />
        {!bindSlot && (
          <span style={beatStatusStyle(beatStatus)} title={t(`writingDesign.beatStatus.${beatStatus}`)} onClick={cycleStatus}>
            {t(`writingDesign.beatStatus.${beatStatus}`)}
          </span>
        )}
        {bindSlot}
        <button
          type="button"
          disabled={beatDone || !beatText}
          title={beatDone ? t("writing.beatInTimeline") : beatText ? t("writing.beatToTimeline") : t("writing.beatToTimelineEmpty")}
          onClick={importBeat}
          style={{ ...delBtnStyle, color: beatDone ? "#10b981" : accent, opacity: beatDone || !beatText ? 0.55 : 1, cursor: beatDone || !beatText ? "default" : "pointer", fontSize: 11 }}
        >
          {beatDone ? "✓" : "⇢"}
        </button>
        <button
          type="button"
          title={t("writingDesign.deleteBeat")}
          onClick={() => void deleteOutline(beat.id)}
          style={delBtnStyle}
        >
          ×
        </button>
      </div>
      <DraftInput
        entityKey={beat.id}
        value={beat.summary}
        onCommit={(v) => updateOutline(beat.id, { summary: v })}
        placeholder={t("writingDesign.beatSummaryPh")}
        style={{ ...inputStyle, color: CV.text2, paddingLeft: 13 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 13 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap" }}>
          <span style={{ fontSize: 8.5, color: CV.text3, flexShrink: 0 }}>{t("writingDesign.mountCast")}</span>
          {characters.length === 0 && <span style={{ fontSize: 9, color: CV.text3 }}>{t("writingDesign.mountEmpty")}</span>}
          {characters.map((c) => (
            <span
              key={c.id}
              style={tagStyle(accent, (extra.cast ?? []).includes(c.id))}
              onClick={() => toggleMount("cast", c.id)}
            >
              {c.name}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap" }}>
          <span style={{ fontSize: 8.5, color: CV.text3, flexShrink: 0 }}>{t("writingDesign.mountScenes")}</span>
          {scenes.length === 0 && <span style={{ fontSize: 9, color: CV.text3 }}>{t("writingDesign.mountEmpty")}</span>}
          {scenes.map((sc) => (
            <span
              key={sc.id}
              style={tagStyle("#64748b", (extra.scenes ?? []).includes(sc.id))}
              onClick={() => toggleMount("scenes", sc.id)}
            >
              {sc.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 未落章节拍的「落章」下拉（零 Emotion：原生 select + inline style） */
const bindSelectStyle: React.CSSProperties = {
  border: `1px solid ${CV.divider}`,
  borderRadius: 4,
  background: "transparent",
  color: CV.text2,
  fontSize: 9.5,
  padding: "1px 2px",
  flexShrink: 0,
  maxWidth: 104,
  fontFamily: "inherit",
};

// ─── 节点状态循环：待写 → 草稿 → 已完（点击状态点）───
// 状态点本体、层级配色与状态文案都已抽到 components/ChapterStatusDot（左栏作品目录树与
// 本视图共用同一枚，禁第二份）。
const NODE_STATUS_CYCLE = ["", "draft", "finished"];

// ─── 鸟瞰条：全书形状（按根节点泛化；卷/部/篇…任意根都聚合其子树进度） ───
function countSubtree(node: TreeNode): { total: number; finished: number; draft: number } {
  let total = 1;
  let finished = node.node.status === "finished" ? 1 : 0;
  let draft = node.node.status === "draft" ? 1 : 0;
  for (const c of node.children) {
    const s = countSubtree(c);
    total += s.total;
    finished += s.finished;
    draft += s.draft;
  }
  return { total, finished, draft };
}

function BirdEyeBar({ roots, outlines }: { roots: TreeNode[]; outlines: WritingOutline[] }) {
  const placed = outlines.filter((o) => o.chapterId);
  const written = placed.filter((o) => (parseBeatExtra(o.extra).status ?? "todo") === "written").length;
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
      <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, color: CV.text2, width: 84, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <div style={{ flex: 1, height: 8, borderRadius: 4, background: "#D3D1C7", display: "flex", overflow: "hidden" }}>
          <div style={{ width: `${finishedPct}%`, background: "#639922" }} />
          <div style={{ width: `${draftPct}%`, background: "#BA7517" }} />
        </div>
        <span style={{ fontSize: 9, color: CV.text3, flexShrink: 0 }}>{finished}/{total}</span>
      </div>
    );
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "2px 2px 6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: CV.text3 }}>{t("writingDesign.birdEye")}</span>
        <span style={{ fontSize: 9.5, color: CV.text3, marginLeft: "auto" }}>
          {t("writingDesign.beatProgress", { w: written, p: placed.length })}
        </span>
      </div>
      {roots.length === 0 && <EmptyHint text={t("writingDesign.emptyOutlineTree")} />}
      {showPerRoot
        ? roots.map((r) => {
            const s = countSubtree(r);
            const label = r.node.kind ? `${r.node.kind} · ${r.node.title}` : r.node.title;
            return bar(r.node.id, label, s.total, s.finished, s.draft);
          })
        : roots.length > 10 && bar("book-total", t("writingDesign.bookTotal"), all.total, all.finished, all.draft)}
    </div>
  );
}

// ─── 递归大纲树节点行（结构树 outliner） ───
// 每行直接操作：拖手柄 reparent / 状态点点击循环 / 层级名行内改 / 标题行内改 /
// 一键加子级（按默认层级顺延）/ 双击标题开写作视图。零配置起步，渐进式自定义。
function NodeRow({ node, levels, accent, characters, scenes, bookId, bookTitle, genre }: {
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
  const setChapterStatus = useWritingStore((s) => s.setChapterStatus);
  const renameChapter = useWritingStore((s) => s.renameChapter);
  const deleteChapter = useWritingStore((s) => s.deleteChapter);
  const createChildNode = useWritingStore((s) => s.createChildNode);
  const createOutline = useWritingStore((s) => s.createOutline);
  const updateOutline = useWritingStore((s) => s.updateOutline);
  const outlines = useWritingStore((s) => s.outlines);
  // 折叠态走 store 内存字段（不落库）：载体卡与 L2 题材编辑面共用同一份展开/收起状态
  const collapsed = useWritingStore((s) => s.collapsedNodeIds.includes(node.node.id));
  const toggleNodeCollapse = useWritingStore((s) => s.toggleNodeCollapse);

  const [editingKind, setEditingKind] = useState(false);
  const [kindDraft, setKindDraft] = useState(node.node.kind);
  // 拖拽 reparent 落点高亮：拖到本行上方时点亮，给「松手即挂到它下面」的明确反馈
  const [overNode, setOverNode] = useState(false);
  // 手柄悬停高亮：手柄太小太灰不好抓，悬停时加深 + 浅底，提示「可拖」
  const [hoverHandle, setHoverHandle] = useState(false);

  const childBeats = useMemo(() => outlines.filter((o) => o.chapterId === node.node.id), [outlines, node.node.id]);
  const childKind = suggestedChildKind(node.node.kind, node.depth, levels);
  const childCount = node.children.length;

  const cycleStatus = () => {
    const cur = node.node.status ?? "";
    const next = NODE_STATUS_CYCLE[(NODE_STATUS_CYCLE.indexOf(cur) + 1) % NODE_STATUS_CYCLE.length];
    void setChapterStatus(node.node.id, next);
  };

  const commitKind = () => {
    setEditingKind(false);
    const v = kindDraft.trim();
    if (v && v !== node.node.kind) void renameNodeKind(node.node.id, v);
    else setKindDraft(node.node.kind);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(BEAT_DND_MIME) || e.dataTransfer.types.includes(NODE_DND_MIME)) {
      e.preventDefault();
      // 只有拖「节点」过来时才点亮本行（提示将嵌套为本节点的子级）
      if (e.dataTransfer.types.includes(NODE_DND_MIME)) setOverNode(true);
    }
  };
  const onDragLeave = (e: React.DragEvent) => {
    // 移出整行（而非滑入内部子元素）才熄灭高亮，避免子元素间移动时闪烁
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverNode(false);
  };
  const onDrop = (e: React.DragEvent) => {
    setOverNode(false);
    const beatId = e.dataTransfer.getData(BEAT_DND_MIME);
    if (beatId) { void updateOutline(beatId, { chapterId: node.node.id }); return; }
    const draggedId = e.dataTransfer.getData(NODE_DND_MIME);
    if (draggedId && draggedId !== node.node.id) void reparentNode(draggedId, node.node.id);
  };

  const open = () => openChapterCarrierView(node.node.id, bookTitle ? `${bookTitle} · ${node.node.title}` : node.node.title, genre, bookId);
  const addBeat = () => {
    const n = childBeats.length + 1;
    void createOutline(t("writingDesign.beatN", { n })).then((o) => { if (o) void updateOutline(o.id, { chapterId: node.node.id }); });
  };

  // 严格按树形深度缩进：每层递进固定步长；INDENT_BASE/STEP 同时供竖向引导线对齐
  const INDENT_BASE = 8;
  const INDENT_STEP = 20;
  const indent = INDENT_BASE + node.depth * INDENT_STEP;

  return (
    <div style={{ position: "relative" }}>
      {/* 竖向树引导线：每个祖先层一条竖线，贯穿整棵子树；末层再加一条从父线连到本节点的横钩（elbow），
          把「章挂在卷下」的从属关系画成看得见的分支（深层从属关系一眼可读） */}
      {Array.from({ length: node.depth }).map((_, i) => (
        <span
          key={`v${i}`}
          style={{ position: "absolute", left: INDENT_BASE + i * INDENT_STEP + INDENT_STEP / 2, top: 0, bottom: 0, width: 1, background: CV.divider, pointerEvents: "none" }}
        />
      ))}
      {node.depth >= 1 && (
        <span
          key="elbow"
          style={{ position: "absolute", left: INDENT_BASE + (node.depth - 1) * INDENT_STEP + INDENT_STEP / 2, top: 11, width: INDENT_STEP / 2, height: 1, background: CV.divider, pointerEvents: "none" }}
        />
      )}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 5,
          // 注意 ${indent} 后必须带 px：数字模板插值不会自动加单位，
          // "3px 4px 3px 28" 是非法 CSS 会被整个丢弃（这正是缩进一直不生效的根因）
          padding: `3px 4px 3px ${indent}px`, borderRadius: 6,
          border: `1px solid ${overNode ? accent : CV.divider}`,
          background: overNode ? `${accent}14` : "transparent",
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* 拖动手柄：把本节点挂到别的节点下（reparent），串成任意深树。
            加大加深 + 悬停高亮，专治「太小太灰不好抓」。 */}
        <span
          draggable
          onDragStart={(e) => { e.dataTransfer.setData(NODE_DND_MIME, node.node.id); e.dataTransfer.effectAllowed = "move"; }}
          onMouseEnter={() => setHoverHandle(true)}
          onMouseLeave={() => setHoverHandle(false)}
          title={t("writingDesign.dropToNest")}
          style={{
            cursor: "grab",
            color: hoverHandle ? CV.text : CV.text2,
            fontSize: 13, lineHeight: 1, flexShrink: 0, userSelect: "none",
            padding: "2px 3px", borderRadius: 4,
            background: hoverHandle ? `${accent}14` : "transparent",
          }}
        >⠿</span>
        {/* 单点：色=层级（父级墨紫 / 子级天蓝），填充=进度（空心待写 / 半透草稿 / 实心已完）；点击循环状态 */}
        <ChapterStatusDot status={node.node.status} depth={node.depth} onClick={cycleStatus} />
        {/* 层级名徽章：点击行内改名（部/卷/章/节/幕/场…，创作者自填） */}
        {editingKind ? (
          <input
            autoFocus
            value={kindDraft}
            onChange={(e) => setKindDraft(e.target.value)}
            onBlur={commitKind}
            onKeyDown={(e) => { if (e.key === "Enter") commitKind(); if (e.key === "Escape") { setKindDraft(node.node.kind); setEditingKind(false); } }}
            placeholder={t("writingDesign.kindPh")}
            style={{ ...inputStyle, width: 46, fontWeight: 600, color: accent, flexShrink: 0 }}
          />
        ) : (
          <span
            onClick={() => { setKindDraft(node.node.kind); setEditingKind(true); }}
            title={t("writingDesign.kindPh")}
            style={{ fontSize: 9, lineHeight: 1, padding: "2px 6px", borderRadius: 999, border: `1px solid ${accent}55`, color: accent, background: "transparent", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
          >
            {node.node.kind || "—"}
          </span>
        )}
        {/* 标题：行内改名；双击开写作视图 */}
        <DraftInput
          entityKey={node.node.id}
          value={node.node.title}
          onCommit={(v) => renameChapter(node.node.id, v)}
          onDoubleClick={open}
          placeholder={t("writingDesign.beatTitlePh")}
          title={t("writingDesign.openHint")}
          style={{ ...inputStyle, fontWeight: 600, flex: 1, minWidth: 0 }}
        />
        <span style={{ fontSize: 9, color: CV.text3, flexShrink: 0 }}>{t("writing.words", { n: node.node.wordCount })}</span>
        {/* 一键加子级：默认层级顺延（卷→章→节…），作者随时改名越级 */}
        <button type="button" onClick={() => void createChildNode(node.node.id, childKind, `${childKind} ${childCount + 1}`)} style={{ ...miniBtn(accent), flexShrink: 0 }}>
          {t("writingDesign.addChild")}
        </button>
        {/* 节拍：挂在本节点的规划 */}
        <button type="button" onClick={addBeat} title={t("writingDesign.addBeat")} style={{ ...delBtnStyle, flexShrink: 0 }}>＋</button>
        <button type="button" onClick={() => void deleteChapter(node.node.id)} title={t("writingDesign.deleteNode")} style={{ ...delBtnStyle, flexShrink: 0 }}>×</button>
        {/* 展开/收起：放**行尾**。下面有东西（子级或节拍）才出现——节拍也归这个尖角管，
            收起 = 子级和节拍一起藏。与 ＋/× 同款同尺寸（delBtnStyle，15px 盒高）；尖角是
            固定几何 SVG，收起 = 同一图形旋转 -90°，盒子尺寸天生恒定，切换零偏移 */}
        {(childCount > 0 || childBeats.length > 0) && (
          <button
            type="button"
            onClick={() => toggleNodeCollapse(node.node.id)}
            title={collapsed ? t("writingDesign.expandNode") : t("writingDesign.collapseNode")}
            style={{ ...delBtnStyle, display: "inline-flex", alignItems: "center", justifyContent: "center", height: 15 }}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" style={{ flexShrink: 0, transform: collapsed ? "translateY(1px) rotate(-90deg)" : "translateY(1px)", transition: "transform 100ms ease" }}>
              <path d="M2.6 3.4 L5 6.2 L7.4 3.4" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      {/* 本节点绑定的节拍（规划/纲）：跟随节点折叠——收起时与子级一起藏 */}
      {!collapsed && childBeats.length > 0 && (
        <div style={{ paddingLeft: indent + 14 }}>
          {childBeats.map((b) => (
            <BeatRow key={b.id} beat={b} accent={accent} characters={characters} scenes={scenes} />
          ))}
        </div>
      )}
      {/* 递归子节点（收起时整棵子树隐藏；节拍是本节点自己的规划，保留可见） */}
      {!collapsed && node.children.map((c) => (
        <NodeRow key={c.node.id} node={c} levels={levels} accent={accent} characters={characters} scenes={scenes} bookId={bookId} bookTitle={bookTitle} genre={genre} />
      ))}
    </div>
  );
}

// ─── 小说：主线栏（递归大纲树 + capture-first 灵感箱） ───

// 剧情线管理面（「剧情线」L2 页签的编辑面）：线实体一览 + 新建/删线/跳时间线剧情线轴。
// 此前 storylines 页签不在 STUDIO_PANE_BY_KIND 表内 → 点开是空画布（真实缺陷，2026-09-18 修）。
export function StorylinesPane({ accent, bookId }: { accent: string; bookId: string }) {
  const bookTitle = useWritingStore((s) => s.books.find((b) => b.id === s.activeBookId)?.title) ?? "";
  const storylines = useWritingStore((s) => s.storylines);
  const selectedStorylineId = useEditorStore((s) => s.selectedStorylineId);
  const selected = selectedStorylineId ? storylines.find((sl) => sl.id === selectedStorylineId) ?? null : null;
  // P2 视角切换（2026-09-19 / 2026-09-21）：manage=管理卡（编辑面）；narrative=线-事件叙事视角
  // （单线纵向事件链，纯阅读）；matrix=线×章交织总览（跨线横览，纯阅读，点格跳章）。
  // 视角面板不做编辑（编辑面唯一铁律）。
  const [paneMode, setPaneMode] = useState<"manage" | "narrative" | "matrix">("manage");
  const pillSx = (active: boolean) =>
    ({
      cursor: "pointer", fontSize: 10, fontWeight: 700, px: 1, py: "2px 8px", borderRadius: 3,
      border: `1px solid ${active ? accent : CV.divider}`,
      background: active ? `${accent}14` : "transparent",
      color: active ? accent : CV.text3,
    }) as const;
  return (
    <div style={{ ...paneStyle, borderColor: "transparent" }}>
      <PaneHeader label={t("writing.viewKind.storylines")} count={storylines.length} />
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <button type="button" style={pillSx(paneMode === "manage")} onClick={() => setPaneMode("manage")}>
          {t("writing.storylineViewManage")}
        </button>
        <button type="button" style={pillSx(paneMode === "narrative")} onClick={() => setPaneMode("narrative")}>
          {t("writing.storylineViewNarrative")}
        </button>
        <button type="button" style={pillSx(paneMode === "matrix")} onClick={() => setPaneMode("matrix")}>
          {t("writing.storylineViewMatrix")}
        </button>
      </div>
      {/* 两栏就地编辑：左线行表（点行选中，不跳走）+ 右侧编辑卡（名/色板/描述/线内事件/联动）。
          编辑能力复用右栏同款 StorylineDetail，两处共享一份不写第二份。 */}
      <div style={{ display: "flex", gap: 8, flex: 1, minHeight: 0, alignItems: "stretch" }}>
        <div style={{ width: 232, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          <StorylineSection accent={accent} bookId={bookId} embed="pane" />
          {bookTitle && <span style={{ fontSize: 9.5, color: CV.text3 }}>{bookTitle}</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0, overflowY: "auto", border: `1px solid ${CV.divider}`, borderRadius: 8, background: CV.paper }}>
          {paneMode === "matrix" ? (
            /* 交织总览不需要选中线：跨线横览正是未选中态的主价值 */
            <StorylineMatrixView accent={accent} bookId={bookId} />
          ) : !selected ? (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
              <EmptyHint text={t("writing.storylineNarrativePick")} />
            </div>
          ) : paneMode === "narrative" ? (
            <StorylineNarrativeView key={selected.id} storyline={selected} bookId={bookId} />
          ) : (
            <StorylineDetail key={selected.id} storyline={selected} bookId={bookId} />
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
  const loadForeshadowings = useWritingStore((s) => s.loadForeshadowings);
  const createForeshadowing = useWritingStore((s) => s.createForeshadowing);
  const selectedForeshadowingId = useEditorStore((s) => s.selectedForeshadowingId);
  const selected = selectedForeshadowingId ? foreshadowings.find((f) => f.id === selectedForeshadowingId) ?? null : null;
  // 装载补齐：本 pane 可能先于其它入口挂载。
  useEffect(() => {
    const ws = useWritingStore.getState();
    if (ws.activeBookId && ws.foreshadowings.length === 0) void ws.loadForeshadowings().catch(() => {});
  }, [loadForeshadowings]);
  const sorted = useMemo(() => sortForeshadowings(foreshadowings, chapters), [foreshadowings, chapters]);

  const handleCreate = async () => {
    const item = await createForeshadowing(t("writing.foreshadowDefaultName", { n: foreshadowings.length + 1 }));
    if (item) useEditorStore.getState().selectForeshadowing(item.id);
  };

  return (
    <div style={{ ...paneStyle, borderColor: "transparent" }}>
      <PaneHeader label={t("writing.viewKind.foreshadowing")} count={foreshadowings.length} />
      <div style={{ display: "flex", gap: 8, flex: 1, minHeight: 0, alignItems: "stretch" }}>
        {/* 左：状态分组行表 */}
        <div style={{ width: 232, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ border: `1px solid ${CV.divider}`, borderRadius: 8, background: CV.paper, padding: "6px 8px", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: foreshadowings.length > 0 ? 5 : 0 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: CV.text3 }}>{t("writing.viewKind.foreshadowing")}</span>
              <span style={{ fontSize: 9, color: CV.text3 }}>{foreshadowings.length}</span>
              <button
                type="button"
                onClick={() => void handleCreate()}
                title={t("writing.foreshadowCreate")}
                style={{ ...miniBtn(accent), marginLeft: "auto", fontSize: 9.5, padding: "1px 8px" }}
              >
                ＋ {t("writing.foreshadowCreate")}
              </button>
            </div>
            {foreshadowings.length === 0 ? (
              <EmptyHint text={t("writing.foreshadowEmptyHint")} />
            ) : (
              FORESHADOW_STATUSES.map((st) => {
                const group = sorted.filter((f) => f.status === st);
                if (group.length === 0) return null;
                return (
                  <div key={st} style={{ marginBottom: 4 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: foreshadowStatusColor(st), margin: "4px 0 2px" }}>
                      {t(foreshadowStatusLabelKey(st))} · {group.length}
                    </div>
                    {group.map((f) => {
                      const active = selectedForeshadowingId === f.id;
                      const overdue = isOverdue(f, chapters);
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => useEditorStore.getState().selectForeshadowing(f.id)}
                          title={t("writing.foreshadowSelect")}
                          style={{
                            display: "flex", alignItems: "center", gap: 5, width: "100%", textAlign: "left",
                            padding: "2px 4px", borderRadius: 4, border: "none", cursor: "pointer", minWidth: 0,
                            background: active ? "rgba(25,118,210,0.08)" : "transparent",
                            boxShadow: active ? `inset 0 0 0 1px ${accent}` : "none",
                          }}
                        >
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: foreshadowStatusColor(f.status), flexShrink: 0 }} />
                          <span style={{ fontSize: 11, fontWeight: 700, color: CV.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                            {f.title || t("writing.foreshadowUntitled")}
                          </span>
                          {overdue && <span style={{ fontSize: 10, color: "#b45309", flexShrink: 0 }} title={t("writing.foreshadowOverdueTitle")}>⚠</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
          <span style={{ fontSize: 9.5, color: CV.text3 }}>
            {useWritingStore.getState().books.find((b) => b.id === bookId)?.title ?? ""}
          </span>
        </div>
        {/* 右：编辑卡（复用右栏同款） */}
        <div style={{ flex: 1, minWidth: 0, overflowY: "auto", border: `1px solid ${CV.divider}`, borderRadius: 8, background: CV.paper }}>
          {selected ? (
            <ForeshadowingDetail key={selected.id} item={selected} bookId={bookId} />
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
              <EmptyHint text={t("writing.foreshadowPaneEditHint")} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 灵感 pane（灵感页签编辑面）：念头池 = 未落章 beat（loose beats，零新表） ───
// 与大纲页签「记个念头」/ 散文 IdeasPane 同池不分裂；本 pane 是念头的工作台升级：
// 左 = 零阻力速记输入（回车即建并选中）+ 念头行表（已转灰标派生自查重口径）；
// 右 = 编辑与分发卡（⇢转时间线草稿 / 挂章转正 / ⇢转伏笔草稿 / 删除）。
export function InspirationsPane({ accent, bookId }: { accent: string; bookId: string }) {
  const outlines = useWritingStore((s) => s.outlines);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const settings = useWritingStore((s) => s.settings);
  const createOutline = useWritingStore((s) => s.createOutline);
  const selectedInspirationId = useEditorStore((s) => s.selectedInspirationId);
  const selected = selectedInspirationId ? outlines.find((o) => o.id === selectedInspirationId) ?? null : null;
  const characters = useMemo(() => settings.filter((s) => s.kind === "character"), [settings]);
  const scenes = useMemo(() => settings.filter((s) => s.kind === "worldbuilding"), [settings]);
  // 零阻力速记：进页签光标即在输入框（capture-first）；回车落池后焦点回到输入框，
  // 连续记多条不断流（右卡标题 autoFocus 会抢焦点，这里显式抢回来）。
  const [capture, setCapture] = useState("");
  const [captureFocus, setCaptureFocus] = useState(false);
  const captureRef = useRef<HTMLInputElement>(null);

  const loose = useMemo(() => looseBeats(outlines), [outlines]);

  const handleCapture = async () => {
    const text = capture.trim();
    if (!text) return;
    const item = await createOutline(text);
    setCapture("");
    if (item) useEditorStore.getState().selectInspiration(item.id);
    captureRef.current?.focus();
  };

  return (
    <div style={{ ...paneStyle, borderColor: "transparent" }}>
      <PaneHeader label={t("writing.viewKind.inspiration")} count={loose.length} />
      <div style={{ display: "flex", gap: 8, flex: 1, minHeight: 0, alignItems: "stretch" }}>
        {/* 左：速记输入 + 念头行表 */}
        <div style={{ width: 232, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ border: `1px solid ${CV.divider}`, borderRadius: 8, background: CV.paper, padding: "6px 8px", flexShrink: 0 }}>
            <input
              ref={captureRef}
              autoFocus
              value={capture}
              onChange={(e) => setCapture(e.target.value)}
              onFocus={() => setCaptureFocus(true)}
              onBlur={() => setCaptureFocus(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) void handleCapture();
              }}
              placeholder={t("writing.inspirationCapturePh")}
              style={{
                ...inputStyle, width: "100%", boxSizing: "border-box",
                border: `1px solid ${captureFocus ? accent : CV.divider}`,
                borderRadius: 6, background: "rgba(127,127,127,0.07)",
                padding: "5px 8px", fontSize: 12,
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
              <span style={{ fontSize: 9, color: CV.text3 }}>{t("writing.inspirationPoolLabel")}</span>
              <span style={{ fontSize: 9, color: CV.text3 }}>{loose.length}</span>
            </div>
            {loose.length === 0 ? (
              <EmptyHint text={t("writing.inspirationEmptyHint")} />
            ) : (
              loose.map((b) => {
                const active = selectedInspirationId === b.id;
                const inTimeline = beatImported(timelineEvents, beatEventText(b));
                const inForeshadow = beatPlantedAsForeshadowing(foreshadowings, b);
                const dispatched = inTimeline || inForeshadow;
                // 挂载摘要（联动刀三）：这条念头挂了哪些人物/场景，一眼看出它跟谁有关
                const ex = parseBeatExtra(b.extra);
                const mounted = [
                  ...(ex.cast ?? []).map((id) => characters.find((c) => c.id === id)?.name),
                  ...(ex.scenes ?? []).map((id) => scenes.find((c) => c.id === id)?.name),
                ].filter((n): n is string => !!n);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => useEditorStore.getState().selectInspiration(b.id)}
                    title={t("writing.inspirationSelect")}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "stretch", gap: 1, width: "100%", textAlign: "left",
                      padding: "2px 4px", borderRadius: 4, border: "none", cursor: "pointer", minWidth: 0,
                      background: active ? "rgba(25,118,210,0.08)" : "transparent",
                      boxShadow: active ? `inset 0 0 0 1px ${accent}` : "none",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                      <span style={{ fontSize: 8, color: accent, flexShrink: 0 }}>◆</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: dispatched ? CV.text3 : CV.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                        {b.title || b.summary || t("writing.inspirationUntitled")}
                      </span>
                      {inTimeline && <span style={{ fontSize: 9, color: CV.text3, flexShrink: 0 }}>✓</span>}
                      {inForeshadow && <span style={{ fontSize: 9, color: CV.text3, flexShrink: 0 }}>✦</span>}
                    </span>
                    {mounted.length > 0 && (
                      <span style={{ fontSize: 8.5, color: CV.text3, paddingLeft: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {mounted.join(" · ")}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          <span style={{ fontSize: 9.5, color: CV.text3 }}>
            {useWritingStore.getState().books.find((b) => b.id === bookId)?.title ?? ""}
          </span>
        </div>
        {/* 右：编辑与分发卡（复用右栏同款，key 重挂） */}
        <div style={{ flex: 1, minWidth: 0, overflowY: "auto", border: `1px solid ${CV.divider}`, borderRadius: 8, background: CV.paper }}>
          {selected ? (
            <InspirationDetail key={selected.id} beat={selected} />
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
              <EmptyHint text={t("writing.inspirationPaneEditHint")} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 校对 pane（校对页签编辑面）：全书体检发现清单（纯本地派生，零新表） ───
// 六组维度（章文本/章账/伏笔/时间线/剧情线/念头池），算法收拢 utils/writingProofread
// （与右栏总览卡同一份）。发现**即点即跳**：章→开章写作视图、伏笔→伏笔页签选中、
// 时间线事件→时间线选中、念头→灵感选中、汇总行→对应页签。
export function ProofreadPane({ accent, bookId }: { accent: string; bookId: string }) {
  const chapters = useWritingStore((s) => s.chapters);
  const outlines = useWritingStore((s) => s.outlines);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const storylines = useWritingStore((s) => s.storylines);
  const books = useWritingStore((s) => s.books);
  const genre = books.find((b) => b.id === bookId)?.genre ?? "";
  const report = useMemo(
    () => buildProofreadReport(chapters, outlines, timelineEvents, foreshadowings, storylines),
    [chapters, outlines, timelineEvents, foreshadowings, storylines],
  );
  const [activeGroup, setActiveGroup] = useState<ProofreadGroup>("chapter-text");
  const groupIssues = useMemo(() => report.issues.filter((i) => i.group === activeGroup), [report, activeGroup]);

  /** 发现即点即跳（renderable ≠ useful：每条发现都必须可行动） */
  const jumpIssue = (issue: ProofreadIssue) => {
    try {
      const tg = issue.target;
      if (!tg) return;
      const es = useEditorStore.getState();
      if (tg.type === "chapter") {
        if (!bookId) return; // openChapterCarrierView 需要有效 bookId
        const ch = chapters.find((c) => c.id === tg.id);
        openChapterCarrierView(tg.id, ch?.title ?? "", genre, bookId);
      } else if (tg.type === "foreshadowing") {
        es.selectForeshadowing(tg.id);
        openTypedCarrierView(genre, "foreshadowing");
      } else if (tg.type === "timeline-event") {
        es.selectTimelineEvent(tg.id);
        openTypedCarrierView(genre, "timeline");
      } else if (tg.type === "idea") {
        es.selectInspiration(tg.id);
        openTypedCarrierView(genre, "inspiration");
      } else {
        openTypedCarrierView(genre, tg.id);
      }
    } catch (e) {
      logger.warn("ProofreadPane", "jumpIssue failed", { key: issue.key, error: String(e) });
    }
  };

  return (
    <div style={{ ...paneStyle, borderColor: "transparent" }}>
      <PaneHeader label={t("writing.viewKind.proofread")} count={report.issues.length} />
      <div style={{ display: "flex", gap: 8, flex: 1, minHeight: 0, alignItems: "stretch" }}>
        {/* 左：六组维度导航 */}
        <div style={{ width: 200, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ border: `1px solid ${CV.divider}`, borderRadius: 8, background: CV.paper, padding: "6px 8px", flexShrink: 0 }}>
            {PROOFREAD_GROUPS.map((g) => {
              const n = report.counts[g];
              const active = activeGroup === g;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setActiveGroup(g)}
                  title={t("writing.proofreadGroupSwitch")}
                  style={{
                    display: "flex", alignItems: "center", gap: 5, width: "100%", textAlign: "left",
                    padding: "4px 6px", borderRadius: 4, border: "none", cursor: "pointer", minWidth: 0,
                    background: active ? "rgba(25,118,210,0.08)" : "transparent",
                    boxShadow: active ? `inset 0 0 0 1px ${accent}` : "none",
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: n > 0 ? CV.text : CV.text3, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t(proofreadGroupLabelKey(g))}
                  </span>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: n > 0 ? "#b45309" : CV.text3, flexShrink: 0 }}>
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: 9.5, color: CV.text3 }}>
            {useWritingStore.getState().books.find((b) => b.id === bookId)?.title ?? ""}
          </span>
          {/* 骨架互联（P1-B）：校对 ←→ 统计双向打通——此处跳统计视角看体量分布 */}
          <button
            type="button"
            onClick={() => {
              try {
                openTypedCarrierView(genre, "stats");
              } catch (e) {
                logger.warn("ProofreadPane", "goStats failed", { error: String(e) });
              }
            }}
            title={t("writing.proofreadGoStats")}
            style={{ ...miniBtn(accent), fontSize: 9.5, padding: "2px 8px", width: "fit-content" }}
          >
            {t("writing.proofreadGoStats")}
          </button>
        </div>
        {/* 右：选中维度的发现明细（行可点即跳） */}
        <div style={{ flex: 1, minWidth: 0, overflowY: "auto", border: `1px solid ${CV.divider}`, borderRadius: 8, background: CV.paper, padding: "6px 8px" }}>
          {groupIssues.length === 0 ? (
            <EmptyHint text={t("writing.proofreadPaneEmpty")} />
          ) : (
            groupIssues.map((issue) => {
              const jumpable = !!issue.target;
              return (
                <button
                  key={issue.key}
                  type="button"
                  onClick={() => jumpIssue(issue)}
                  title={jumpable ? t("writing.proofreadJump") : undefined}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left",
                    padding: "4px 6px", borderRadius: 4, border: "none", cursor: jumpable ? "pointer" : "default", minWidth: 0,
                    background: "transparent",
                  }}
                >
                  <span style={{ fontSize: 9, color: "#b45309", flexShrink: 0 }}>⚑</span>
                  <span style={{ fontSize: 11.5, color: CV.text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t(`writing.proofreadIssue.${issue.messageKey}`, issue.args)}
                  </span>
                  {jumpable && <span style={{ fontSize: 10, color: accent, flexShrink: 0 }}>⇢</span>}
                </button>
              );
            })
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
  const volRows = useMemo(() => buildVolumeRows(bookChapters), [bookChapters]);
  const chRows = useMemo(() => buildChapterWordRows(bookChapters), [bookChapters]);

  // 日更快照（Rust 落库）：开面板/切书拉一次；写章落库即出新快照，切出再进即刷新
  const [stats, setStats] = useState<WritingDailyStat[] | null>(null);
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    setStats(null);
    writingStatsApi
      .listDailyStats(bookId, WINDOW_DAYS + 1)
      .then((rows) => { if (!cancelled) setStats(rows); })
      .catch((e) => {
        logger.warn("StatsPane", "load daily stats failed", { bookId, error: String(e) });
        if (!cancelled) setStats([]);
      });
    return () => { cancelled = true; };
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
      void setDailyGoal(bookId, n).catch((e) => logger.warn("StatsPane", "setDailyGoal failed", { bookId, error: String(e) }));
    }
    setGoalInput(null);
  };

  // 卷行展开：点卷行展开该卷章节明细（本地 state，单开）
  const [expandedVol, setExpandedVol] = useState<string | null>(null);
  const jumpChapter = (chId: string, title: string) => {
    try {
      openChapterCarrierView(chId, title, book?.genre ?? "", bookId);
    } catch (e) {
      logger.warn("StatsPane", "jumpChapter failed", { chId, error: String(e) });
    }
  };

  // 骨架互联（P1-B）：统计发现 → 校对体检（校对面四段式 jumpIssue 已支持章定位）
  const goProofread = () => {
    try {
      openTypedCarrierView(book?.genre ?? "", "proofread");
    } catch (e) {
      logger.warn("StatsPane", "goProofread failed", { error: String(e) });
    }
  };

  const sectionStyle: React.CSSProperties = { border: `1px solid ${CV.divider}`, borderRadius: 8, background: CV.paper, padding: "8px 10px", flexShrink: 0 };
  const sectionTitleStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: CV.text3, marginBottom: 6 };

  return (
    <div style={paneStyle}>
      <PaneHeader label={t("writing.viewKind.stats")} count={bookChapters.length} />
      {bookChapters.length === 0 ? (
        <div style={paneBodyStyle}>
          <EmptyHint text={t("writing.statsPaneEmpty")} />
        </div>
      ) : (
        <div style={{ ...paneBodyStyle, gap: 10 }}>
          {/* KPI 行：一行读完这本书「有多少」 */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
            {[
              { label: t("writing.totalWords"), value: kpis.totalWords.toLocaleString(), sub: t("editor.writing.stats.kpiWordsSub") },
              { label: t("writing.chapterCount"), value: String(kpis.chapterCount), sub: t("editor.writing.stats.kpiChaptersSub") },
              { label: t("editor.writing.stats.kpiVolumes"), value: String(kpis.volumeCount), sub: t("editor.writing.stats.kpiVolumesSub") },
              { label: t("editor.writing.stats.kpiSettings"), value: String(kpis.settingCount), sub: t("editor.writing.stats.kpiSettingsSub") },
              { label: t("editor.writing.stats.kpiAvg"), value: String(kpis.avgWords), sub: t("editor.writing.stats.kpiAvgSub") },
            ].map((k) => (
              <div key={k.label} style={{ flex: 1, minWidth: 110, border: `1px solid ${CV.divider}`, borderRadius: 8, padding: "6px 10px" }}>
                <div style={{ fontSize: 10, color: CV.text3 }}>{k.label}</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: CV.text }}>{k.value}</div>
                <div style={{ fontSize: 9, color: CV.text3 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* 日更趋势：目标进度 + 30 天新增条形（快照差分，算法 utils/writingStats） */}
          <div style={sectionStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={sectionTitleStyle}>{t("writing.dailyTrend")} · {totalDelta.toLocaleString()}</span>
              <span style={{ fontSize: 10, color: CV.text3 }}>
                {t("writing.todayProgress", { n: todayDelta.toLocaleString() })}
                {dailyGoal > 0 && (
                  <span style={{ fontWeight: 700, color: goalPct >= 100 ? "#2e7d32" : CV.text3 }}>
                    {" "}· {goalPct}%{goalPct >= 100 ? ` ${t("writing.goalReached")}` : ""}
                  </span>
                )}
              </span>
              <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: CV.text3 }}>{t("writing.dailyGoal")}</span>
                <input
                  type="number"
                  value={goalInput ?? (dailyGoal > 0 ? String(dailyGoal) : "")}
                  placeholder="0"
                  onChange={(e) => setGoalInput(e.target.value)}
                  onBlur={commitGoal}
                  onKeyDown={(e) => { if (e.key === "Enter") commitGoal(); }}
                  style={{ width: 72, fontSize: 11, padding: "2px 6px", border: `1px solid ${CV.divider}`, borderRadius: 4, background: "transparent", color: CV.text, textAlign: "right" }}
                />
                <span style={{ fontSize: 9, color: CV.text3 }}>{t("writing.goalUnit")}</span>
              </span>
            </div>
            {dailyGoal > 0 && (
              <div style={{ height: 5, borderRadius: 3, background: CV.divider, marginBottom: 8, overflow: "hidden" }}>
                <div style={{ width: `${goalPct}%`, height: "100%", borderRadius: 3, background: goalPct >= 100 ? "#2e7d32" : accent }} />
              </div>
            )}
            {stats !== null && deltas.some((d) => d.delta > 0) && (
              <>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 72, borderBottom: `1px solid ${CV.divider}` }}>
                  {deltas.map((d) => (
                    <span
                      key={d.day}
                      title={`${d.day} · +${d.delta.toLocaleString()}`}
                      style={{
                        flex: 1,
                        minWidth: 2,
                        height: `${Math.max(d.delta > 0 ? 5 : 0, (d.delta / maxDelta) * 100)}%`,
                        background: d.delta > 0 ? accent : "transparent",
                        borderRadius: "2px 2px 0 0",
                      }}
                    />
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                  <span style={{ fontSize: 9, color: CV.text3 }}>{deltas[0]?.day}</span>
                  <span style={{ fontSize: 9, color: CV.text3 }}>{deltas[deltas.length - 1]?.day}</span>
                </div>
              </>
            )}
            {stats !== null && !deltas.some((d) => d.delta > 0) && (
              <div style={{ fontSize: 10, color: CV.text3, textAlign: "center", padding: "10px 0" }}>{t("writing.noStats")}</div>
            )}
          </div>

          {/* 卷分布：点卷行展开该卷章节明细（明细行可点跳章） */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{t("writing.statsBandVolume")}</div>
            {volRows.map((v) => (
              <div key={v.volume || "__uncat__"}>
                <button
                  type="button"
                  onClick={() => setExpandedVol(expandedVol === (v.volume || "__uncat__") ? null : (v.volume || "__uncat__"))}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "3px 4px", border: "none", background: "transparent", cursor: "pointer", borderRadius: 4, minWidth: 0 }}
                >
                  <span style={{ fontSize: 11.5, color: CV.text, width: 120, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {v.volume || t("writing.statsUncategorized")}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, height: 8, borderRadius: 4, background: CV.divider, overflow: "hidden" }}>
                    <span style={{ display: "block", width: `${kpis.maxVolumeWords > 0 ? Math.max(2, (v.words / kpis.maxVolumeWords) * 100) : 0}%`, height: "100%", borderRadius: 4, background: accent }} />
                  </span>
                  <span style={{ fontSize: 10, color: CV.text3, flexShrink: 0 }}>
                    {t("editor.writing.stats.finishedOf", { done: v.finished, total: v.chapters })} · {v.words.toLocaleString()}
                  </span>
                  <span style={{ fontSize: 9, color: CV.text3, flexShrink: 0 }}>{expandedVol === (v.volume || "__uncat__") ? "▾" : "▸"}</span>
                </button>
                {expandedVol === (v.volume || "__uncat__") && (
                  <div style={{ paddingLeft: 16, paddingBottom: 4 }}>
                    {chRows.filter((r) => (r.volume || "") === v.volume).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => jumpChapter(r.id, r.title)}
                        title={t("writing.statsJumpChapter")}
                        style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", padding: "2px 4px", border: "none", background: "transparent", cursor: "pointer", borderRadius: 4, minWidth: 0 }}
                      >
                        <span style={{ fontSize: 10.5, color: CV.text3, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                        <span style={{ fontSize: 10, color: CV.text3, flexShrink: 0 }}>{r.words.toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 章节体量：离群标注（advisory 软提示），点行跳章 */}
          <div style={sectionStyle}>
            <div style={{ ...sectionTitleStyle, display: "flex", alignItems: "center", gap: 8 }}>
              <span>{t("writing.statsBandChapterSize")}</span>
              <span style={{ fontSize: 9, fontWeight: 400, color: CV.text3 }}>{t("writing.statsOutlierLegend")}</span>
            </div>
            {chRows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => jumpChapter(r.id, r.title)}
                title={t("writing.statsJumpChapter")}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "3px 4px", border: "none", background: "transparent", cursor: "pointer", borderRadius: 4, minWidth: 0 }}
              >
                <span style={{ fontSize: 11, color: CV.text, width: 160, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                {r.outlier && (
                  <>
                    <span style={{ fontSize: 9, fontWeight: 700, color: "#b45309", flexShrink: 0 }}>
                      {r.outlier === "long" ? t("writing.statsOutlierLong") : t("writing.statsOutlierShort")}
                    </span>
                    {/* 骨架互联（P1-B）：离群发现一键进校对体检，不再止步于「知道」 */}
                    <span
                      onClick={(e) => { e.stopPropagation(); goProofread(); }}
                      title={t("writing.statsGoProofread")}
                      style={{ fontSize: 9, color: accent, flexShrink: 0, cursor: "pointer" }}
                    >
                      {t("writing.statsGoProofread")}
                    </span>
                  </>
                )}
                <span style={{ flex: 1, minWidth: 0, height: 8, borderRadius: 4, background: CV.divider, overflow: "hidden" }}>
                  <span style={{ display: "block", width: `${kpis.maxChapterWords > 0 ? Math.max(2, (r.words / kpis.maxChapterWords) * 100) : 0}%`, height: "100%", borderRadius: 4, background: r.outlier ? "#b45309" : accent }} />
                </span>
                <span style={{ fontSize: 10, color: CV.text3, width: 64, textAlign: "right", flexShrink: 0 }}>{r.words.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 剧情线实体区（P1 整合）：一行一线（色点/名/事件数），点行**选中**该线——
// 页签语境（embed="pane"）就地联动右侧编辑卡；时间线语境（embed="timeline"）选中并切到剧情线轴。
// 新建动线闭环：建线后自动选中新线（编辑卡直入改名），不留「剧情线 1」死端。
function StorylineSection({ accent, bookId, embed }: { accent: string; bookId: string; embed: "pane" | "timeline" }) {
  const storylines = useWritingStore((s) => s.storylines);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const loadStorylines = useWritingStore((s) => s.loadStorylines);
  const createStoryline = useWritingStore((s) => s.createStoryline);
  const deleteStoryline = useWritingStore((s) => s.deleteStoryline);
  const selectedStorylineId = useEditorStore((s) => s.selectedStorylineId);
  // 装载补齐：本 pane 可能先于时间线 pane 挂载（用户直接点「剧情线」tab）。
  useEffect(() => {
    const ws = useWritingStore.getState();
    if (ws.activeBookId && ws.storylines.length === 0) void ws.loadStorylines().catch(() => {});
  }, [loadStorylines]);

  const pickStoryline = (slId: string) => {
    try {
      const es = useEditorStore.getState();
      es.selectStoryline(slId);
      if (embed === "timeline" && es.timelineViewMode !== "storyline") es.setTimelineViewMode("storyline");
    } catch (e) {
      logger.warn("StorylineSection", "pickStoryline failed", { slId, error: String(e) });
    }
  };

  const handleCreate = async () => {
    const sl = await createStoryline(t("writing.storylineDefaultName", { n: storylines.length + 1 }));
    if (sl) {
      const es = useEditorStore.getState();
      es.selectStoryline(sl.id);
      if (embed === "timeline" && es.timelineViewMode !== "storyline") es.setTimelineViewMode("storyline");
    }
  };

  return (
    <div style={{ border: `1px solid ${CV.divider}`, borderRadius: 8, background: CV.paper, padding: "6px 8px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: storylines.length > 0 ? 5 : 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: CV.text3 }}>{t("writing.timelineViewStoryline")}</span>
        <span style={{ fontSize: 9, color: CV.text3 }}>{storylines.length}</span>
        <button
          type="button"
          onClick={() => void handleCreate()}
          title={t("writing.storylineCreate")}
          style={{ ...miniBtn(accent), marginLeft: "auto", fontSize: 9.5, padding: "1px 8px" }}
        >
          ＋ {t("writing.storylineCreate")}
        </button>
      </div>
      {storylines.length === 0 ? (
        <EmptyHint text={t("writing.storylineEmptyHint")} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {storylines.map((sl) => {
            const color = sl.color || LANE_COLORS[hashStr(sl.id) % LANE_COLORS.length];
            const n = timelineEvents.filter((e) => e.storylineId === sl.id).length;
            const active = selectedStorylineId === sl.id;
            return (
              <div
                key={sl.id}
                style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "2px 4px", borderRadius: 4, minWidth: 0,
                  background: active ? "rgba(25,118,210,0.08)" : "transparent",
                  boxShadow: active ? `inset 0 0 0 1px ${accent}` : "none",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <button
                  type="button"
                  onClick={() => pickStoryline(sl.id)}
                  title={t("writing.storylineSelect")}
                  style={{ ...miniBtn(color), border: "none", padding: 0, fontSize: 11, fontWeight: 700, color: CV.text, background: "transparent", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}
                >
                  {sl.name}
                </button>
                <span style={{ fontSize: 9, color: CV.text3, flexShrink: 0 }}>{t("editor.writing.timelineEventCount", { n })}</span>
                <button
                  type="button"
                  onClick={() => void deleteStoryline(sl.id)}
                  title={t("writing.storylineDelete")}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = CV.error; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = CV.text3; }}
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

export function StorylinePane({ accent, chapters, outlines, settings }: {
  accent: string;
  chapters: WritingChapter[];
  outlines: WritingOutline[];
  settings: WritingSetting[];
}) {
  const createChapter = useWritingStore((s) => s.createChapter);
  const createOutline = useWritingStore((s) => s.createOutline);
  const updateOutline = useWritingStore((s) => s.updateOutline);
  // 注意：章节列表只在**编辑区（设计视图，页面本体）**呈现，绝不进左栏（铁律 #9）。
  const bookId = useWritingStore((s) => s.activeBookId) ?? "";
  const bookTitle = useWritingStore((s) => s.books.find((b) => b.id === s.activeBookId)?.title) ?? "";
  const genre = useWritingStore((s) => s.books.find((b) => b.id === s.activeBookId)?.genre) ?? "";

  const characters = useMemo(() => settings.filter((s) => s.kind === "character"), [settings]);
  const scenes = useMemo(() => settings.filter((s) => s.kind === "worldbuilding"), [settings]);
  // 未落章的节拍：口径抽在 utils/writingOutline（与写作台、右栏同一个纯函数，
  // 谁先写谁后读都不会算出两套结果）
  const loose = useMemo(() => looseBeats(outlines), [outlines]);
  // 默认层级（卷›章 / 篇›节）只用于「加子级」的默认建议，零配置起步。
  const levels = useMemo(() => defaultLevels(genre), [genre]);
  // 扁平章节 → 结构树（任意深），递归渲染。
  const forest = useMemo(() => buildTree(chapters), [chapters]);

  const addRoot = () => {
    const rootKind = levels[0] ?? "章";
    void createChapter(`${rootKind} ${forest.length + 1}`);
  };

  return (
    <div style={paneStyle}>
      <PaneHeader
        label={t("writingDesign.pane.storyline")}
        count={chapters.length}
        action={t("writingDesign.addNode")}
        onAction={addRoot}
      />
      <div style={paneBodyStyle}>
        {/* 剧情线实体区（P1 整合）：线一目了然——新建/删线/点行选中并切到剧情线轴。
            就地改名在剧情线轴的轨道标签列，编辑卡在右栏详情（选中即就位）。 */}
        <StorylineSection accent={accent} bookId={bookId} embed="timeline" />
        {/* 鸟瞰条：作者第一眼看到「全书形状」，决定下一章写哪。 */}
        <BirdEyeBar roots={forest} outlines={outlines} />
        {/* 未落章的节拍排在最前：先规划节拍，写到那一节点时再拖入归位。
            分组头常驻（含「记个念头」）——这是 capture-first 灵感的唯一入口。 */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: CV.text3 }}>
            {t("editor.writing.inspector.loose")}
          </span>
          <span style={{ fontSize: 9, color: CV.text3 }}>{loose.length}</span>
          <button
            type="button"
            onClick={() => void createOutline(t("writingDesign.captureBeat"))}
            style={{ ...miniBtn(accent), marginLeft: "auto" }}
          >
            {t("writingDesign.captureBeat")}
          </button>
        </div>
        {loose.length === 0 && <EmptyHint text={t("editor.writing.inspector.looseHint")} />}
        {loose.map((b) => (
          <BeatRow
            key={b.id}
            beat={b}
            accent={accent}
            characters={characters}
            scenes={scenes}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(BEAT_DND_MIME, b.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            bindSlot={
              <select
                value=""
                title={t("writing.outlineBind")}
                style={bindSelectStyle}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next) void updateOutline(b.id, { chapterId: next });
                }}
              >
                <option value="">{t("writing.outlineUnbound")}</option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            }
          />
        ))}
        <div style={{ height: 1, background: CV.divider, margin: "4px 0" }} />
        {chapters.length === 0 && <EmptyHint text={t("writingDesign.emptyOutlineTree")} />}
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

// ─── 散文：篇目栏（可增） ───
export function PiecesPane({ accent, chapters }: { accent: string; chapters: WritingChapter[] }) {
  const createChapter = useWritingStore((s) => s.createChapter);
  // 篇目拖出同协议（页面本体内操作，不进左栏）：拖到画布即开该篇写作视图。
  const bookId = useWritingStore((s) => s.activeBookId) ?? "";
  const bookTitle = useWritingStore((s) => s.books.find((b) => b.id === s.activeBookId)?.title) ?? "";
  const genre = useWritingStore((s) => s.books.find((b) => b.id === s.activeBookId)?.genre) ?? "";
  return (
    <div style={paneStyle}>
      <PaneHeader
        label={t("writingDesign.pane.pieces")}
        count={chapters.length}
        action={t("writingDesign.add")}
        onAction={() => void createChapter(t("writing.newChapterName", { n: chapters.length + 1 }))}
      />
      <div style={paneBodyStyle}>
        {chapters.length === 0 && <EmptyHint text={t("writingDesign.emptyPieces")} />}
        {chapters.map((c) => (
          <div key={c.id} style={rowStyle()}>
            <span style={{ fontSize: 8, color: accent, flexShrink: 0 }}>◆</span>
            <span
              draggable
              onClick={() => openChapterCarrierView(c.id, bookTitle ? `${bookTitle} · ${c.title}` : c.title, genre, bookId)}
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-project-entity", "writing-workbench");
                e.dataTransfer.setData(
                  "application/x-project-entity-data",
                  JSON.stringify({ name: c.title, config: { __blank: true, genre, chapterId: c.id } })
                );
                e.dataTransfer.effectAllowed = "copy";
              }}
              title={t("writingLeft.chapterDragHint")}
              style={{ fontSize: 11.5, fontWeight: 600, color: CV.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0, cursor: "pointer" }}
            >
              {c.title}
            </span>
            <span style={{ fontSize: 9, color: CV.text3, flexShrink: 0 }}>
              {t("writing.words", { n: c.wordCount })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 散文：立意 / 素材栏（可增删改） ───
export function IdeasPane({ accent, outlines }: { accent: string; outlines: WritingOutline[] }) {
  const createOutline = useWritingStore((s) => s.createOutline);
  const updateOutline = useWritingStore((s) => s.updateOutline);
  const deleteOutline = useWritingStore((s) => s.deleteOutline);
  const ideas = useMemo(() => outlines.filter((o) => !o.chapterId), [outlines]);
  return (
    <div style={paneStyle}>
      <PaneHeader
        label={t("writingDesign.pane.ideas")}
        count={ideas.length}
        action={t("writingDesign.addIdea")}
        onAction={() => void createOutline(t("writingDesign.ideaN", { n: ideas.length + 1 }))}
      />
      <div style={paneBodyStyle}>
        {ideas.length === 0 && <EmptyHint text={t("writingDesign.emptyIdeas")} />}
        {ideas.map((o) => (
          <div key={o.id} style={{ ...rowStyle(), flexDirection: "column", alignItems: "stretch", gap: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
              <span style={{ fontSize: 8, color: accent, flexShrink: 0 }}>◆</span>
              <DraftInput
                entityKey={o.id}
                value={o.title}
                onCommit={(v) => updateOutline(o.id, { title: v })}
                style={{ ...inputStyle, fontWeight: 600, flex: 1 }}
              />
              <button
                type="button"
                title={t("writingDesign.deleteIdea")}
                onClick={() => void deleteOutline(o.id)}
                style={delBtnStyle}
              >
                ×
              </button>
            </div>
            <DraftInput
              entityKey={o.id}
              value={o.summary}
              onCommit={(v) => updateOutline(o.id, { summary: v })}
              placeholder={t("writingDesign.beatSummaryPh")}
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
  const loadChapters = useWritingStore((s) => s.loadChapters);
  const selectedTimelineEventId = useEditorStore((s) => s.selectedTimelineEventId);
  const bookScopedSettings = useMemo(
    () => (bookId ? settings.filter((s) => s.bookId === bookId) : settings),
    [settings, bookId]
  );
  // 章视图（按章 / 全书）切换；口径放 editorStore 共享（右栏总览冲突点选需切换口径），默认全书轴。
  const timelineView = useEditorStore((s) => s.timelineViewMode);
  // 轨道过滤器（pane 本地 UI 偏好，P1-B）：all=全部 / withEvents=有事件 / empty=未锚定(空轨道) / conflicted=有冲突。
  const [laneFilter, setLaneFilter] = useState<"all" | "withEvents" | "empty" | "conflicted">("all");
  // 新建动线闭环（方案 B）：刚创建的事件 id——用于滚动定位到它的落点卡（空草稿落「待补全」区）。
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  // 本书章按 sortOrder 排成阅读顺序轴（章节级时间线的唯一可计算骨架）。
  const bookChapters = useMemo(
    () => (bookId ? chapters.filter((c) => c.bookId === bookId).sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [chapters, bookId]
  );

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
    for (const ev of timelineEvents) (isComplete(ev) ? comp : inc).push(ev);
    return { completeEvents: comp, incompleteEvents: inc };
  }, [timelineEvents]);

  const coll = useMemo(() => new Intl.Collator("zh", { numeric: true }), []);
  const sortEvents = useCallback(
    (a: WritingTimelineEvent, b: WritingTimelineEvent) => {
      const ka = a.at?.trim() || "";
      const kb = b.at?.trim() || "";
      if (ka && kb) return coll.compare(ka, kb);
      if (ka) return -1;
      if (kb) return 1;
      return 0;
    },
    [coll]
  );

  // 全书合并轴：跨所有 lane 的完整事件按 at 混排，作为「全书的」总览（每个 chip 标注来源 lane）。
  const mergedLane = useMemo<Lane>(
    () => ({
      id: "__merged__",
      name: t("writing.timelineMerged"),
      isBook: false,
      settingId: null,
      events: [...completeEvents].sort(sortEvents),
    }),
    [completeEvents, sortEvents, t]
  );

  // 事件来源 lane 名（用于合并轴 / 待补全的 chip 标注）
  const laneNameOf = (settingId: string | null): string =>
    settingId
      ? bookScopedSettings.find((s) => s.id === settingId)?.name || t("writingWorkbench.untitled")
      : t("writing.timelineBookLevel");

  // lane：全书级(settingId=null) 优先；其余仅展示「有事件」的设定，按最早 at 排序否则按名。
  const settingLanes = useMemo<Lane[]>(() => {
    const bookName = t("writing.timelineBookLevel");
    const laneMap = new Map<string, Lane>();
    laneMap.set("__book__", { id: "__book__", name: bookName, isBook: true, settingId: null, events: [] });
    for (const s of bookScopedSettings) {
      laneMap.set(s.id, { id: s.id, name: s.name || t("writingWorkbench.untitled"), isBook: false, settingId: s.id, events: [] });
    }
    for (const ev of completeEvents) {
      const lid = ev.settingId ?? "__book__";
      const lane = laneMap.get(lid);
      if (lane) lane.events.push(ev);
    }
    const list = [...laneMap.values()].filter((l) => l.isBook || l.events.length > 0);
    for (const l of list) l.events.sort(sortEvents);
    list.sort((a, b) => {
      if (a.isBook) return -1;
      if (b.isBook) return 1;
      const ea = a.events.find((e) => e.at?.trim())?.at?.trim() || "";
      const eb = b.events.find((e) => e.at?.trim())?.at?.trim() || "";
      if (ea && eb) return coll.compare(ea, eb) || a.name.localeCompare(b.name, "zh");
      if (ea) return -1;
      if (eb) return 1;
      return a.name.localeCompare(b.name, "zh");
    });
    return list;
  }, [completeEvents, bookScopedSettings, coll, sortEvents, t]);

  // 章节级 lane：本书章按 sortOrder 为骨架，每章一组其绑定事件；末尾「未绑章」组收纳 chapterId 为空的事件。
  // 空章（无绑定事件）也列出并标「未锚定」，作为规划空缺提示。
  const chapterLanes = useMemo<Lane[]>(
    () => buildChapterLanes(bookChapters, completeEvents, { unbound: t("writing.timelineUnbound"), untitled: t("writingWorkbench.untitled") }),
    [bookChapters, completeEvents, t]
  );

  // 剧情线 lane（P0）：每条线一轨（color=线配色），末尾「未挂线」组收纳 storylineId 为空的事件。
  // 空线也列出（规划空缺提示，与章轴未锚定同语义）。
  const storylineLanes = useMemo<Lane[]>(() => {
    const lanes: Lane[] = storylines.map((sl) => ({
      id: sl.id,
      name: sl.name,
      isBook: false,
      settingId: null,
      events: completeEvents.filter((e) => e.storylineId === sl.id).sort(sortEvents),
    }));
    lanes.push({
      id: "__unlined__",
      name: t("writing.storylineUnlined"),
      isBook: false,
      settingId: null,
      events: completeEvents.filter((e) => !e.storylineId).sort(sortEvents),
    });
    return lanes;
  }, [storylines, completeEvents, sortEvents, t]);

  // 视图切换：全书轴（按设定分轨）/ 按章轴（按章分轨）/ 剧情线轴（按线分轨）
  const lanes = timelineView === "book" ? settingLanes : timelineView === "chapter" ? chapterLanes : storylineLanes;

  // P2 冲突检测（派生视图 / 软提示，琥珀色不强制）：同轨 at 碰撞 + 跨章时间倒挂。
  // 直接基于 events 计算（与右栏总览共用同一算法，避免 lane 构建口径分裂）。
  const conflictIds = useMemo<Set<string>>(
    () => computeTimelineConflicts(timelineEvents, { view: timelineView, chapters: bookChapters }),
    [timelineView, timelineEvents, bookChapters]
  );

  // P2 覆盖率：已锚定章 / 总章；未绑章事件数（章节视图用）
  const coverage = useMemo(() => computeCoverage(bookChapters, completeEvents), [bookChapters, completeEvents]);

  // P1-B 轨道过滤器：只过滤轨道渲染，不动合并轴 / 待补全 / 覆盖率仪表（统计口径保持全局）。
  const filteredLanes = useMemo(() => {
    if (laneFilter === "withEvents") return lanes.filter((l) => l.events.length > 0);
    if (laneFilter === "empty") return lanes.filter((l) => l.events.length === 0);
    if (laneFilter === "conflicted") return lanes.filter((l) => l.events.some((e) => conflictIds.has(e.id)));
    return lanes;
  }, [lanes, laneFilter, conflictIds]);

  // 事件跳转：绑了章优先跳章，否则跳来源设定（合并轴 / 轨道 / 待补全通用）
  const jumpForEvent = (ev: WritingTimelineEvent) => {
    if (ev.chapterId) {
      const b = useWritingStore.getState().books.find((x) => x.id === bookId);
      openChapterCarrierView(ev.chapterId, ev.event || t("writingWorkbench.untitled"), b?.genre ?? "", bookId);
    } else if (ev.settingId) {
      openSettingProfile(ev.settingId);
    }
  };

  // 统一新建入口（方案 B）：创建空草稿后立即选中（SceneEditor effect 自动带动右栏详情 tab）
  // 并登记 justCreatedId 供下方 effect 滚动定位——空 at/event 草稿会落「待补全」区而非当前轨道，
  // 不选中不定位的话用户会以为「点了没反应」。
  const handleCreateEvent = async (opts: { settingId?: string | null; chapterId?: string | null; storylineId?: string | null }) => {
    const ev = await createTimelineEvent({ settingId: opts.settingId ?? null, chapterId: opts.chapterId ?? null, storylineId: opts.storylineId ?? null, at: "", event: "" });
    if (!ev) return;
    useEditorStore.getState().selectTimelineEvent(ev.id);
    setJustCreatedId(ev.id);
  };

  // 新建后滚动定位：等一帧让新卡渲染进 DOM，再滚到落点卡（选中高亮环本身即视觉反馈）。
  useEffect(() => {
    if (!justCreatedId) return;
    const raf = requestAnimationFrame(() => {
      document.querySelector(`[data-ev-id="${justCreatedId}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [justCreatedId]);

  const totalEvents = useMemo(() => filteredLanes.reduce((n, l) => n + l.events.length, 0), [filteredLanes]);

  const laneColor = (lane: { id: string; isBook: boolean; settingId: string | null }): string => {
    if (lane.isBook) return accent;
    if (lane.settingId) {
      const s = bookScopedSettings.find((x) => x.id === lane.settingId);
      if (s && s.kind === "worldbuilding") {
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
      <PaneHeader label={t("writing.viewKind.timeline")} count={totalEvents} />
      {/* 视图口径（全书轴/按章轴/剧情线轴）+ 剧情线管理 + 全局新建；行首小节标签让「口径/创建」与下方「筛选」语义分层 */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px 0", flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9.5, color: CV.text3, flexShrink: 0 }}>{t("writing.timelineGroupView")}</span>
        {(["book", "chapter", "storyline"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => useEditorStore.getState().setTimelineViewMode(v)}
            style={{
              ...miniBtn(v === timelineView ? accent : "#64748b"),
              fontSize: 10.5,
              padding: "2px 10px",
              fontWeight: v === timelineView ? 700 : 400,
              borderColor: v === timelineView ? accent : CV.divider,
              background: v === timelineView ? `${accent}1a` : CV.paper,
              color: v === timelineView ? accent : CV.text2,
            }}
          >
            {t(v === "book" ? "writing.timelineViewBook" : v === "chapter" ? "writing.timelineViewChapter" : "writing.timelineViewStoryline")}
          </button>
        ))}
        {/* 剧情线管理：仅剧情线口径显示——建线动作发生在挂线语境里，不混进其他轴 */}
        {timelineView === "storyline" && (
          <button
            type="button"
            onClick={() => void createStoryline(t("writing.storylineDefaultName", { n: storylines.length + 1 }))}
            style={{ ...miniBtn(accent), fontSize: 10, padding: "2px 8px" }}
          >
            ＋ {t("writing.storylineCreate")}
          </button>
        )}
        {/* 全局新建：book 视图默认全书级、chapter 视图默认未绑章、storyline 视图默认未挂线（可再绑）；
            创建后自动选中 → 右栏详情即编 + 滚动定位到落点卡，动线零寻找成本 */}
        <button
          type="button"
          onClick={() => void handleCreateEvent(timelineView === "book" ? { settingId: null } : timelineView === "chapter" ? { chapterId: null } : { storylineId: null })}
          style={{
            ...miniBtn(accent),
            marginLeft: "auto",
            fontSize: 10.5,
            padding: "2px 10px",
            fontWeight: 700,
          }}
        >
          ＋ {t("writing.timelineCreateEvent")}
        </button>
      </div>
      {/* P1-B 轨道过滤器：只影响轨道列表；合并轴 / 待补全 / 覆盖率保持全局口径 */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px 0", flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9.5, color: CV.text3, flexShrink: 0 }}>{t("writing.timelineGroupFilter")}</span>
        {(["all", "withEvents", "empty", "conflicted"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setLaneFilter(f)}
            style={{
              ...miniBtn(laneFilter === f ? accent : "#64748b"),
              fontSize: 9.5,
              padding: "1px 8px",
              fontWeight: laneFilter === f ? 700 : 400,
              borderColor: laneFilter === f ? accent : CV.divider,
              background: laneFilter === f ? `${accent}1a` : CV.paper,
              color: laneFilter === f ? accent : CV.text2,
            }}
          >
            {t(f === "all" ? "writing.timelineFilterAll" : f === "withEvents" ? "writing.timelineFilterWithEvents" : f === "empty" ? "writing.timelineFilterUnanchored" : "writing.timelineFilterConflicted")}
          </button>
        ))}
      </div>
      <div style={paneBodyStyle}>
        {/* P2 章节视图：锚定覆盖率仪表 + 冲突提示图例（均仅 advisory，不强制） */}
        {timelineView === "chapter" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px 6px", flexShrink: 0, fontSize: 10.5, color: CV.text2, flexWrap: "wrap", border: `1px solid ${CV.divider}`, borderRadius: 8, background: CV.paper, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <span style={{ fontWeight: 700, color: CV.text, fontVariantNumeric: "tabular-nums" }}>{t("writing.timelineCoverage", { a: coverage.anchoredChapterCount, t: coverage.totalChapters })}</span>
            <div style={{ flex: "1 1 160px", maxWidth: 220, height: 5, borderRadius: 3, background: CV.divider, overflow: "hidden", minWidth: 60 }}>
              <div style={{ height: "100%", width: `${coverage.totalChapters ? Math.round((coverage.anchoredChapterCount / coverage.totalChapters) * 100) : 0}%`, background: accent, borderRadius: 3, transition: "width 120ms" }} />
            </div>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{t("writing.timelineUnbound")} {coverage.unboundEventCount}</span>
          </div>
        )}
        {timelineView === "chapter" && conflictIds.size > 0 && (
          <div style={{ fontSize: 9.5, color: CV.warning, padding: "0 2px 4px" }}>⚠ {t("writing.timelineConflict")}：{t("writing.timelineConflictHint")}</div>
        )}
        {/* 待补全：空 at / 空 event 的草稿归此处，不污染主时间轴（零阻力捕获，可暂留） */}
        {incompleteEvents.length > 0 && (
          <div style={{ border: `1px solid ${CV.warning}`, borderRadius: 8, background: CV.warningSoft, padding: "8px 10px", flexShrink: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: CV.text }}>{t("writing.timelineIncomplete")}</span>
              <span style={{ fontSize: 10, color: CV.text3 }}>{t("editor.writing.timelineEventCount", { n: incompleteEvents.length })}</span>
              <span style={{ fontSize: 9.5, color: CV.text3 }}>{t("writing.timelineIncompleteHint")}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {incompleteEvents.map((ev) => (
                <EventChip
                  key={ev.id}
                  ev={ev}
                  color={accent}
                  sourceLabel={laneNameOf(ev.settingId)}
                  chapters={bookChapters}
                        storylines={storylines}
                  warn={conflictIds.has(ev.id)}
                  onJump={() => jumpForEvent(ev)}
                  onDelete={() => void deleteTimelineEvent(ev.id)}
                  onUpdate={(patch) => updateTimelineEvent(ev.id, patch)}
                  onSelect={() => useEditorStore.getState().selectTimelineEvent(ev.id)}
                  selected={selectedTimelineEventId === ev.id}
                />
              ))}
            </div>
          </div>
        )}
        {/* 全书合并轴：跨 lane 的总览，每个事件标注来源 lane，按 at 混排。
            两种口径都显示（拍板 2026-09-18）：合并轴是全书总览、独立于轨道口径，
            曾经仅全书模式显示 → 口径持久在章视图时合并轴无声消失（用户「看不到」根因）。 */}
        <div style={{ border: `1.5px solid ${accent}`, borderRadius: 8, background: CV.paper, minWidth: 0, flexShrink: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 8px", borderBottom: `1px solid ${CV.divider}` }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: accent, flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, fontWeight: 700, color: CV.text }}>{mergedLane.name}</span>
            <span style={{ fontSize: 9.5, color: CV.text3 }}>{t("editor.writing.timelineEventCount", { n: mergedLane.events.length })}</span>
          </div>
          <div style={{ padding: "10px 10px 12px", overflowX: "auto" }}>
            {mergedLane.events.length === 0 ? (
              <div style={{ fontSize: 10.5, color: CV.text3 }}>—</div>
            ) : (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 10, minWidth: "max-content", position: "relative" }}>
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 2, height: 1.5, background: CV.divider, borderRadius: 1 }} />
                {mergedLane.events.map((ev) => (
                  <EventChip
                    key={ev.id}
                    ev={ev}
                    color={laneColor({ id: ev.settingId ?? "__book__", isBook: !ev.settingId, settingId: ev.settingId })}
                    sourceLabel={laneNameOf(ev.settingId)}
                    chapters={bookChapters}
                        storylines={storylines}
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
        {filteredLanes.length === 0 && incompleteEvents.length === 0 && <EmptyHint text={t("writing.timelineEmptyHint")} />}
        {filteredLanes.map((lane) => {
          // storyline 视图：轨道色 = 线自定义色（空则 id 哈希兜底）；「未挂线」组恒灰
          const color = timelineView === "storyline"
            ? (lane.id === "__unlined__" ? "#64748b" : storylines.find((sl) => sl.id === lane.id)?.color || LANE_COLORS[hashStr(lane.id) % LANE_COLORS.length])
            : laneColor(lane);
          return (
            <div
              key={lane.id}
              style={{
                display: "flex",
                alignItems: "stretch",
                border: `1px solid ${CV.divider}`,
                borderRadius: 8,
                background: CV.paper,
                minWidth: 0,
                flexShrink: 0,
                marginTop: 4,
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              {/* 轨道标签（左侧固定列，可点进要素检查器） */}
              <div
                style={{
                  position: "sticky",
                  left: 0,
                  zIndex: 1,
                  flexShrink: 0,
                  minWidth: 132,
                  maxWidth: 132,
                  background: CV.paper,
                  borderRight: `1px solid ${CV.divider}`,
                  padding: "6px 8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: color,
                      flexShrink: 0,
                      cursor: timelineView === "storyline" && lane.id !== "__unlined__" ? "pointer" : "default",
                    }}
                    onClick={() => { if (timelineView === "storyline" && lane.id !== "__unlined__") useEditorStore.getState().selectStoryline(lane.id); }}
                    title={timelineView === "storyline" && lane.id !== "__unlined__" ? t("writing.storylineSelect") : undefined}
                  />
                  {timelineView === "storyline" && !lane.isBook ? (
                    // 剧情线轨：线名就地可编辑（失焦/回车保存）+ 删线（删线不删事件，事件回「未挂线」）
                    <>
                      <DraftInput
                        entityKey={lane.id}
                        value={lane.name}
                        onCommit={(v) => updateStoryline(lane.id, { name: v })}
                        title={t("writing.storylineRename")}
                        style={{ ...inputStyle, fontSize: 11.5, fontWeight: 700, color: CV.text, minWidth: 0, flex: 1 }}
                      />
                      {lane.id !== "__unlined__" && (
                        <button
                          type="button"
                          onClick={() => void deleteStoryline(lane.id)}
                          title={t("writing.storylineDelete")}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = CV.error; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = CV.text3; }}
                          style={{ ...delBtnStyle, fontSize: 12, fontWeight: 700, lineHeight: 1 }}
                        >
                          ×
                        </button>
                      )}
                    </>
                  ) : lane.isBook ? (
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: CV.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lane.name}</span>
                  ) : lane.chapterId ? (
                    <button
                      type="button"
                      onClick={() => {
                        const b = useWritingStore.getState().books.find((x) => x.id === bookId);
                        openChapterCarrierView(lane.chapterId!, lane.name, b?.genre ?? "", bookId);
                      }}
                      title={t("writing.timelineJumpChapter")}
                      style={{ ...miniBtn(color), border: "none", padding: 0, fontSize: 11.5, fontWeight: 700, color: CV.text, background: "transparent", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {lane.name}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => useEditorStore.getState().selectSetting(lane.settingId)}
                      title={t("writingDesign.viewDetail")}
                      style={{ ...miniBtn(color), border: "none", padding: 0, fontSize: 11.5, fontWeight: 700, color: CV.text, background: "transparent", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {lane.name}
                    </button>
                  )}
                </div>
                {lane.subtitle && <span style={{ fontSize: 9.5, color: CV.text3 }}>{lane.subtitle}</span>}
                <span style={{ fontSize: 9.5, color: CV.text3 }}>{t("editor.writing.timelineEventCount", { n: lane.events.length })}</span>
                {timelineView === "chapter" && lane.chapterId && lane.events.length === 0 && (
                  <span style={{ fontSize: 9.5, color: CV.warning }}>{t("writing.timelineGap")}</span>
                )}
                <button
                  type="button"
                  onClick={() => void handleCreateEvent(
                    lane.isBook ? { settingId: null }
                      : timelineView === "storyline" ? { storylineId: lane.id === "__unlined__" ? null : lane.id }
                        : lane.chapterId ? { chapterId: lane.chapterId }
                          : { settingId: lane.settingId }
                  )}
                  style={{ ...miniBtn(color), marginTop: 2 }}
                >
                  {t("writingDesign.add")}
                </button>
              </div>
              {/* 轨道时间轴区（横向滚动；事件按序排开，刻度=作者原文 at） */}
              <div style={{ flex: 1, minWidth: 0, overflowX: "auto", position: "relative", padding: "10px 10px 12px" }}>
                {lane.events.length === 0 ? (
                  <div
                    style={{
                      fontSize: 10,
                      color: CV.text3,
                      border: `1px dashed ${CV.divider}`,
                      borderRadius: 6,
                      padding: "10px 12px",
                    }}
                  >
                    {t("writing.timelineLaneEmptyHint")}
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 10, minWidth: "max-content", position: "relative" }}>
                    <div style={{ position: "absolute", left: 0, right: 0, bottom: 2, height: 1.5, background: CV.divider, borderRadius: 1 }} />
                    {lane.events.map((ev) => (
                      <EventChip
                        key={ev.id}
                        ev={ev}
                        color={color}
                        chapters={bookChapters}
                        storylines={storylines}
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
}: {
  ev: WritingTimelineEvent;
  color: string;
  /** 来源 lane 名（合并轴 / 待补全里标注事件归属，普通 lane 不传） */
  sourceLabel?: string;
  /** 本书章列表（用于「绑到章」选择器；为空则不显示选择器） */
  chapters?: { id: string; title: string }[];
  /** 本书剧情线列表（用于「挂线」选择器；为空则不显示选择器） */
  storylines?: { id: string; name: string }[];
  onJump: () => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<Pick<WritingTimelineEvent, "at" | "event" | "chapterId" | "storylineId">>) => void | Promise<unknown>;
  /** 冲突提示（同轨 at 碰撞 / 跨章时间倒挂）：仅琥珀色软提示，不强制 */
  warn?: boolean;
  /** 选中事件以在右侧栏编辑：点 chip（非输入/按钮区）即选中 */
  onSelect?: () => void;
  /** 是否当前右栏编辑目标（选中高亮环） */
  selected?: boolean;
}) {
  const borderColor = selected ? color : warn ? CV.warning : `${color}66`;
  // hover 反馈（视觉打磨）：悬停时底色/描边加深一档；warn 背景必须用字面 rgba——
  // CV.warning 是 var() 引用，拼 alpha 后缀是无效 CSS（曾导致冲突卡片琥珀底从未渲染）。
  const [hov, setHov] = useState(false);
  const [delHov, setDelHov] = useState(false);
  const bg = warn ? (hov ? "rgba(237,108,2,0.14)" : "rgba(237,108,2,0.08)") : hov ? `${color}1f` : `${color}12`;
  return (
    <div
      data-ev-id={ev.id}
      onMouseEnter={onSelect ? () => setHov(true) : undefined}
      onMouseLeave={onSelect ? () => setHov(false) : undefined}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest("button") || el.closest("input") || el.closest("textarea") || el.closest("select")) return;
        onSelect?.();
      }}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        cursor: onSelect ? "pointer" : "default",
        border: `1px solid ${hov && !selected && !warn ? `${color}99` : borderColor}`,
        borderRadius: 6,
        background: bg,
        boxShadow: selected ? `0 0 0 2px ${color}33` : undefined,
        padding: "4px 6px",
        minWidth: 168,
        width: 168,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {warn && <span title={t("writing.timelineConflictHint")} style={{ fontSize: 10, lineHeight: 1, color: CV.warning, fontWeight: 700 }}>⚠</span>}
        <DraftInput
          entityKey={ev.id}
          value={ev.at ?? ""}
          onCommit={(v) => onUpdate({ at: v })}
          placeholder={t("writing.timelineAtPh")}
          style={{ ...inputStyle, width: 64, fontSize: 10, color, fontWeight: 600 }}
        />
        <button type="button" onClick={onJump} title={ev.chapterId ? t("writing.timelineJumpChapter") : t("writingDesign.editProfile")} style={{ ...miniBtn(color), fontSize: 9.5, padding: "1px 6px" }}>
          {ev.chapterId ? t("writing.timelineJumpChapter") : t("writingDesign.editProfile")}
        </button>
        <button
          type="button"
          onClick={onDelete}
          onMouseEnter={() => setDelHov(true)}
          onMouseLeave={() => setDelHov(false)}
          title={t("writingDesign.deleteIdea")}
          style={{ ...delBtnStyle, color: delHov ? CV.error : CV.text3, fontSize: 12, fontWeight: 700, lineHeight: 1 }}
        >
          ×
        </button>
      </div>
      <DraftInput
        as="textarea"
        rows={2}
        entityKey={ev.id}
        value={ev.event ?? ""}
        onCommit={(v) => onUpdate({ event: v })}
        placeholder={t("writing.timelineEventPh")}
        style={{ ...inputStyle, fontSize: 10.5, resize: "vertical", lineHeight: 1.35 }}
      />
      {chapters && chapters.length > 0 && (
        <select
          value={ev.chapterId ?? ""}
          onChange={(e) => onUpdate({ chapterId: e.target.value || null })}
          title={t("writing.timelineChapter")}
          style={{ ...inputStyle, fontSize: 9.5, padding: "1px 2px" }}
        >
          <option value="">{t("writing.timelineUnbound")}</option>
          {chapters.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
      )}
      {storylines && storylines.length > 0 && (
        <select
          value={ev.storylineId ?? ""}
          onChange={(e) => onUpdate({ storylineId: e.target.value || null })}
          title={t("writing.timelineStoryline")}
          style={{ ...inputStyle, fontSize: 9.5, padding: "1px 2px" }}
        >
          <option value="">{t("writing.storylineUnlined")}</option>
          {storylines.map((sl) => (
            <option key={sl.id} value={sl.id}>{sl.name}</option>
          ))}
        </select>
      )}
      {sourceLabel && (
        <span style={{ fontSize: 9, color: CV.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sourceLabel}</span>
      )}
    </div>
  );
}
