/**
 * FocusReportPanel —— 多维共振（焦点目标）报告，给**人**看的那一份。
 *
 * 为什么必须有这块 UI
 * ------------------
 * riskMatrix 分节已经把「跨维度全量共振」交给 AI 了：它替 Agent 把 hotspots / review /
 * clones / techDebt / coupling / deadCode 在截断之前就交叉过，给出头号重构目标。
 * 但那张表只存在于上下文包里，人看不到——于是会出现最糟的情况：
 * Agent 把 quiet.ts 列为头号重构目标，人却在任何一处 UI 都找不到它，自然也不会去改它。
 *
 * 这块面板直接复用同一个 computeRiskCorrelation 结果（经 describeFocus），
 * 把「给 Agent 的 Markdown 分节」翻译成「给人读的表格」：人和 AI 看到的是同一份结论，
 * 同一个文件、同样的名次、同样的综合分，不会因为 Top-N 截断而各看各的。
 *
 * 模块无关
 * --------
 * 本组件只认 AiContextProvider.describeFocus 这一个协议方法，
 * 不认识扫描/画布/报告任何具体模块。未来任意模块实现该方法后，把 moduleId 传进来即可复用，
 * 这里零改动；未实现的模块静默不渲染。文件行点击通过可选的 onSelectFile 回调传出，
 * 由调用方决定怎么跳转（扫描模块接 navigateToSourceByPath，其他模块各接各的），
 * 面板本身不与任何导航逻辑耦合。
 */
import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Tooltip from "@mui/material/Tooltip";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import { aiContextRegistry } from "./contextRegistry";
import { useProjectStore } from "../store/projectStore";
import { useAgentStore } from "../store/agentStore";
import { useInsightOverlayStore } from "../store/insightOverlayStore";
import { useInsightOverlaySync } from "./useInsightOverlaySync";
import { buildInsightMarks, SEVERITY_COLOR, normalizeSeverity } from "./insightOverlay";
import { summarizeFocusCoverage } from "./focusCoverage";
import { buildInsightFeedback } from "./insightFeedback";
import { loadEntityRegression } from "./entityRegression";
import { buildRegressionFeedback } from "./regressionFocus";
import type { AiEntityRegressionReport } from "./contextTypes";
import { aiContextApi } from "../services/tauri";
import type { AiFocusAssignmentDto } from "../services/tauri";
import {
  planFocusPatrol,
  summarizeFocusPatrol,
  type FocusPatrolRow,
  type FocusPatrolState,
} from "./focusPatrol";
import { t as T, getLang } from "../i18n";

interface Props {
  /** 供给者模块 id，如 "project-scan" */
  moduleId: string;
  /** 作用域 id（扫描模块 = analysisId）；为空则不渲染 */
  scopeId?: string;
  compact?: boolean;
  /** 共振行数上限（默认 15，与 Agent 侧 riskMatrix 的 Top-N 一致） */
  topN?: number;
  /** 点击共振文件时回调（如跳转到源码）；不传则文件行不可点击 */
  onSelectFile?: (filePath: string) => void;
}

/** 共振色阶：共振维度数越高越刺眼，它代表「越不依赖权重的硬信号」 */
function resonanceColor(n: number): string {
  if (n >= 4) return "#ef4444";
  if (n === 3) return "#f97316";
  if (n === 2) return "#f59e0b";
  return "#94a3b8";
}

/**
 * 巡查派单状态色：never（红，最该被点名却从没点过）→ failed（红，点了名但那轮没跑成）
 * → recheck（紫，看过了但结论的依据已经变了）→ stale-data（琥珀，数据已变值得复巡）
 * → patrolled（绿，已巡查且数据未变）。
 *
 * failed 与 never 同色是刻意的：对用户而言两者是同一件事——这个文件实际上没被看过。
 * 区别只在文案，而文案会说清楚「派过单但对话失败」。
 *
 * recheck 单独给一个色系（而不是复用红或琥珀）是因为它在语义上属于**另一类**问题：
 * 前两者说的是「这里还没被看过」，recheck 说的是「这里被看过，但那个结论现在可能是错的」。
 * 一条过期的高危结论比一处空白更危险——空白只是没人看，过期结论会持续误导人和后续每一轮
 * Agent。若把它归进绿色的「已巡查」，UI 上就会显示为一切正常，这正是本次要消灭的盲区。
 *
 * regressed 取橙色，排在红与琥珀之间，构成一条「没看过 → 刚变坏 → 数据变了 → 已巡查」的
 * 严重度梯度。它同样绝不能落进绿色分支：一个昨天还好好的文件今天劣化了 60%，
 * 在面板上显示成「已巡查」是最误导人的一种正常——而且**下次扫描之后就再也看不到了**。
 */
