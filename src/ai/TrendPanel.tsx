/**
 * TrendPanel —— 指标走势，给**人**看的那一份。
 *
 * 为什么人也必须看到
 * ------------------
 * trend 分节已经把「在变好还是变坏」交给 Agent 了。但如果人看不到同一份数据，
 * 就会出现和共振榜一模一样的错位：Agent 说「技术债密度上升 18%」，
 * 用户在界面上翻遍所有面板只看到一个孤零零的「技术债 87 处」，
 * 既无法验证那句话，也无法在下一次扫描后自己判断有没有改进。
 * 于是「AI 说的」变成了不可查证的断言——这是信任崩塌得最快的一种方式。
 *
 * 与 AI 同源同口径
 * ----------------
 * 本面板和 trend 分节读的是同一个 metricTrend 报告（同一批快照、同一套可比性判定、
 * 同一个 verdict）。任何一处显示「不可比」，另一处就不会显示成「改善」。
 *
 * 为什么这里还要挂一块「谁在变坏」
 * --------------------------------
 * 走势只回答「变了多少」。人看到「技术债密度 +18%」之后的下一个问题一定是
 * 「哪来的」，而这一问此前在整个界面上无处可答：总量在这个面板，对象在另一个面板，
 * 两者之间的关联要用户自己在脑子里做——偏偏这一步才是唯一能转化成行动的一步。
 * 所以实体回归（哪个文件变坏了）必须与总量同屏，而不是另起炉灶。
 *
 * 同屏之后有一条口径不能松：**新上榜的实体绝不染成恶化色**。
 * 引擎已经把 appeared 与 worsened 分开了（否则每次加功能都刷一屏假警报），
 * UI 若把它们并成一列红色，等于把引擎里最要紧的那条判定在最后一米又抹掉。
 * 同理 removed 只记数不记功——删文件不是质量改善。
 *
 * 模块无关
 * --------
 * 只认 moduleId + scopeId，不认识扫描/画布/报告任何具体模块。
 * 未实现 collectMetrics / collectEntitySnapshot 的模块自然没有快照，对应区块静默不渲染。
 */
import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Tooltip from "@mui/material/Tooltip";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import TimelineOutlinedIcon from "@mui/icons-material/TimelineOutlined";
import { loadTrendReport } from "./metricTrend";
import { loadEntityRegression } from "./entityRegression";
import { useProjectStore } from "../store/projectStore";
import type {
  AiEntityDelta,
  AiEntityRegressionReport,
  AiMetricDelta,
  AiTrendReport,
} from "./contextTypes";
import { t } from "../i18n";

interface Props {
  moduleId: string;
  scopeId?: string;
  compact?: boolean;
}

const VERDICT: Record<AiTrendReport["verdict"], { label: string; color: string }> = {
  improving: { label: t("aiPanel.trend.verdict.improving"), color: "#22c55e" },
  regressing: { label: t("aiPanel.trend.verdict.regressing"), color: "#ef4444" },
  mixed: { label: t("aiPanel.trend.verdict.mixed"), color: "#f59e0b" },
  flat: { label: t("aiPanel.trend.verdict.flat"), color: "#94a3b8" },
  insufficient: { label: t("aiPanel.trend.verdict.insufficient"), color: "#94a3b8" },
};

/**
 * 方向配色。
 *
 * incomparable 用**灰色而非绿色**是这块 UI 最要紧的一个细节：
 * 它的数值往往是「300 → 0」，配上绿色就成了一次视觉上的谎言，
 * 用户扫一眼只会记住「大幅下降」，根本不会去读那行小字备注。
 */
const DIRECTION: Record<AiMetricDelta["direction"], { label: string; color: string }> = {
  improved: { label: t("aiPanel.trend.direction.improved"), color: "#22c55e" },
  worsened: { label: t("aiPanel.trend.direction.worsened"), color: "#ef4444" },
  flat: { label: t("aiPanel.trend.direction.flat"), color: "#94a3b8" },
  moved: { label: t("aiPanel.trend.direction.moved"), color: "#64748b" },
  incomparable: { label: t("aiPanel.trend.direction.incomparable"), color: "#94a3b8" },
};

/**
 * 「谁在变坏」最多列几行。
 *
 * 列一串等于没列：这块的作用是把总量落到少数几个可以马上打开来看的对象上，
 * 超出的部分交给焦点面板（那里有完整队列和派单台账），这里只留一个计数提示。
 */
const REGRESSION_ROWS = 6;

