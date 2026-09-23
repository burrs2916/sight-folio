// sight-folio: 全书总览仪表盘（右栏「要素」tab 默认 · 书场景无选中态）
//
// 设计立场（与右栏其它 Overview 卡一致）：只读、可行动、零第二份事实。
// 数据 100% 来自 utils/writingOverview.buildBookOverview（与 AI 全书语料同一口径），
// 不在这里重算任何 KPI / 冲突 / 预警。
//
// 责任：
//   ① KPI 网格一眼读完全书体量；
//   ② 九大题材维度「导航 chip」——点击直接 openTypedCarrierView 跳到对应 L2 编辑面；
//   ③ 风险预警行（时间线冲突 / 跨章伏笔 / 孤立设定 / 未落章节拍 / 校对问题）可点直达。
// 内容编辑在编辑区（L2 题材编辑面），这里只做协调总览 + 出口，不做第二个编辑器。
import { useMemo, useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useWritingStore } from "../../store/writingStore";
import { buildBookOverview } from "../../utils/writingOverview";
import { openTypedCarrierView, type WritingViewKind } from "../../utils/studioBook";
import { writingStatsApi, type WritingDailyStat } from "../../services/tauri";
import { diffDailyStats, WINDOW_DAYS } from "../../utils/writingStats";
import { t } from "../../i18n";

/** 九大题材维度导航 chip（点击跳对应 L2 编辑面）。value = 该维度头条计数。 */
const DIMENSIONS: { kind: WritingViewKind; valueKey: keyof ReturnType<typeof pickValue> }[] = [
  { kind: "catalog", valueKey: "chapters" },
  { kind: "characters", valueKey: "characters" },
  { kind: "worldview", valueKey: "worldviews" },
  { kind: "timeline", valueKey: "timelineEvents" },
  { kind: "storylines", valueKey: "storylines" },
  { kind: "foreshadowing", valueKey: "foreshadowPending" },
  { kind: "inspiration", valueKey: "looseBeats" },
  { kind: "proofread", valueKey: "proofreadIssues" },
  { kind: "stats", valueKey: "totalWords" },
  { kind: "writing", valueKey: "chapters" },
];

function pickValue(o: ReturnType<typeof buildBookOverview>) {
  return {
    chapters: o.kpis.chapterCount,
    characters: o.characters,
    worldviews: o.worldviews,
    timelineEvents: o.timeline.events,
    storylines: o.storylines,
    foreshadowPending: o.foreshadowings.pending,
    looseBeats: o.looseBeats,
    proofreadIssues: o.proofread.issues,
    totalWords: o.kpis.totalWords,
  };
}

