/**
 * AiInsightsPanel —— Agent 分析结论的展示方，闭合「扫描 → AI 分析 → 沉淀 → 人可见」。
 *
 * 为什么需要它：
 * 在此之前 Agent 的结论只存在于对话流里 —— 滚上去就找不到，换个会话就丢失，
 * 下一次分析也读不到，于是每次都从零重算、反复给同样的建议（既烧 token 又没有积累）。
 * 现在 Agent 用 `context_insight` 工具把结论写回 ai_insights 表，本面板负责把它们
 * 按严重度呈现出来，并让每条 refs（`文件:行号`）一点即跳到源码。
 *
 * 刷新时机：挂载时、分析切换时、以及 Agent 一次运行结束时（isStreaming 由 true → false，
 * 正是洞察落库的时刻）。这样用户不需要手动点刷新就能看到刚产出的结论。
 *
 * 数据来源：`insightOverlayStore`（而不是本地 useState）。因为洞察现在有两个
 * 消费方 —— 本列表和**画布上的角标**。两边各拉各的会出现「列表刷新了、画布还停在
 * 上一轮」的错位，那比不显示更容易误导人。收拢到一个 store 后，一次加载全员同步。
 *
 * 与其他模块的关系：本面板只消费 analysisId + ai_insights，不感知扫描细节。
 * 未来其他模块接入 AI 时沿用同一张表即可复用这里的展示。
 */
import { useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Collapse from "@mui/material/Collapse";
import CircularProgress from "@mui/material/CircularProgress";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import RefreshIcon from "@mui/icons-material/Refresh";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import PlaceIcon from "@mui/icons-material/Place";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import { useState } from "react";
import { useInsightOverlayStore } from "../store/insightOverlayStore";
import { useInsightOverlaySync } from "./useInsightOverlaySync";
import {
  SEVERITY_COLOR,
  SEVERITY_RANK,
  normalizeRefPath,
  normalizeSeverity,
  resolveMarkedPaths,
} from "./insightOverlay";
import { navigateToSourceByPath } from "../editor/utils/sourceNavigate";
import { highlightInCanvas } from "../editor/utils/canvasLink";
import { logger } from "../utils/logger";
import { normalizeFreshness } from "./insightReport";
import { aiContextApi } from "../services/tauri";
import { t } from "../i18n";

interface Props {
  /** 目标分析；不传则跟随当前激活分析 */
  analysisId?: string;
  /** 面板（右侧栏）模式：更紧凑的间距与字号 */
  compact?: boolean;
}

const KIND_LABEL: Record<string, string> = {
  finding: t("aiPanel.kind.finding"),
  recommendation: t("aiPanel.kind.recommendation"),
  risk: t("aiPanel.kind.risk"),
  summary: t("aiPanel.kind.summary"),
  roadmap: t("aiPanel.kind.roadmap"),
};

/**
 * 严重度取色/取名/排序统一走 insightOverlay 的归一化 —— 画布角标与本列表必须
 * 同源，否则同一条洞察在两处显示成不同颜色，用户会以为是两回事。
 * DTO 里的 severity 是自由字符串（历史行什么都有），这里归一后再查表。
 */
const sevColor = (raw: string) => SEVERITY_COLOR[normalizeSeverity(raw)];
const sevLabel = (raw: string) => t("severity." + normalizeSeverity(raw));
const sevRank = (raw: string) => SEVERITY_RANK[normalizeSeverity(raw)];

/**
 * 时效配色与判断。结论会随代码变化而失效——没有时效，沉淀就只会单调增长，
 * 改完的问题继续挂在面板上误导人，Agent 每轮还把已经不成立的结论重读一遍（烧 token）。
 * 这里把后端算好的 freshness 映射成面板能用的颜色，并抽出「待复核」判定（stale/orphaned）。
 */
const FRESHNESS_COLOR: Record<string, string> = {
  current: "#16a34a",
  stale: "#d97706",
  orphaned: "#64748b",
  unanchored: "#0891b2",
  unknown: "#94a3b8",
};

/** stale（证据变了）或 orphaned（证据没了）都意味着这条结论站不住了，必须复核 */
const isNeedsReview = (freshness?: string): boolean => {
  const f = normalizeFreshness(freshness);
  return f === "stale" || f === "orphaned";
};

/**
 * 把 Unix 秒级时间戳转成「x 天前 / x 小时前」式相对描述，用于展示一条结论的
 * 首次/最近确认时间。库里 first_seen / last_seen 是 strftime('%s','now') 的秒，
 * 所以这里用 Date.now()/1000 取当前秒做差。undefined / 0 一律回退「—」。
 */
const relTime = (ts?: number): string => {
  if (!ts || ts <= 0) return "—";
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diffSec < 60) return t("time.justNow");
  if (diffSec < 3600) return t("time.minutesAgo", { n: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return t("time.hoursAgo", { n: Math.floor(diffSec / 3600) });
  return t("time.daysAgo", { n: Math.floor(diffSec / 86400) });
};

export function AiInsightsPanel({ analysisId, compact = false }: Props) {
  const insights = useInsightOverlayStore((s) => s.insights);
  const loading = useInsightOverlayStore((s) => s.loading);
  const unresolved = useInsightOverlayStore((s) => s.unresolved);
  const canvasEnabled = useInsightOverlayStore((s) => s.canvasEnabled);
  const setCanvasEnabled = useInsightOverlayStore((s) => s.setCanvasEnabled);

  // 加载/刷新时机全部收在同步钩子里（画布也挂同一个钩子，store 内部按 scope 去重）
  const { scopeId, knownPaths, reload } = useInsightOverlaySync(analysisId);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** 时效筛选：全部 / 待复核(stale+orphaned) / 证据未变 / 无锚点 / 无从比对 / 已解决 */
  const [freshFilter, setFreshFilter] = useState<
    "all" | "review" | "current" | "unanchored" | "unknown" | "resolved"
  >("all");
  /** 正在填写收口理由的那一条（null = 没有在收口） */
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState("");
  const [resolving, setResolving] = useState(false);

  const sp = compact ? 1 : 1.5;
  const fs = (n: number) => (compact ? n - 1 : n);

  const load = useCallback(async () => {
    await reload();
  }, [reload]);

  /**
   * 已收口的结论从主视图退场：面板要回答的是「现在还有什么问题」，
   * 把已复核关闭的旧账混在里面，条数会越积越多，真正要处理的反而被淹没。
   * 它们不删除，只是移到「已解决」这一档里备查。
   */
  const openInsights = useMemo(
    () => insights.filter((i) => i.status !== "resolved"),
    [insights],
  );
  const resolvedInsights = useMemo(
    () => insights.filter((i) => i.status === "resolved"),
    [insights],
  );

  const sorted = useMemo(
    () =>
      [...openInsights].sort((a, b) => {
        const sev = sevRank(a.severity) - sevRank(b.severity);
        if (sev !== 0) return sev;
        // 同严重度内，被多次确认（结论稳定）的排前面，凸显可复用结论
        return (b.seenCount ?? 1) - (a.seenCount ?? 1);
      }),
    [openInsights],
  );

  const severityCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const i of openInsights) out[i.severity] = (out[i.severity] ?? 0) + 1;
    return out;
  }, [openInsights]);

  /** 时效分桶计数，供筛选标签展示——「待复核」把 stale/orphaned 合并为一档 */
  const freshCounts = useMemo(() => {
    const out = { review: 0, current: 0, unanchored: 0, unknown: 0 };
    for (const i of openInsights) {
      const f = normalizeFreshness(i.freshness);
      if (f === "stale" || f === "orphaned") out.review += 1;
      else out[f] += 1;
    }
    return out;
  }, [openInsights]);

  /** 按当前时效筛选后的可见列表（筛选只影响展示，不改变 severityCounts 等汇总） */
  const visible = useMemo(() => {
    if (freshFilter === "resolved") return resolvedInsights;
    if (freshFilter === "all") return sorted;
    if (freshFilter === "review") return sorted.filter((i) => isNeedsReview(i.freshness));
    return sorted.filter((i) => normalizeFreshness(i.freshness) === freshFilter);
  }, [sorted, resolvedInsights, freshFilter]);

  /**
   * 人工收口一条结论。理由必填——面板上一键关掉却说不出为什么，
   * 等于把问题扫到地毯下面，下一轮 Agent 还会原样再报一遍。
   * 关闭后重新拉取：画布角标、计数、筛选分桶必须同时更新，不能只改一处。
   */
  const submitResolve = useCallback(
    async (insightId: string) => {
      const reason = reasonDraft.trim();
      if (!scopeId || !reason || resolving) return;
      setResolving(true);
      try {
        await aiContextApi.resolveAiInsight(scopeId, insightId, reason);
        setResolvingId(null);
        setReasonDraft("");
        await reload();
      } catch (e) {
        logger.error("AiInsightsPanel", "resolve insight failed", { error: e, insightId });
      } finally {
        setResolving(false);
      }
    },
    [scopeId, reasonDraft, resolving, reload],
  );

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const jump = (ref: string) => {
    const { path, line } = normalizeRefPath(ref);
    const r = navigateToSourceByPath(path, line, t("aiPanel.insights.refLocateToast"));
    if (!r.opened) logger.warn("AiInsightsPanel", r.message);
  };

  /**
   * 在画布中定位这条洞察涉及的所有实体。
   *
   * 走的是与角标同一套路径解析，所以「这里能点亮的」与「画布上带 AI 药丸的」
   * 严格一致 —— 面板说有 3 个文件，画布上就恰好点亮那 3 张卡。
   */
  const locateOnCanvas = (refs: string[]) => {
    const { files, dirs } = resolveMarkedPaths(refs, knownPaths);
    const n = highlightInCanvas({ filePaths: files, dirPaths: dirs });
    if (n === 0) {
      logger.warn("AiInsightsPanel", "洞察涉及的实体尚未同步到画布", { refs });
    }
  };

  return (
    <Box sx={{ p: sp, display: "flex", flexDirection: "column", gap: sp }}>
      {/* 标题栏 */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box
          sx={{
            width: compact ? 24 : 30,
            height: compact ? 24 : 30,
            borderRadius: 1.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "rgba(234,179,8,0.12)",
            flexShrink: 0,
          }}
        >
          <LightbulbOutlinedIcon sx={{ fontSize: compact ? 16 : 18, color: "#ca8a04" }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: fs(13), fontWeight: 700, lineHeight: 1.2 }}>
            {t("aiPanel.insights.title")}
          </Typography>
          <Typography sx={{ fontSize: fs(10), color: "text.secondary" }}>
            {insights.length > 0
              ? `${t("aiPanel.insights.pending", { n: openInsights.length })}` +
                (resolvedInsights.length > 0
                  ? ` · ${t("aiPanel.insights.resolved", { n: resolvedInsights.length })}`
                  : "")
              : t("aiPanel.insights.empty")}
          </Typography>
        </Box>
        <Tooltip
          title={
            canvasEnabled
              ? t("aiPanel.insights.canvasOn")
              : t("aiPanel.insights.canvasOff")
          }
        >
          <Switch
            size="small"
            checked={canvasEnabled}
            onChange={(e) => setCanvasEnabled(e.target.checked)}
          />
        </Tooltip>
        <Tooltip title={t("aiPanel.insights.refresh")}>
          <span>
            <IconButton size="small" onClick={() => void load()} disabled={loading || !scopeId}>
              {loading ? <CircularProgress size={14} /> : <RefreshIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* 严重度分布 */}
      {insights.length > 0 && (
        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
          {Object.entries(severityCounts)
            .sort((a, b) => sevRank(a[0]) - sevRank(b[0]))
            .map(([sev, n]) => (
              <Chip
                key={sev}
                size="small"
                label={`${sevLabel(sev)} ${n}`}
                sx={{
                  height: 18,
                  fontSize: fs(10),
                  fontWeight: 600,
                  color: sevColor(sev),
                  bgcolor: `${sevColor(sev)}1f`,
                  border: "none",
                }}
              />
            ))}
        </Box>
      )}

      {/* 时效筛选：把「待复核 / 证据未变 / 无锚点 / 无从比对」做成可点的标签，
          让面板不只是罗列——用户一键就能从几百条结论里捞出「现在还站得住的」与「要复核的」。
          计数与严重度分布独立，筛选只影响展示，不影响汇总口径。 */}
      {insights.length > 0 && (
        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
          {(
            [
              { key: "all" as const, label: t("aiPanel.filter.all"), count: openInsights.length, color: undefined },
              { key: "review" as const, label: t("aiPanel.filter.review"), count: freshCounts.review, color: "#d97706" },
              { key: "current" as const, label: t("aiPanel.filter.current"), count: freshCounts.current, color: "#16a34a" },
              { key: "unanchored" as const, label: t("aiPanel.filter.unanchored"), count: freshCounts.unanchored, color: "#0891b2" },
              { key: "unknown" as const, label: t("aiPanel.filter.unknown"), count: freshCounts.unknown, color: "#94a3b8" },
              { key: "resolved" as const, label: t("aiPanel.filter.resolved"), count: resolvedInsights.length, color: "#16a34a" },
            ] as const
          ).map((f) => {
            const active = freshFilter === f.key;
            const color = f.color ?? "text.secondary";
            return (
              <Tooltip
                key={f.key}
                title={
                  f.key === "all"
                    ? t("aiPanel.filter.allTip")
                    : f.key === "resolved"
                      ? t("aiPanel.filter.resolvedTip")
                      : t("aiPanel.filter.only", { label: f.label })
                }
              >
                <Chip
                  size="small"
                  label={`${f.label} ${f.count}`}
                  onClick={() => setFreshFilter(f.key)}
                  sx={{
                    height: 18,
                    fontSize: fs(10),
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                    color: active ? color : "text.secondary",
                    bgcolor: active && f.color ? `${color}1f` : "transparent",
                    border: active ? "none" : "1px solid",
                    borderColor: active ? "transparent" : "divider",
                  }}
                />
              </Tooltip>
            );
          })}
        </Box>
      )}

      {/* 对不上号的引用：宁可显式说明，也不要让用户以为角标漏标了。
          常见原因是模型写了 `index.ts` 这类项目里有几十份的名字（歧义时一律不标）。 */}
      {unresolved.length > 0 && (
        <Tooltip title={`${t("aiPanel.insights.unresolvedTip")}\n${unresolved.slice(0, 12).join("\n")}`}>
          <Typography sx={{ fontSize: fs(9), color: "text.disabled", cursor: "help" }}>
            {t("aiPanel.insights.unresolvedCount", { n: unresolved.length })}
          </Typography>
        </Tooltip>
      )}

      {/* 筛选后无结果 */}
      {visible.length === 0 && insights.length > 0 && !loading && (
        <Typography
          sx={{ fontSize: fs(10), color: "text.disabled", lineHeight: 1.5, textAlign: "center", py: 1 }}
        >
          {t("aiPanel.insights.filterEmpty")}
        </Typography>
      )}

      {/* 空态 */}
      {insights.length === 0 && !loading && (
        <Typography
          sx={{ fontSize: fs(10), color: "text.disabled", lineHeight: 1.5, textAlign: "center", py: 1 }}
        >
          {scopeId
            ? t("aiPanel.insights.empty")
            : t("aiPanel.insights.emptyNoScope")}
        </Typography>
      )}

      {/* 洞察列表 */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        {visible.map((ins) => {
          const open = expanded.has(ins.id);
          const color = sevColor(ins.severity);
          return (
            <Box
              key={ins.id}
              sx={{
                borderRadius: 1.5,
                border: 1,
                borderColor: "divider",
                borderLeft: `3px solid ${color}`,
                overflow: "hidden",
                transition: "border-color 0.15s",
                // 已收口的条目整体压暗：它只是备查记录，不该和待处理项抢注意力
                opacity: ins.status === "resolved" ? 0.55 : 1,
                "&:hover": { borderColor: color, opacity: 1 },
              }}
            >
              {/* 标题行 */}
              <Box
                onClick={() => toggle(ins.id)}
                sx={{
                  px: 1,
                  py: 0.75,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 0.5,
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                {open ? (
                  <ExpandMoreIcon sx={{ fontSize: 16, mt: 0.1, opacity: 0.6, flexShrink: 0 }} />
                ) : (
                  <ChevronRightIcon sx={{ fontSize: 16, mt: 0.1, opacity: 0.6, flexShrink: 0 }} />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: fs(12), fontWeight: 600, lineHeight: 1.35 }}>
                    {ins.title}
                  </Typography>
                  <Box sx={{ display: "flex", gap: 0.5, alignItems: "center", mt: 0.25, flexWrap: "wrap" }}>
                    <Typography sx={{ fontSize: fs(9), fontWeight: 700, color }}>
                      {sevLabel(ins.severity)}
                    </Typography>
                    <Typography sx={{ fontSize: fs(9), color: "text.disabled" }}>
                      · {KIND_LABEL[ins.kind] ?? ins.kind}
                    </Typography>
                    {ins.refs.length > 0 && (
                      <Typography sx={{ fontSize: fs(9), color: "text.disabled" }}>
                        · {t("aiPanel.insights.refPositions", { n: ins.refs.length })}
                      </Typography>
                    )}
                    {ins.freshness && ins.freshness !== "unknown" && (
                      <Tooltip title={t("aiPanel.freshness." + normalizeFreshness(ins.freshness))}>
                        <Typography
                          sx={{
                            fontSize: fs(9),
                            fontWeight: 700,
                            color: FRESHNESS_COLOR[normalizeFreshness(ins.freshness)],
                            bgcolor: `${FRESHNESS_COLOR[normalizeFreshness(ins.freshness)]}1f`,
                            px: 0.5,
                            borderRadius: 0.5,
                          }}
                        >
                          {t("aiPanel.freshness." + normalizeFreshness(ins.freshness))}
                        </Typography>
                      </Tooltip>
                    )}
                    {ins.seenCount && ins.seenCount > 1 && (
                      <Tooltip title={t("aiPanel.insights.confirmedTip")}>
                        <Typography
                          sx={{
                            fontSize: fs(9),
                            fontWeight: 700,
                            color: "#0ea5e9",
                            bgcolor: "rgba(14,165,233,0.12)",
                            px: 0.5,
                            borderRadius: 0.5,
                          }}
                        >
                          {t("aiPanel.insights.confirmedTimes", { n: ins.seenCount })}
                        </Typography>
                      </Tooltip>
                    )}
                    {ins.seenCount && ins.seenCount > 1 && (
                      <Typography sx={{ fontSize: fs(8), color: "text.disabled" }}>
                        {t("aiPanel.insights.stableLine", {
                          first: relTime(ins.firstSeen),
                          last: relTime(ins.lastSeen),
                        })}
                      </Typography>
                    )}
                  </Box>
                </Box>
              </Box>

              {/* 正文 + 位置引用 */}
              <Collapse in={open} unmountOnExit>
                <Box sx={{ px: 1, pb: 1, pl: 3 }}>
                  <Typography
                    sx={{
                      fontSize: fs(11),
                      color: "text.secondary",
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {ins.body}
                  </Typography>
                  {ins.changedRefs && ins.changedRefs.length > 0 && (
                    <Box sx={{ mt: 0.5 }}>
                      <Typography sx={{ fontSize: fs(9), fontWeight: 600, color: FRESHNESS_COLOR.stale }}>
                        {t("aiPanel.insights.evidenceChanged")}
                      </Typography>
                      <Tooltip title={ins.changedRefs.join("\n")}>
                        <Typography sx={{ fontSize: fs(9), color: "text.secondary", fontFamily: "monospace", wordBreak: "break-all" }}>
                          {ins.changedRefs.slice(0, 3).join(", ")}
                          {ins.changedRefs.length > 3
                            ? t("aiPanel.insights.morePlaces", { n: ins.changedRefs.length })
                            : ""}
                        </Typography>
                      </Tooltip>
                    </Box>
                  )}
                  {ins.missingRefs && ins.missingRefs.length > 0 && (
                    <Box sx={{ mt: 0.5 }}>
                      <Typography sx={{ fontSize: fs(9), fontWeight: 600, color: FRESHNESS_COLOR.orphaned }}>
                        {t("aiPanel.insights.evidenceGone")}
                      </Typography>
                      <Tooltip title={ins.missingRefs.join("\n")}>
                        <Typography sx={{ fontSize: fs(9), color: "text.secondary", fontFamily: "monospace", wordBreak: "break-all" }}>
                          {ins.missingRefs.slice(0, 3).join(", ")}
                          {ins.missingRefs.length > 3
                            ? t("aiPanel.insights.morePlaces", { n: ins.missingRefs.length })
                            : ""}
                        </Typography>
                      </Tooltip>
                    </Box>
                  )}
                  {ins.refs.length > 0 && (
                    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 0.75 }}>
                      {/* 先给一个「整条洞察 → 画布」的入口：逐个 ref 跳源码是「看细节」，
                          这个是「看全局位置」—— 一次把这条结论涉及的实体全框进视野 */}
                      <Tooltip title={t("aiPanel.insights.locateCanvasTip")}>
                        <Chip
                          size="small"
                          icon={<MyLocationIcon sx={{ fontSize: 12 }} />}
                          label={t("aiPanel.insights.locateCanvas")}
                          onClick={() => locateOnCanvas(ins.refs)}
                          sx={{
                            height: 20,
                            fontSize: fs(10),
                            fontWeight: 600,
                            cursor: "pointer",
                            color,
                            bgcolor: `${color}1f`,
                            "& .MuiChip-label": { px: 0.75 },
                            "& .MuiChip-icon": { color },
                          }}
                        />
                      </Tooltip>
                      {ins.refs.map((ref) => (
                        <Tooltip key={ref} title={t("aiPanel.insights.openSourceTip")}>
                          <Chip
                            size="small"
                            icon={<PlaceIcon sx={{ fontSize: 12 }} />}
                            label={ref}
                            onClick={() => jump(ref)}
                            sx={{
                              height: 20,
                              fontSize: fs(10),
                              fontFamily: "monospace",
                              maxWidth: "100%",
                              cursor: "pointer",
                              "& .MuiChip-label": { px: 0.75 },
                            }}
                          />
                        </Tooltip>
                      ))}
                    </Box>
                  )}

                  {/* 收口区。结论的终点必须由人也能按下——Agent 未必跑得及时，
                      而「我刚改完这个」这句话，最有资格说的是人。
                      理由必填（后端同样强校验）：没有依据的关闭只是把问题藏起来。 */}
                  {ins.status === "resolved" ? (
                    <Box sx={{ mt: 0.75 }}>
                      <Typography sx={{ fontSize: fs(9), fontWeight: 700, color: "#16a34a" }}>
                        {t("aiPanel.insights.resolvedAt", { time: relTime(ins.resolvedAt) })}
                        {ins.resolvedBy
                          ? t("aiPanel.insights.resolvedBy", { name: ins.resolvedBy })
                          : ""}
                      </Typography>
                      <Typography sx={{ fontSize: fs(10), color: "text.secondary", lineHeight: 1.5 }}>
                        {ins.resolvedReason || t("aiPanel.insights.noReason")}
                      </Typography>
                    </Box>
                  ) : resolvingId === ins.id ? (
                    <Box sx={{ mt: 0.75, display: "flex", gap: 0.5, alignItems: "flex-start" }}>
                      <TextField
                        size="small"
                        autoFocus
                        fullWidth
                        multiline
                        maxRows={3}
                        placeholder={t("aiPanel.insights.resolvePlaceholder")}
                        value={reasonDraft}
                        onChange={(e) => setReasonDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            void submitResolve(ins.id);
                          }
                          if (e.key === "Escape") setResolvingId(null);
                        }}
                        slotProps={{
                          htmlInput: { style: { fontSize: fs(11) } },
                        }}
                      />
                      <Button
                        size="small"
                        variant="contained"
                        disabled={!reasonDraft.trim() || resolving}
                        onClick={() => void submitResolve(ins.id)}
                        sx={{ fontSize: fs(10), minWidth: 52, whiteSpace: "nowrap" }}
                      >
                        {t("aiPanel.insights.confirmBtn")}
                      </Button>
                      <Button
                        size="small"
                        onClick={() => setResolvingId(null)}
                        sx={{ fontSize: fs(10), minWidth: 40 }}
                      >
                        {t("ui.cancel")}
                      </Button>
                    </Box>
                  ) : (
                      <Tooltip title={t("aiPanel.insights.markResolvedTip")}>
                        <Chip
                          size="small"
                          icon={<TaskAltIcon sx={{ fontSize: 12 }} />}
                          label={t("aiPanel.insights.markResolved")}
                        onClick={() => {
                          setResolvingId(ins.id);
                          setReasonDraft("");
                        }}
                        sx={{
                          mt: 0.75,
                          height: 20,
                          fontSize: fs(10),
                          fontWeight: 600,
                          cursor: "pointer",
                          color: "#16a34a",
                          bgcolor: "rgba(22,163,74,0.12)",
                          "& .MuiChip-label": { px: 0.75 },
                          "& .MuiChip-icon": { color: "#16a34a" },
                        }}
                      />
                    </Tooltip>
                  )}
                </Box>
              </Collapse>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export default AiInsightsPanel;