/** 恶化色与焦点面板 regressed 档统一用橙色，跨面板认色不认字 */
const REGRESSED_COLOR = "#f97316";

/** 路径太长时保留尾部（结尾的文件名才是识别用的信息，开头的目录不是） */
function tailPath(text: string, keep = 42): string {
  if (text.length <= keep) return text;
  return `…${text.slice(text.length - keep)}`;
}

/** 主因维度的一句话：「复杂度 12 → 19」，拿不到主因就退回条目自己的 reason */
function driverText(d: AiEntityDelta): string | null {
  const dim = d.dims.find((x) => x.key === d.driver) ?? d.dims.find((x) => x.direction === "worsened");
  if (!dim || dim.from === null || dim.to === null) return null;
  return `${dim.label} ${dim.from}${dim.unit} → ${dim.to}${dim.unit}`;
}

function fmtWhen(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtSpan(days: number): string {
  if (days >= 1) return t("aiPanel.time.days", { n: Math.round(days * 10) / 10 });
  const mins = Math.max(1, Math.round(days * 1440));
  return mins >= 60 ? t("aiPanel.time.hours", { n: Math.round(mins / 60) }) : t("aiPanel.time.minutes", { n: mins });
}

export function TrendPanel({ moduleId, scopeId, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<AiTrendReport | null>(null);
  const [regression, setRegression] = useState<AiEntityRegressionReport | null>(null);

  // 上下文指纹变化 = 扫描收尾刚跑完一轮（那一轮里已经打过点了），此时重新拉一次时间轴。
  // 用指纹而不是 files 做触发器：files 在扫描过程中会变很多次，
  // 每次都去查库既浪费又会在中途读到半成品的时间轴。
  const digest = useProjectStore((s) => s.aiContextDigest);

  useEffect(() => {
    if (!scopeId) {
      setReport(null);
      setRegression(null);
      return;
    }
    let alive = true;
    loadTrendReport(moduleId, scopeId)
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch(() => {
        /* 趋势读不到就不渲染，绝不拖垮整个侧栏 */
      });
    // 两份报告各读各的：实体快照缺失（模块没实现 collectEntitySnapshot）
    // 不该连累总量走势整块消失，反之亦然。
    loadEntityRegression(moduleId, scopeId)
      .then((r) => {
        if (alive) setRegression(r);
      })
      .catch(() => {
        /* 同上 */
      });
    return () => {
      alive = false;
    };
  }, [moduleId, scopeId, digest]);

  const rows = useMemo(
    () =>
      (report?.deltas ?? [])
        // 排序即优先级：恶化排最前（要人看见），不可比排最后但**不隐藏**
        .slice()
        .sort((a, b) => {
          const rank = (d: AiMetricDelta) =>
            d.direction === "worsened" ? 0 : d.direction === "improved" ? 1 : d.direction === "incomparable" ? 3 : 2;
          const r = rank(a) - rank(b);
          if (r !== 0) return r;
          return Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0);
        }),
    [report],
  );

  // 只取 worsened。appeared / removed 各自单列计数，绝不并进这张表——
  // 这是引擎里第 ①③ 条判定口径在 UI 侧的延续，混进来一次，整块就退化成噪声墙。
  const worsenedRows = useMemo(
    () => (regression?.entities ?? []).filter((e) => e.change === "worsened"),
    [regression],
  );

  if (!scopeId || !report) return null;

  const fs = (n: number) => (compact ? n - 1 : n);
  const v = VERDICT[report.verdict];
  const first = report.verdict === "insufficient" || !report.baseline;

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, overflow: "hidden" }}>
      <Box
        onClick={() => setOpen((x) => !x)}
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
        <TimelineOutlinedIcon sx={{ fontSize: 15, color: "primary.main" }} />
        <Typography sx={{ fontSize: fs(12), fontWeight: 600, flex: 1 }}>{t("aiPanel.trend.title")}</Typography>

        <Tooltip
          placement="top"
          title={
            first
              ? t("aiPanel.trend.firstTip")
              : t("aiPanel.trend.compareTip", {
                  when: fmtWhen(report.baseline!.takenAt),
                  span: fmtSpan(report.spanDays),
                  improved: report.improved,
                  worsened: report.worsened,
                  incomparable: report.incomparable,
                  points: report.points,
                })
          }
        >
          <Chip
            size="small"
            label={first ? t("aiPanel.trend.verdict.insufficient") : v.label}
            sx={{
              height: 18,
              fontSize: fs(10),
              fontWeight: 600,
              color: v.color,
              bgcolor: `${v.color}1F`,
              "& .MuiChip-label": { px: 0.75 },
            }}
          />
        </Tooltip>

        {/* 有对象级劣化时，它比「不可比」更该占据这个位置：前者要人马上看，后者只是免责声明 */}
        {worsenedRows.length > 0 ? (
          <Tooltip
            placement="top"
            title={t("aiPanel.trend.worsenedTip", {
              n: worsenedRows.length,
              label: regression?.entityLabel ?? t("aiPanel.trend.entityDefault"),
            })}
          >
            <Chip
              size="small"
              label={t("aiPanel.trend.worsenedCount", { n: worsenedRows.length })}
              sx={{
                height: 18,
                fontSize: fs(10),
                fontWeight: 600,
                color: REGRESSED_COLOR,
                bgcolor: `${REGRESSED_COLOR}1F`,
                "& .MuiChip-label": { px: 0.75 },
              }}
            />
          </Tooltip>
        ) : (
          !first &&
          report.incomparable > 0 && (
            <Tooltip
              placement="top"
              title={t("aiPanel.trend.incomparableTip")}
            >
              <Chip
                size="small"
                label={t("aiPanel.trend.incomparableCount", { n: report.incomparable })}
                sx={{
                  height: 18,
                  fontSize: fs(10),
                  fontWeight: 600,
                  color: "#94a3b8",
                  bgcolor: "action.hover",
                  "& .MuiChip-label": { px: 0.75 },
                }}
              />
            </Tooltip>
          )
        )}
      </Box>

      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 1, pb: 1, pt: 0.25 }}>
          <Typography sx={{ fontSize: fs(10), color: "text.secondary", lineHeight: 1.5, mb: 0.75 }}>
            {first
              ? t("aiPanel.trend.firstIntro")
              : t("aiPanel.trend.intro", {
                  when1: fmtWhen(report.baseline!.takenAt),
                  when2: fmtWhen(report.current!.takenAt),
                  span: fmtSpan(report.spanDays),
                  points: report.points,
                })}
          </Typography>

          {first ? null : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
              {rows.map((d) => {
                const dir = DIRECTION[d.direction];
                const cmp = d.direction !== "incomparable";
                return (
                  <Tooltip
                    key={d.key}
                    placement="left"
                    title={
                      d.reason ??
                      (d.fromDensity !== undefined
                        ? t("aiPanel.trend.dirDensity", {
                            from: d.fromDensity,
                            to: d.toDensity ?? "",
                            unit: d.basisUnit ?? "",
                          })
                        : t("aiPanel.trend.dirAbs"))
                    }
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.75,
                        px: 0.75,
                        py: 0.4,
                        borderRadius: 0.75,
                        bgcolor: "action.hover",
                      }}
                    >
                      <Typography
                        sx={{ fontSize: fs(11), flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {d.label}
                      </Typography>
                      <Typography sx={{ fontSize: fs(10), color: "text.disabled", fontVariantNumeric: "tabular-nums" }}>
                        {d.from}
                        {" → "}
                        {d.to}
                        {d.unit}
                      </Typography>
                      {cmp && d.pct !== null && (
                        <Typography
                          sx={{ fontSize: fs(10), fontWeight: 600, color: dir.color, fontVariantNumeric: "tabular-nums", minWidth: 52, textAlign: "right" }}
                        >
                          {d.pct > 0 ? "+" : ""}
                          {d.pct}%
                        </Typography>
                      )}
                      <Chip
                        size="small"
                        label={dir.label}
                        sx={{
                          height: 16,
                          fontSize: fs(9),
                          fontWeight: 600,
                          color: dir.color,
                          bgcolor: `${dir.color}1F`,
                          "& .MuiChip-label": { px: 0.5 },
                        }}
                      />
                    </Box>
                  </Tooltip>
                );
              })}
            </Box>
          )}

          {/* ── 谁在变坏：把上面的总量落到具体对象上 ────────────────────────── */}
          {regression && (worsenedRows.length > 0 || regression.appeared > 0 || regression.removed > 0) && (
            <Box sx={{ mt: 1, pt: 0.75, borderTop: 1, borderColor: "divider" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
                <Typography sx={{ fontSize: fs(11), fontWeight: 600 }}>
                  {t("aiPanel.trend.whoRegressed")}
                </Typography>
                <Typography sx={{ fontSize: fs(10), color: "text.disabled" }}>
                  {t("aiPanel.trend.levelOf", { label: regression.entityLabel })}
                </Typography>
                <Box sx={{ flex: 1 }} />
                {/* 新上榜与已删除只报数不参与「变坏」判定，理由见文件头 */}
                {regression.appeared > 0 && (
                  <Tooltip
                    placement="top"
                    title={t("aiPanel.trend.appearedTip")}
                  >
                    <Typography sx={{ fontSize: fs(10), color: "text.secondary" }}>
                      {t("aiPanel.trend.appeared", { n: regression.appeared })}
                    </Typography>
                  </Tooltip>
                )}
                {regression.removed > 0 && (
                  <Tooltip
                    placement="top"
                    title={t("aiPanel.trend.removedTip")}
                  >
                    <Typography sx={{ fontSize: fs(10), color: "text.secondary" }}>
                      {t("aiPanel.trend.removed", { n: regression.removed })}
                    </Typography>
                  </Tooltip>
                )}
              </Box>

              {worsenedRows.length === 0 ? (
                <Typography sx={{ fontSize: fs(10), color: "text.secondary", lineHeight: 1.5 }}>
                  {t("aiPanel.trend.noWorsened")}
                </Typography>
              ) : (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
                  {worsenedRows.slice(0, REGRESSION_ROWS).map((e) => {
                    const drv = driverText(e);
                    return (
                      <Tooltip
                        key={e.id}
                        placement="left"
                        title={
                          <Box sx={{ maxWidth: 320 }}>
                            <Typography sx={{ fontSize: 11, fontWeight: 600, mb: 0.25, wordBreak: "break-all" }}>
                              {e.label}
                            </Typography>
                            <Typography sx={{ fontSize: 11, lineHeight: 1.5 }}>
                              {e.reason ?? t("aiPanel.trend.regressedReasonDefault")}
                            </Typography>
                            {e.dims.filter((d) => d.direction === "worsened").length > 0 && (
                              <Typography sx={{ fontSize: 10, mt: 0.5, lineHeight: 1.5, opacity: 0.85 }}>
                                {e.dims
                                  .filter((d) => d.direction === "worsened")
                                  .map((d) => `${d.label} ${d.from}${d.unit} → ${d.to}${d.unit}`)
                                  .join("；")}
                              </Typography>
                            )}
                            {/* 综合分不可比时，绝不给出「分数涨了多少」——那是别的文件动了导致的位移 */}
                            {!regression.scoreComparable && (
                              <Typography sx={{ fontSize: 10, mt: 0.5, opacity: 0.7 }}>
                                {t("aiPanel.trend.scoreIncomparable")}
                              </Typography>
                            )}
                          </Box>
                        }
                      >
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.75,
                            px: 0.75,
                            py: 0.4,
                            borderRadius: 0.75,
                            bgcolor: `${REGRESSED_COLOR}14`,
                          }}
                        >
                          <Typography
                            sx={{
                              fontSize: fs(11),
                              flex: 1,
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {tailPath(e.label)}
                          </Typography>
                          {drv && (
                            <Typography
                              sx={{
                                fontSize: fs(10),
                                color: "text.disabled",
                                whiteSpace: "nowrap",
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {drv}
                            </Typography>
                          )}
                          {regression.scoreComparable && e.scoreDelta !== null && (
                            <Typography
                              sx={{
                                fontSize: fs(10),
                                fontWeight: 600,
                                color: REGRESSED_COLOR,
                                fontVariantNumeric: "tabular-nums",
                                minWidth: 38,
                                textAlign: "right",
                              }}
                            >
                              {e.scoreDelta > 0 ? "+" : ""}
                              {e.scoreDelta}
                              {e.approx ? "*" : ""}
                            </Typography>
                          )}
                        </Box>
                      </Tooltip>
                    );
                  })}
                  {worsenedRows.length > REGRESSION_ROWS && (
                    <Typography sx={{ fontSize: fs(10), color: "text.disabled", pl: 0.75, pt: 0.25 }}>
                      {t("aiPanel.trend.moreRows", { n: worsenedRows.length - REGRESSION_ROWS })}
                    </Typography>
                  )}
                </Box>
              )}

              {regression.blindDims.length > 0 && (
                <Typography sx={{ fontSize: fs(10), color: "text.disabled", mt: 0.5, lineHeight: 1.5 }}>
                  {t("aiPanel.trend.blindDims", { labels: regression.blindDims.map((d) => d.label).join("、") })}
                </Typography>
              )}
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

export default TrendPanel;