export function BookOverviewPanel({ bookId }: { bookId: string }) {
  const chapters = useWritingStore((s) => s.chapters);
  const settings = useWritingStore((s) => s.settings);
  const outlines = useWritingStore((s) => s.outlines);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const storylines = useWritingStore((s) => s.storylines);
  const foreshadows = useWritingStore((s) => s.foreshadowings);
  const books = useWritingStore((s) => s.books);
  const bookTitle = useWritingStore((s) => s.books.find((b) => b.id === bookId)?.title ?? null);

  const overview = useMemo(
    () =>
      buildBookOverview({
        bookTitle,
        chapters: chapters.filter((c) => c.bookId === bookId),
        settings: settings.filter((s) => s.bookId === bookId),
        outlines: outlines.filter((o) => o.bookId === bookId),
        timelineEvents: timelineEvents.filter((e) => e.bookId === bookId),
        storylines: storylines.filter((l) => l.bookId === bookId),
        foreshadowings: foreshadows.filter((f) => f.bookId === bookId),
      }),
    [bookTitle, chapters, settings, outlines, timelineEvents, storylines, foreshadows, bookId],
  );

  const genre = useMemo(() => books.find((b) => b.id === bookId)?.genre ?? "novel", [books, bookId]);
  const jump = (kind: WritingViewKind) => openTypedCarrierView(genre, kind);
  const values = pickValue(overview);

  // 日更趋势迷你图：复用统计页签口径（Rust 落库快照差分），纯展示、零新表、零 Rust 命令。
  const [trendStats, setTrendStats] = useState<WritingDailyStat[] | null>(null);
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    setTrendStats(null);
    writingStatsApi
      .listDailyStats(bookId, WINDOW_DAYS + 1)
      .then((rows) => { if (!cancelled) setTrendStats(rows); })
      .catch(() => { if (!cancelled) setTrendStats([]); });
    return () => { cancelled = true; };
  }, [bookId]);
  const trendDeltas = useMemo(() => (trendStats ? diffDailyStats(trendStats, new Date()).slice(-14) : []), [trendStats]);
  const trendMax = Math.max(1, ...trendDeltas.map((d) => d.delta));
  const trendTotal = trendDeltas.reduce((sum, d) => sum + d.delta, 0);
  const trendToday = trendDeltas.length ? trendDeltas[trendDeltas.length - 1].delta : 0;
  const TREND_N = trendDeltas.length || 1;
  const TREND_W = 280;
  const TREND_H = 34;
  const TREND_PAD = 1.5;

  const warnings = ([
    { kind: "timeline", label: t("writing.overviewWarn.timelineConflict"), count: overview.timeline.conflicts },
    { kind: "foreshadowing", label: t("writing.overviewWarn.foreshadowOverdue"), count: overview.foreshadowings.overdue },
    { kind: "characters", label: t("writing.overviewWarn.orphanSetting"), count: overview.settingOrphan },
    { kind: "inspiration", label: t("writing.overviewWarn.looseBeat"), count: overview.looseBeats },
    { kind: "proofread", label: t("writing.overviewWarn.proofread"), count: overview.proofread.issues },
  ] as { kind: WritingViewKind; label: string; count: number }[]).filter((w) => w.count > 0);

  const kpiCells: { label: string; value: string }[] = [
    { label: t("writing.totalWords"), value: overview.kpis.totalWords.toLocaleString() },
    { label: t("writing.chapterCount"), value: String(overview.kpis.chapterCount) },
    { label: t("editor.writing.stats.kpiVolumes"), value: String(overview.kpis.volumeCount) },
    { label: t("editor.writing.stats.kpiSettings"), value: String(overview.kpis.settingCount) },
    { label: t("editor.writing.stats.kpiAvg"), value: String(overview.kpis.avgWords) },
  ];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
        {bookTitle ?? t("editor.writing.inspector.book")}
      </Typography>

      {/* KPI 网格 */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {kpiCells.map((c) => (
          <Box key={c.label} sx={{ flex: "1 1 40%", border: 1, borderColor: "divider", borderRadius: 1, px: 1, py: 0.5 }}>
            <Typography sx={{ fontSize: 9.5, color: "text.secondary" }}>{c.label}</Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 700, color: "text.primary" }}>{c.value}</Typography>
          </Box>
        ))}
      </Box>

      {/* 日更趋势迷你图（近 14 天日增，复用统计页签口径） */}
      <Box>
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: "text.secondary", mb: 0.4 }}>
          {t("writing.overviewTrend")} · {trendTotal.toLocaleString()} · {t("writing.todayProgress", { n: trendToday.toLocaleString() })}
        </Typography>
        {trendDeltas.length > 0 ? (
          <Box
            component="svg"
            viewBox={`0 0 ${TREND_W} ${TREND_H}`}
            sx={{ width: "100%", height: TREND_H, color: "primary.main", display: "block" }}
            preserveAspectRatio="none"
          >
            {trendDeltas.map((d, i) => {
              const bw = (TREND_W - TREND_PAD * (TREND_N - 1)) / TREND_N;
              const bh = Math.max(1.5, (d.delta / trendMax) * (TREND_H - 2));
              const x = i * (bw + TREND_PAD);
              const y = TREND_H - bh;
              return (
                <rect
                  key={d.day}
                  x={x}
                  y={y}
                  width={bw}
                  height={bh}
                  rx={0.6}
                  fill="currentColor"
                  opacity={d.delta === 0 ? 0.22 : 0.85}
                />
              );
            })}
          </Box>
        ) : (
          <Typography sx={{ fontSize: 9.5, color: "text.disabled", lineHeight: 1.6 }}>{t("writing.noStats")}</Typography>
        )}
      </Box>

      {/* 九大题材维度导航 */}
      <Box>
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: "text.secondary", mb: 0.4 }}>
          {t("writing.overviewDimensions")}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {DIMENSIONS.map((d) => (
            <Chip
              key={d.kind}
              size="small"
              clickable
              onClick={() => jump(d.kind)}
              label={`${t(`writing.viewKind.${d.kind}`)} · ${values[d.valueKey]}`}
              sx={{ fontSize: 10, height: 22 }}
            />
          ))}
        </Box>
      </Box>

      {/* 风险预警（可点直达） */}
      {warnings.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: "warning.main", mb: 0.4, display: "flex", alignItems: "center", gap: 0.25 }}>
            <WarningAmberIcon sx={{ fontSize: 13 }} />
            {t("writing.overviewWarnings")} · {warnings.length}
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            {warnings.map((w) => (
              <Chip
                key={w.kind + w.label}
                size="small"
                clickable
                color="warning"
                variant="outlined"
                onClick={() => jump(w.kind)}
                label={`${w.label} · ${w.count}`}
                sx={{ fontSize: 10, height: 22, justifyContent: "flex-start", alignSelf: "flex-start" }}
              />
            ))}
          </Box>
        </Box>
      )}

      <Divider />

      <Typography sx={{ fontSize: 10.5, color: "text.disabled", lineHeight: 1.7 }}>
        {t("editor.writing.inspector.readOnlyNote")}
      </Typography>
    </Box>
  );
}
