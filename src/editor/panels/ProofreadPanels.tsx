// 校对右侧栏面板（对标 InspirationPanels 范式，2026-09-18）：
//
// ProofreadOverviewCard —— 右栏「要素」tab · 校对激活时的体检统计卡：
//   六组维度计数（章文本/章账/伏笔/时间线/剧情线/念头池），
//   有页签去向的组行可点直达（伏笔→伏笔页签、时间线→时间线、剧情线→剧情线、念头→灵感）。
// 口径 = utils/writingProofread.buildProofreadReport（与校对页签编辑面同一份，禁止第二份）。
// 校对的发现**即点即跳**（无编辑器语义），故详情 tab 无选中态需求（SceneEditor tab1 给空态说明）。
import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useWritingStore } from "../../store/writingStore";
import { buildProofreadReport, PROOFREAD_GROUPS, type ProofreadGroup } from "../../utils/writingProofread";
import { openTypedCarrierView, type WritingViewKind } from "../../utils/studioBook";
import { t } from "../../i18n";

/** 组 → i18n 组名键（group 值带连字符，leaf 键用驼峰） */
export function proofreadGroupLabelKey(g: ProofreadGroup): string {
  switch (g) {
    case "chapter-text": return "writing.proofreadGroup.ChapterText";
    case "chapter-account": return "writing.proofreadGroup.ChapterAccount";
    case "foreshadow": return "writing.proofreadGroup.Foreshadow";
    case "timeline": return "writing.proofreadGroup.Timeline";
    case "storyline": return "writing.proofreadGroup.Storyline";
    case "idea": return "writing.proofreadGroup.Idea";
  }
}

/** 组 → 页签去向（无页签的组返回 null = 不可跳） */
export function proofreadGroupView(g: ProofreadGroup): WritingViewKind | null {
  switch (g) {
    case "foreshadow": return "foreshadowing";
    case "timeline": return "timeline";
    case "storyline": return "storylines";
    case "idea": return "inspiration";
    default: return null;
  }
}

// ─── 要素 tab · 校对体检统计卡 ───
export function ProofreadOverviewCard() {
  const chapters = useWritingStore((s) => s.chapters);
  const outlines = useWritingStore((s) => s.outlines);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const storylines = useWritingStore((s) => s.storylines);
  const books = useWritingStore((s) => s.books);
  const activeBookId = useWritingStore((s) => s.activeBookId);

  const report = useMemo(
    () => buildProofreadReport(chapters, outlines, timelineEvents, foreshadowings, storylines),
    [chapters, outlines, timelineEvents, foreshadowings, storylines],
  );
  const genre = books.find((b) => b.id === activeBookId)?.genre ?? "";
  const total = PROOFREAD_GROUPS.reduce((n, g) => n + report.counts[g], 0);

  const jump = (g: ProofreadGroup) => {
    try {
      const view = proofreadGroupView(g);
      if (view && genre) openTypedCarrierView(genre, view);
    } catch (e) {
      console.warn("ProofreadOverviewCard.jump failed", String(e));
    }
  };

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 1.25, display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Typography variant="caption" sx={{ fontWeight: 700 }} color="text.secondary">
        {t("writing.viewKind.proofread")} · {total}
      </Typography>
      {total === 0 ? (
        <Typography variant="caption" color="text.disabled">{t("writing.proofreadPaneEmpty")}</Typography>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
          {PROOFREAD_GROUPS.map((g) => {
            const n = report.counts[g];
            const view = proofreadGroupView(g);
            return (
              <Box
                key={g}
                onClick={() => n > 0 && view && jump(g)}
                title={view ? t("writing.inspirationOverviewJump") : undefined}
                sx={{
                  fontSize: 11.5, p: "3px 6px", borderRadius: 1, border: 1, borderColor: "divider",
                  display: "flex", alignItems: "center", gap: 1, minWidth: 0,
                  cursor: n > 0 && view ? "pointer" : "default",
                  "&:hover": n > 0 && view ? { bgcolor: "action.hover" } : {},
                }}
              >
                <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, color: n > 0 ? "text.primary" : "text.disabled" }}>
                  {t(proofreadGroupLabelKey(g))}
                </Box>
                <Box component="span" sx={{ color: n > 0 ? "warning.main" : "text.disabled", flexShrink: 0, fontWeight: 700 }}>
                  {n}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