function patrolColor(state: FocusPatrolState): string {
  if (state === "never" || state === "failed") return "#ef4444";
  if (state === "recheck") return "#a855f7";
  if (state === "regressed") return "#f97316";
  if (state === "stale-data") return "#f59e0b";
  return "#22c55e";
}

/**
 * 标题栏那一格该用哪个状态的颜色：按「问题严重程度」而不是「数量多少」取，
 * 否则 1 个从未巡查 + 9 个已巡查会因为绿色占多数而显示成一切正常。
 *
 * 次序与派单队列保持一致（failed/never > recheck > regressed），
 * 否则标题栏说的「最要紧的是这一类」和下面实际先派的单会是两回事。
 */
function patrolHeadState(stat: {
  never: number;
  failed: number;
  recheck: number;
  regressed?: number;
}): FocusPatrolState {
  if (stat.never > 0 || stat.failed > 0) return "never";
  if (stat.recheck > 0) return "recheck";
  if ((stat.regressed ?? 0) > 0) return "regressed";
  return "patrolled";
}

/** 巡查派单状态文案 */
function patrolLabel(state: FocusPatrolState): string {
  return T("aiPanel.patrol." + (state === "stale-data" ? "staleData" : state));
}

export function FocusReportPanel({ moduleId, scopeId, compact = false, topN = 15, onSelectFile }: Props) {
  const [open, setOpen] = useState(false);

  // 订阅扫描数据本身，重扫后焦点目标要跟着变（与 ContextQualityPanel 同口径）
  const files = useProjectStore((s) => s.files);
  const activeAnalysisId = useProjectStore((s) => s.activeAnalysisId);

  const report = useMemo(() => {
    if (!scopeId) return null;
    const provider = aiContextRegistry.get(moduleId);
    if (!provider?.describeFocus) return null;
    try {
      return provider.describeFocus(scopeId);
    } catch {
      // 焦点计算本身出问题绝不能拖垮整个面板
      return null;
    }
    // files / activeAnalysisId 是重算触发器
    // getLang() 是文案触发器：切语言后 label/unit 要跟着刷新
  }, [moduleId, scopeId, files, activeAnalysisId, getLang()]);

  // 洞察数据自取自用：本面板可能在洞察面板未挂载的页面上出现，
  // 靠别的组件顺带加载就会时有时无。store 按 scope 幂等，多挂一次不会多查一次库。
  const { knownPaths } = useInsightOverlaySync(scopeId);
  const insights = useInsightOverlayStore((s) => s.insights);

  // 刻意用 info 级而不是画布阈值：画布默认只标 medium 以上，
  // 用那份口径算覆盖会把「AI 看过、判定为 low」显示成「无人分析」，结论正好反了。
  const coverage = useMemo(
    () => buildInsightMarks(insights, knownPaths, { minSeverity: "info" }).files,
    [insights, knownPaths],
  );

  // 焦点巡查派单台账：让「自动化有没有真的去看这个头号目标」这件事可见。
  // 与自动化编排同源同口径——用 planFocusPatrol 把派单记录与共振榜交叉，
  // 给出 never / stale-data / patrolled 三态 + 累计点名次数。不读这张表，
  // 用户永远无从知道头号目标是否只是「在上下文里出现过」却没有被 Agent 真正巡查过。
  const [assignments, setAssignments] = useState<AiFocusAssignmentDto[]>([]);
  // isStreaming 进依赖是为了「跑完就变色」：派单在**发起时**落库（true 的那一刻已经有了），
  // 洞察在**结束时**落库（false 的那一刻才有）。两个时点都刷一次，用户点完「立即检查」
  // 不用手动切页面就能看到目标从「从未巡查」翻成「已巡查」，否则会以为点名根本没生效。
  const isStreaming = useAgentStore((s) => s.isStreaming);
  useEffect(() => {
    if (!scopeId) return;
    let alive = true;
    aiContextApi
      .listFocusAssignments(moduleId, scopeId)
      .then((rows) => {
        if (alive) setAssignments(rows);
      })
      .catch(() => {
        /* 派单表读不到就当作「从未巡查」，面板不因此崩溃 */
      });
    return () => {
      alive = false;
    };
  }, [moduleId, scopeId, isStreaming]);

  const aiContextDigest = useProjectStore((s) => s.aiContextDigest);
  // 只有面板针对的正是当前装载的 analysis 时，store 缓存的指纹才对得上；
  // 否则传空（退化为「有派单即算已巡查」，不判 stale-data），避免用错指纹误报「数据已变」。
  const currentDigest = scopeId && scopeId === activeAnalysisId ? aiContextDigest : "";

  // 洞察回流：把 AI 自己的结论翻译成「哪些目标欠一次复核」，与自动化编排同源同口径。
  // available 必须跟 loadedScope 走而不是「insights 是否为空」——数据还在飞的那一瞬间
  // 列表天然是空的，若此时判 available=true，一个真正欠复核的文件会被算成 patrolled
  // 而显示成绿色「已巡查」，恰好是最不该出现的那种误报。
  const loadedScope = useInsightOverlayStore((s) => s.loadedScope);
  const feedback = useMemo(
    () => buildInsightFeedback(insights, { available: !!scopeId && loadedScope === scopeId }),
    [insights, loadedScope, scopeId],
  );

  // 回归观测：把「这一轮谁变坏了」也接进台账，与自动化编排同源同口径。
  //
  // 用 load（异步读库）而不是 read（同步读缓存）：本面板完全可能出现在趋势面板
  // 从未挂载过的页面上，靠缓存会时有时无 —— 而一个「时有时无的严重度标记」
  // 比彻底没有更糟：用户看到绿色就以为没事，换个页面又变橙色，从此不信这块面板。
  const [regressionReport, setRegressionReport] = useState<AiEntityRegressionReport | null>(null);
  useEffect(() => {
    if (!scopeId) {
      setRegressionReport(null);
      return;
    }
    let alive = true;
    loadEntityRegression(moduleId, scopeId)
      .then((r) => {
        if (alive) setRegressionReport(r);
      })
      .catch(() => {
        /* 读不到就退回「没有回归观测」，判定与本特性上线前逐字节一致 */
      });
    return () => {
      alive = false;
    };
    // files / activeAnalysisId 是重扫触发器：新快照落库后要立刻反映到台账上
  }, [moduleId, scopeId, activeAnalysisId, files]);

  const regression = useMemo(
    () => buildRegressionFeedback(regressionReport),
    [regressionReport],
  );

  const patrol = useMemo(() => {
    if (!report) return { byPath: new Map<string, FocusPatrolRow>(), stat: null };
    const plan = planFocusPatrol(report.targets, assignments, {
      currentDigest,
      nowSec: Math.floor(Date.now() / 1000),
      feedback,
      regression,
    });
    return {
      byPath: new Map(plan.rows.map((r) => [r.filePath, r])),
      stat: summarizeFocusPatrol(plan.rows),
    };
  }, [report, assignments, currentDigest, feedback, regression]);
  const patrolByPath = patrol.byPath;

  const fs = (n: number) => (compact ? n - 1 : n);
  const targets = useMemo(() => report?.targets.slice(0, topN) ?? [], [report, topN]);
  const gap = useMemo(() => summarizeFocusCoverage(targets, coverage), [targets, coverage]);

  if (!report || targets.length === 0) return null;

  const clickable = typeof onSelectFile === "function";

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1.5,
        overflow: "hidden",
      }}
    >
      {/* 折叠头：一眼看清「这次扫描指向哪些头号目标」 */}
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          px: 1,
          py: 0.75,
          cursor: "pointer",
          userSelect: "none",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        {open ? (
          <ExpandMoreIcon sx={{ fontSize: 16, color: "text.disabled" }} />
        ) : (
          <ChevronRightIcon sx={{ fontSize: 16, color: "text.disabled" }} />
        )}
        <HubOutlinedIcon sx={{ fontSize: 15, color: "primary.main" }} />
        <Typography sx={{ fontSize: fs(12), fontWeight: 600, flex: 1 }}>
          {T("aiPanel.focus.title")}
        </Typography>
        <Tooltip
          title={T("aiPanel.focus.resonantTip", { scored: report.scoredFiles, resonant: report.resonantFiles })}
          placement="top"
        >
          <Chip
            size="small"
            label={
              report.resonantFiles > 0
                ? T("aiPanel.focus.resonantFiles", { n: report.resonantFiles })
                : T("aiPanel.focus.noResonance")
            }
            sx={{
              height: 18,
              fontSize: fs(10),
              fontWeight: 600,
              color: report.resonantFiles > 0 ? resonanceColor(2) : "text.disabled",
              bgcolor: report.resonantFiles > 0 ? `${resonanceColor(2)}1F` : "action.hover",
              "& .MuiChip-label": { px: 0.75 },
            }}
          />
        </Tooltip>
        {/* 巡查进度：自动化到底把共振榜照顾到了多少。
            与左边「共振文件数」是两件事——一个说「有多少值得看的」，
            一个说「其中有多少真的被派单看过」。缺了这一格，用户只能看到
            「自动化一路绿灯」，看不到「绿灯全打在同一批显眼大文件上」。 */}
        {patrol.stat && patrol.stat.total > 0 && (
          <Tooltip
            placement="top"
            title={
              T("aiPanel.focus.patrolTipBase", {
                total: patrol.stat.total,
                patrolled: patrol.stat.patrolled,
                stale: patrol.stat.stale,
                never: patrol.stat.never,
              }) +
              (patrol.stat.recheck > 0
                ? T("aiPanel.focus.patrolTipRecheck", { recheck: patrol.stat.recheck })
                : "") +
              (patrol.stat.regressed > 0
                ? T("aiPanel.focus.patrolTipRegressed", { regressed: patrol.stat.regressed })
                : "") +
              (patrol.stat.failed > 0
                ? T("aiPanel.focus.patrolTipFailed", {
                    failed: patrol.stat.failed,
                    exhausted:
                      patrol.stat.exhausted > 0
                        ? T("aiPanel.focus.patrolTipExhausted", { exhausted: patrol.stat.exhausted })
                        : "",
                  })
                : "") +
              T("aiPanel.focus.patrolTipEnd")
            }
          >
            <Chip
              size="small"
              label={T("aiPanel.focus.patrolLabel", { patrolled: patrol.stat.patrolled, total: patrol.stat.total })}
              sx={{
                height: 18,
                fontSize: fs(10),
                fontWeight: 600,
                // 只要还有「实际没被看过」的目标就标红——从未点名与点名失败等价，
                // 都意味着共振榜上还有人无人问津。其次才是「看过但结论已过期」。
                color: patrolColor(patrolHeadState(patrol.stat)),
                bgcolor: `${patrolColor(patrolHeadState(patrol.stat))}1F`,
                "& .MuiChip-label": { px: 0.75 },
              }}
            />
          </Tooltip>
        )}
      </Box>

      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 1, pb: 1, pt: 0.25 }}>
          <Typography
            sx={{ fontSize: fs(10), color: "text.secondary", lineHeight: 1.5, mb: 0.75 }}
          >
            {report.resonantFiles > 0
              ? T("aiPanel.focus.introResonant", {
                  scored: report.scoredFiles,
                  resonant: report.resonantFiles,
                  dims: report.dimensions.length,
                  hot: report.hotRankLimit,
                })
              : T("aiPanel.focus.introSingle", { scored: report.scoredFiles })}
          </Typography>

          {/* 过期结论排在「空白目标」之前提示：空白只是还没人看，而一条依据已被改动的
              高危结论会持续误导人和后续每一轮 Agent，且它在旧 UI 里长得跟「已巡查」一模一样。 */}
          {patrol.stat && patrol.stat.recheck > 0 && (
            <Typography
              sx={{ fontSize: fs(10), color: "#a855f7", lineHeight: 1.5, mb: 0.75 }}
            >
              {T("aiPanel.focus.recheckTip", { recheck: patrol.stat.recheck })}
            </Typography>
          )}

          {/* 唯一带时效的一类提示，所以要单独说清「过了这村没这店」：
              其余几档漏一轮还在原地等，这一档一旦被下次扫描覆盖，
              就从「这次改动把它推坏了」退化成「它一直就这么糟」，追责线索彻底消失。 */}
          {patrol.stat && patrol.stat.regressed > 0 && (
            <Typography
              sx={{ fontSize: fs(10), color: "#f97316", lineHeight: 1.5, mb: 0.75 }}
            >
              {T("aiPanel.focus.regressedTip", { regressed: patrol.stat.regressed })}
            </Typography>
          )}

          {/* 自动化跑空转的唯一可见信号：榜首目标至今没有任何 AI 结论。
              只点名一个——点名一串等于没点名，用户不会逐个去看。 */}
          {gap.topBlankPath && gap.topBlankResonance >= 2 && (
            <Typography
              sx={{
                fontSize: fs(10),
                color: "warning.main",
                lineHeight: 1.5,
                mb: 0.75,
              }}
            >
              {T("aiPanel.focus.blankTip", {
                blank: gap.blank,
                path: gap.topBlankPath,
                reso: gap.topBlankResonance,
              })}
            </Typography>
          )}

          {/* 共振榜：人和 AI 同源同口径 */}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            {targets.map((t, i) => {
              const c = resonanceColor(t.resonance);
              return (
                <Box
                  key={t.filePath}
                  onClick={clickable ? () => onSelectFile!(t.filePath) : undefined}
                  sx={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 0.75,
                    px: 0.5,
                    py: 0.5,
                    borderRadius: 0.75,
                    cursor: clickable ? "pointer" : "default",
                    "&:hover": clickable ? { bgcolor: "action.hover" } : undefined,
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: fs(10),
                      color: "text.disabled",
                      fontVariantNumeric: "tabular-nums",
                      width: 16,
                      flexShrink: 0,
                      pt: 0.25,
                    }}
                  >
                    {i + 1}
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <Typography
                        sx={{
                          fontSize: fs(11),
                          fontWeight: 600,
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        noWrap
                        title={t.filePath}
                      >
                        {t.filePath}
                      </Typography>
                      <Chip
                        size="small"
                        label={T("aiPanel.focus.dimsCount", { n: t.resonance })}
                        sx={{
                          height: 16,
                          fontSize: fs(9),
                          fontWeight: 700,
                          color: c,
                          bgcolor: `${c}1F`,
                          flexShrink: 0,
                          "& .MuiChip-label": { px: 0.5 },
                        }}
                      />
                      {/* 洞察覆盖：这一行是「扫描点名的目标」与「AI 已给出的结论」唯一交汇处。
                          空白比有结论更值得看——它说明历轮分析没被引导到这个文件上。 */}
                      {(() => {
                        const mark = coverage[t.filePath];
                        if (!mark) {
                          return (
                            <Tooltip
                              placement="top"
                              title={T("aiPanel.focus.noConclusionTip")}
                            >
                              <Box
                                component="span"
                                sx={{
                                  fontSize: fs(9),
                                  color: "text.disabled",
                                  border: 1,
                                  borderColor: "divider",
                                  borderRadius: 0.5,
                                  px: 0.5,
                                  lineHeight: 1.5,
                                  flexShrink: 0,
                                }}
                              >
                                {T("aiPanel.focus.toAnalyze")}
                              </Box>
                            </Tooltip>
                          );
                        }
                        const sc = SEVERITY_COLOR[mark.severity];
                        return (
                          <Tooltip
                            placement="top"
                            title={T("aiPanel.focus.aiConclusionTip", {
                              count: mark.count,
                              sev: T("severity." + normalizeSeverity(mark.severity)),
                              titles: mark.titles.join(" / "),
                            })}
                          >
                            <Box
                              component="span"
                              sx={{
                                fontSize: fs(9),
                                fontWeight: 700,
                                color: sc,
                                bgcolor: `${sc}1F`,
                                borderRadius: 0.5,
                                px: 0.5,
                                lineHeight: 1.5,
                                flexShrink: 0,
                              }}
                            >
                              {T("aiPanel.focus.aiCount", { n: mark.count })}
                            </Box>
                          </Tooltip>
                        );
                      })()}
                      {/* 巡查派单状态：自动化有没有真的点名过这个文件。
                          与左侧「AI N / 待分析」是两条正交信息——「派过单」不代表「有结论」，
                          这正是「派单即销账」要解决的问题：没结论的巡查不该被无限重派。 */}
                      {(() => {
                        const patrol = patrolByPath.get(t.filePath);
                        if (!patrol) return null;
                        return (
                          <Tooltip placement="top" title={patrol.detail}>
                            <Box
                              component="span"
                              sx={{
                                fontSize: fs(9),
                                fontWeight: 700,
                                color: patrolColor(patrol.state),
                                bgcolor: `${patrolColor(patrol.state)}1F`,
                                borderRadius: 0.5,
                                px: 0.5,
                                lineHeight: 1.5,
                                flexShrink: 0,
                              }}
                            >
                              {patrolLabel(patrol.state)}
                              {patrol.assignCount > 1 ? ` ×${patrol.assignCount}` : ""}
                            </Box>
                          </Tooltip>
                        );
                      })()}
                    </Box>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.25, mt: 0.25 }}>
                      {t.resonantKeys.map((k) => {
                        const h = t.dims[k];
                        return (
                          <Tooltip
                            key={k}
                            placement="top"
                            title={T("aiPanel.focus.dimTip", { label: h.label, pct: h.pct, rank: h.rank })}
                          >
                            <Box
                              component="span"
                              sx={{
                                fontSize: fs(9),
                                color: "text.secondary",
                                bgcolor: "action.hover",
                                borderRadius: 0.5,
                                px: 0.5,
                                lineHeight: 1.4,
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {T("aiPanel.focus.dimInline", { label: h.label, value: h.value, unit: h.unit, rank: h.rank })}
                            </Box>
                          </Tooltip>
                        );
                      })}
                    </Box>
                  </Box>
                  <Typography
                    sx={{
                      fontSize: fs(10),
                      color: "text.disabled",
                      fontVariantNumeric: "tabular-nums",
                      width: 30,
                      textAlign: "right",
                      flexShrink: 0,
                      pt: 0.25,
                    }}
                    title={T("aiPanel.focus.scoreTip")}
                  >
                    {t.score.toFixed(1)}
                  </Typography>
                </Box>
              );
            })}
          </Box>

          {/* 维度共现：项目的系统性病灶 */}
          {report.cooccurrence.length > 0 && (
            <Box
              sx={{
                mt: 0.75,
                pt: 0.75,
                borderTop: 1,
                borderColor: "divider",
              }}
            >
              <Typography sx={{ fontSize: fs(10), fontWeight: 600, color: "text.secondary", mb: 0.25 }}>
                {T("aiPanel.focus.cooccurrenceTitle")}
              </Typography>
              {report.cooccurrence.map((p) => (
                <Typography
                  key={`${p.a}|${p.b}`}
                  sx={{ fontSize: fs(10), color: "text.secondary", lineHeight: 1.6 }}
                >
                  {T("aiPanel.focus.cooccurrenceItem", { a: p.aLabel, b: p.bLabel, count: p.count })}
                </Typography>
              ))}
            </Box>
          )}

          {/* 盲区维度：与人读的「数据可信度」面板呼应，提示哪些方向的共振看不见 */}
          {report.blindSpots.length > 0 && (
            <Typography
              sx={{
                fontSize: fs(10),
                color: "warning.main",
                lineHeight: 1.5,
                mt: 0.75,
                pt: 0.75,
                borderTop: 1,
                borderColor: "divider",
              }}
            >
              {T("aiPanel.focus.blindSpots", { labels: report.blindSpots.map((d) => d.label).join(" / ") })}
            </Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
