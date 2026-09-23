// 载体编辑视图（V4：用户拍板「不是纯面板展示——编辑区铺满整幅画布，继续拖动 = 新建视图渲染新载体」）
//
// 心智模型：一视图一载体。拖载体进画布 = 当前视图已有内容则新开视图，
// 载体编辑区铺满整幅画布（落位由 SceneEditor.handleDrop 的载体分支负责）。
// 卡内是**可编辑**的设计面（节拍 / 挂载 / 人物 / 场景 / 立意），但整卡不拖动、不被画布选中——
// 卡根统一拦截 mousedown/click/dblclick 冒泡，编辑控件自身的事件照常工作。
//   - 小说：主线（卷分组章节 + 节拍 + 出场人物/场景挂载）· 人物 · 场景
//   - 散文：篇目 · 立意 / 素材
// 数据零新表：章节=writing_chapters（卷=volume）、节拍/立意=writing_outlines
// （挂载=extra JSON）、人物/场景=writing_settings。零 Emotion：纯 div + inline style。
//
// 2026-09-12：三个 pane 已抽到 `./writingPanes`，与 L2 题材视图的 WritingStudioPane
// 共用同一实现（此前 L2 题材视图铺的是只读分析板，导致「在大纲视图里编辑不了大纲」）。
import { useEffect } from "react";
import type { ComponentRendererProps } from "../../types/editor";
import { useWritingStore } from "../../store/writingStore";
import { genreLabelKey } from "../../utils/writingSchema";
import { closeCarrierCard } from "../../utils/studioBook";
import { resolveFragments, t } from "../../i18n";
import { CV } from "./canvasTheme";
import {
  CastPane,
  IdeasPane,
  NOVEL_ACCENT,
  ESSAY_ACCENT,
  PiecesPane,
  StorylinePane,
} from "./writingPanes";

// ─── 主组件：按体裁分支 ───
export function WritingDesignView({ config, mode, componentId }: ComponentRendererProps) {
  const filePath = typeof config.filePath === "string" ? config.filePath : "";
  const bookId = filePath.match(/^writing:\/\/([^/]+)\//)?.[1] ?? "";

  const books = useWritingStore((s) => s.books);
  const chapters = useWritingStore((s) => s.chapters);
  const outlines = useWritingStore((s) => s.outlines);
  const settings = useWritingStore((s) => s.settings);
  const book = books.find((b) => b.id === bookId) ?? null;
  // 书体裁为空串（旧书未设置）时回落拖拽携带的体裁 —— 以用户选择为准
  const genre = book?.genre || (typeof config.genre === "string" ? config.genre : "");

  // 书接线：卡片依赖的书未激活时自动接线（装载章节 / 设定 / 大纲）
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
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: CV.text3,
          fontSize: 12,
          padding: 16,
          textAlign: "center",
          lineHeight: 1.7,
        }}
      >
        {t("writingWorkbench.unbound")}
      </div>
    );
  }

  const isEssay = genre === "essay";
  const accent = isEssay ? ESSAY_ACCENT : NOVEL_ACCENT;
  const badgeChar = resolveFragments(genreLabelKey(genre)).charAt(0) || "文";
  // 体裁未实装（旧卡 poetry/script）：明示建设中文案，不留空白卡
  const genreReady = isEssay || genre === "novel" || genre === "";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: 10,
        border: `1.5px solid ${accent}55`,
        background: `linear-gradient(180deg, ${accent}0f, ${accent}05)`,
        overflow: "hidden",
        boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
        boxSizing: "border-box",
      }}
      /* 卡根统一拦截：整卡不拖动、不被画布点选（V4：铺满画布的载体视图，
         拖/选都无意义）；编辑控件自身事件在拦截层之内，照常工作 */
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* 标题栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 12px",
          borderBottom: `1px solid ${accent}33`,
          background: `${accent}14`,
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            backgroundColor: `${accent}2e`,
            border: `1px solid ${accent}66`,
            color: accent,
            fontSize: 11,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {badgeChar}
        </div>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: CV.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>
          {book?.title || resolveFragments(String(config.name ?? "")) || t("writingWorkbench.untitled")}
        </span>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            color: accent,
            border: `1px solid ${accent}66`,
            borderRadius: 999,
            padding: "2px 8px",
            flexShrink: 0,
          }}
        >
          {t("writingDesign.designView")}
        </span>
        <span style={{ fontSize: 9.5, color: CV.text3, marginLeft: "auto", flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {t("writingDesign.hint")}
        </span>
        {mode !== "preview" && (
          <button
            type="button"
            title={t("writingWorkbench.closeView")}
            onClick={(e) => {
              e.stopPropagation();
              closeCarrierCard(componentId);
            }}
            style={{
              border: "none",
              background: "transparent",
              color: CV.text3,
              fontSize: 14,
              lineHeight: 1,
              padding: "0 2px",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* 编辑区：按体裁分支，全部只在本卡内交互 */}
      {!genreReady ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: CV.text3 }}>
          {t("writing.genre.comingSoon")}
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            gap: 8,
            padding: 8,
          }}
        >
          {isEssay ? (
            <>
              <PiecesPane accent={accent} chapters={chapters} />
              <IdeasPane accent={accent} outlines={outlines} />
            </>
          ) : (
            <>
              <StorylinePane accent={accent} chapters={chapters} outlines={outlines} settings={settings} />
              <CastPane
                kind="character"
                accent={accent}
                paneLabel={t("writingDesign.pane.characters")}
                emptyText={t("writingDesign.emptyCharacters")}
              />
              <CastPane
                kind="worldbuilding"
                accent={accent}
                paneLabel={t("writingDesign.pane.scenes")}
                emptyText={t("writingDesign.emptyScenes")}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
