// 载体工作台实体渲染器（G3 重构：章节编辑器抽到 WritingChapterEditor 共享）
//
// 拖「载体」进画布落下的就是它：按绑定分流（hooks 顺序安全——两个分支各自成组件）。
//   不带 chapterId → 设计视图（WritingDesignView，G2 遗留形态，新建链路已改为
//                     writing-docs 容器视图，本渲染器继续服务已落库的旧卡）；
//   带 chapterId   → 纸面卡（内嵌 TipTap，绑定真实章节/篇目）。
// 画布拖动编辑（实体拖拽/框选/缩放）原样保留：卡片标题栏可拖卡，正文区
// stopPropagation 让位给文字编辑，两者互不干扰。
// 画布零 Emotion 约定：纯 div + inline style；ProseMirror 排版在 canvasEntity.css 的 .ps-workbench。
import type { ComponentRendererProps } from "../../types/editor";
import { closeCarrierCard } from "../../utils/studioBook";
import { t } from "../../i18n";
import { WritingChapterEditor } from "./WritingChapterEditor";
import { WritingDesignView } from "./WritingDesignView";

/** 纸面卡（chapterId 分支）：绑定真实章节。2026-09-19 拍板只读审阅——
 *  画布正文统一转设计/审阅定位，编辑动线收敛到写作台 /writing（标题栏「⇢ 写作台」）。 */
function WritingChapterPaperCard({ config, chapterId, mode, componentId }: ComponentRendererProps & { chapterId: string }) {
  return (
    <div
      // V4 拍板：载体视图铺满画布、固定不拖不缩放。根层拦截指针事件，
      // 阻止冒泡到画布实体拖拽/选中处理器——整卡不可拖动、不可选中。
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ width: "100%", height: "100%" }}
    >
      <WritingChapterEditor
        chrome="paper"
        chapterId={chapterId}
        config={config}
        readOnly
        actions={
          mode !== "preview" ? (
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
                color: "#94a3b8",
                fontSize: 13,
                lineHeight: 1,
                padding: "0 2px",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              ×
            </button>
          ) : undefined
        }
      />
    </div>
  );
}

/**
 * 导出壳：按绑定分流（hooks 顺序安全——两个分支各自成组件）。
 *   不带 chapterId → 设计视图（WritingDesignView）；带 chapterId → 纸面卡。
 */
export function WritingWorkbenchRenderer(props: ComponentRendererProps) {
  const chapterId =
    typeof props.config.chapterId === "string" ? (props.config.chapterId as string) : "";
  if (!chapterId) {
    return <WritingDesignView {...props} />;
  }
  return <WritingChapterPaperCard {...props} chapterId={chapterId} />;
}
