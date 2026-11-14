// 统计右侧栏面板（对标 ProofreadPanels 范式，2026-09-19）：
//
// StatsOverviewCard —— 右栏「要素」tab · 统计激活时的体量总览卡：
//   KPI 网格（总字数/章节/卷/设定/章均）+ 离群章列表（advisory 软提示，点行跳章）。
// 口径 = utils/writingStats（与统计页签编辑面/AI 语料同一份，禁止第二份）。
// 统计**无选中态**（无实体编辑语义），故详情 tab 无分派需求（SceneEditor tab1 给空态说明）。
import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useWritingStore } from "../../store/writingStore";
import { buildChapterWordRows, computeWritingKpis, type WritingChapterWordRow } from "../../utils/writingStats";
import { kpiLabelKeys } from "../../utils/writingSchema";
import { t } from "../../i18n";

export function StatsOverviewCard({ bookId, onJumpChapter }: { bookId: string; onJumpChapter?: (chId: string, title: string) => void }) {
  const chapters = useWritingStore((s) => s.chapters);
  const settings = useWritingStore((s) => s.settings);
  const genre = useWritingStore((s) => s.books.find((b) => b.id === bookId)?.genre ?? "");
  const bookChapters = useMemo(() => chapters.filter((c) => c.bookId === bookId), [chapters, bookId]);
  const bookSettings = useMemo(() => settings.filter((s) => s.bookId === bookId), [settings, bookId]);
  const kpis = useMemo(() => computeWritingKpis(bookChapters, bookSettings), [bookChapters, bookSettings]);
  // genre 传进去，右栏这张卡才与统计页签同一口径：诗集的体量长短悬殊是体裁常态，
  // 不传就会在小说「章均」尺度下给每首诗贴离群（⑭ 刀C 收口时发现的漏接）。
  const chRows = useMemo(() => buildChapterWordRows(bookChapters, genre), [bookChapters, genre]);
  const outliers: WritingChapterWordRow[] = chRows.filter((r) => r.outlier !== null);

  // 名词按体裁（小说 = 原键原字，零回归）
  const kk = kpiLabelKeys(genre);
  const cells: { label: string; value: string }[] = [
    { label: t("writing.totalWords"), value: kpis.totalWords.toLocaleString() },
    { label: t(kk.count), value: String(kpis.chapterCount) },
    { label: t(kk.group), value: String(kpis.volumeCount) },
    { label: t("editor.writing.stats.kpiSettings"), value: String(kpis.settingCount) },
    { label: t(kk.avg), value: String(kpis.avgWords) },
  ];

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 1.25, display: "flex", flexDirection: "column", gap: 0.75 }}>
      <Typography variant="caption" sx={{ fontWeight: 700 }} color="text.secondary">
        {t("writing.statsOverview")}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {cells.map((c) => (
          <Box key={c.label} sx={{ flex: "1 1 40%", border: 1, borderColor: "divider", borderRadius: 1, px: 1, py: 0.5 }}>
            <Typography sx={{ fontSize: 9.5, color: "text.secondary" }}>{c.label}</Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 700, color: "text.primary" }}>{c.value}</Typography>
          </Box>
        ))}
      </Box>
      {outliers.length > 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: "text.secondary" }}>
            {t("writing.statsOutlierTitle")} · {outliers.length}
          </Typography>
          {outliers.slice(0, 8).map((r) => (
            <Typography
              key={r.id}
              onClick={() => onJumpChapter?.(r.id, r.title)}
              sx={{
                fontSize: 10.5, color: "text.primary", cursor: onJumpChapter ? "pointer" : "default",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderRadius: 0.5,
                px: 0.5, "&:hover": onJumpChapter ? { bgcolor: "action.hover" } : {},
              }}
            >
              {r.outlier === "long" ? t("writing.statsOutlierLong") : t("writing.statsOutlierShort")} · {r.title} · {r.words.toLocaleString()}
            </Typography>
          ))}
        </Box>
      )}
      {bookChapters.length === 0 && (
        <Typography sx={{ fontSize: 10.5, color: "text.disabled" }}>{t("writing.statsPaneEmpty")}</Typography>
      )}
    </Box>
  );
}
