/**
 * 变更影响面板（右侧「影响面」Tab）
 *
 * 分析器此前能回答的都是「静态描述题」：这个文件多复杂、有几个 TODO、被引用几次。
 * 但工程师在改代码前真正要问的是一道**判断题**：
 *
 *     「我改这个函数，会不会炸到别人？炸到谁？要不要补测试？」
 *
 * 这个面板就是那道判断题的答案。数据源是已有的符号级调用图
 * （project_call_edges），此前它只被用来画一张同心环，符号级的
 * caller/callee 一进画布就被聚合成文件粒度丢掉了 —— 这里把它捡回来：
 *
 * - 顶部：文件级影响面（改这个文件 → 波及哪些文件），带爆炸半径与风险结论
 * - 中部：文件内可调用符号列表，每个都标出「被 N 处调用」，点击切换分析目标
 * - 下部：选中符号的上游调用者 / 下游依赖，按跳数分层展开，
 *         每一跳都能点进源码对应行（复用 SourceViewer）
 * - 「影响面画像」按钮：把这张关系图铺到画布上（左上游 / 右下游分环）
 */

import { useMemo, useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Collapse from "@mui/material/Collapse";
import HubIcon from "@mui/icons-material/Hub";
import CallReceivedIcon from "@mui/icons-material/CallReceived";
import CallMadeIcon from "@mui/icons-material/CallMade";
import BlurOnIcon from "@mui/icons-material/BlurOn";
import LoopIcon from "@mui/icons-material/Loop";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";

import { useProjectStore } from "../../store/projectStore";
import { useSceneStore } from "../../store/sceneStore";
import { useToastStore } from "../../store/toastStore";
import { openSourceAt } from "../../store/sourceViewerStore";
import { runImpactPortraitFor } from "../utils/portraits";
import { locateFileInCanvas } from "../utils/canvasLink";
import {
  analyzeFileImpact,
  analyzeImpact,
  buildCallIndex,
  impactCandidates,
  summarizeImpact,
  IMPACT_LEVEL_META,
  type ImpactNode,
} from "../utils/impactGraph";
import { impactLevelHint, impactLevelLabel } from "../utils/impactGraph";
import { t, resolveFragments } from "../../i18n";
import {
  roleOf,
  FLOW_ROLE_COLOR,
  FLOW_ROLE_HINT,
  FLOW_ROLE_LABEL,
  type FlowRole,
} from "../utils/dataFlowPortrait";
// 画布选中的实体只携带 id/type/name/config（与 EntityPortraitPanel 的 PortraitEntity 一致），
// 这里用最小接口即可，避免强依赖完整的 SceneComponent（含 transform/layerId 等画布专用字段）。
interface PortraitEntityLike {
  id?: string;
  name?: string;
  type?: string;
  config?: Record<string, unknown>;
}

interface Props {
  entity: PortraitEntityLike | null | undefined;
}

/** 一行影响面节点（可点击进源码） */
function NodeRow({
  node,
  color,
  onOpen,
}: {
  node: ImpactNode;
  color: string;
  onOpen: () => void;
}) {
  return (
    <Box
      onClick={onOpen}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        px: 0.75,
        py: 0.5,
        borderRadius: 0.75,
        cursor: "pointer",
        borderLeft: "2px solid",
        borderColor: color,
        bgcolor: "action.hover",
        "&:hover": { bgcolor: "action.selected" },
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          sx={{
            fontSize: 10.5,
            fontWeight: 600,
            fontFamily: "monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.receiverType ? `${node.receiverType}.${node.name}` : node.name}
        </Typography>
        <Typography
          sx={{
            fontSize: 9,
            color: "text.secondary",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.filePath}:{node.callLine}
          {node.viaName ? t("impact.via", { name: node.viaName }) : ""}
        </Typography>
      </Box>
      {node.receiverType && (
        <Tooltip title={t("impact.receiverTypeTip", { type: node.receiverType })}>
          <Chip
            label={node.receiverType}
            size="small"
            sx={{ height: 14, fontSize: 8, maxWidth: 70, "& .MuiChip-label": { px: 0.5, overflow: "hidden", textOverflow: "ellipsis" } }}
          />
        </Tooltip>
      )}
      {node.crossFile && (
        <Tooltip title={t("impact.crossTip")}>
          <Chip
            label={t("impact.cross")}
            size="small"
            sx={{ height: 14, fontSize: 8, "& .MuiChip-label": { px: 0.5 } }}
          />
        </Tooltip>
      )}
    </Box>
  );
}

/** 一个方向（上游/下游）的分层列表 */
function DirectionBlock({
  title,
  hint,
  icon,
  color,
  layers,
  onOpen,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  color: string;
  layers: ImpactNode[][];
  onOpen: (n: ImpactNode) => void;
}) {
  const [open, setOpen] = useState(true);
  const total = layers.reduce((acc, l) => acc + l.length, 0);

  return (
    <Box>
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          cursor: "pointer",
          py: 0.5,
          userSelect: "none",
        }}
      >
        {open ? (
          <ExpandMoreIcon sx={{ fontSize: 15, color: "text.secondary" }} />
        ) : (
          <ChevronRightIcon sx={{ fontSize: 15, color: "text.secondary" }} />
        )}
        <Box sx={{ color, display: "inline-flex" }}>{icon}</Box>
        <Typography sx={{ fontSize: 10.5, fontWeight: 700, color }}>
          {title} ({total})
        </Typography>
        <Typography sx={{ fontSize: 9, color: "text.secondary", ml: "auto" }}>{hint}</Typography>
      </Box>
      <Collapse in={open}>
        {total === 0 ? (
          <Typography sx={{ fontSize: 9.5, color: "text.secondary", pl: 2.5, pb: 0.75 }}>
            {t("impact.none")}
          </Typography>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, pl: 1.25, pb: 0.75 }}>
            {layers.map((layer, i) => (
              <Box key={i}>
                <Typography
                  sx={{ fontSize: 8.5, color: "text.secondary", letterSpacing: 0.5, mb: 0.25 }}
                >
                  {t("impact.hop", { n: i + 1, m: layer.length })}
                </Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4 }}>
                  {layer.slice(0, 12).map((n) => (
                    <NodeRow key={n.symbolId} node={n} color={color} onOpen={() => onOpen(n)} />
                  ))}
                  {layer.length > 12 && (
                    <Typography sx={{ fontSize: 9, color: "text.secondary", pl: 1 }}>
                      {t("impact.more", { n: layer.length - 12 })}
                    </Typography>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Collapse>
    </Box>
  );
}

export function ImpactAnalysisPanel({ entity }: Props) {
  const files = useProjectStore((s) => s.files);
  const symbols = useProjectStore((s) => s.symbols);
  const callEdges = useProjectStore((s) => s.callEdges);
  const dataFlow = useProjectStore((s) => s.dataFlow);
  const activeSceneId = useSceneStore((s) => s.activeSceneId);
  const showToast = useToastStore((s) => s.showToast);

  const [rootSymbolId, setRootSymbolId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const index = useMemo(() => buildCallIndex(callEdges), [callEdges]);

  /** 选中实体 → 对应扫描文件（画布实体只带 relPath / 文件名） */
  const targetFile = useMemo(() => {
    if (!entity) return null;
    const cfgPath = String(entity.config?.filePath ?? "");
    const cfgName = String(entity.config?.fileName ?? entity.name ?? "");
    return (
      files.find((f) => !f.isDirectory && f.relPath === cfgPath) ??
      files.find((f) => !f.isDirectory && f.name === cfgName) ??
      null
    );
  }, [entity, files]);

  // 切换实体时重置符号选择，避免看着 A 文件却在分析 B 文件的函数
  useEffect(() => {
    setRootSymbolId(null);
  }, [targetFile?.id]);

  const candidates = useMemo(
    () => (targetFile ? impactCandidates(symbols, targetFile.id) : []),
    [symbols, targetFile]
  );

  /** 每个候选符号的直接调用者数（列表右侧的数字，决定先看谁） */
  const callerCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of candidates) {
      m.set(s.id, index.byCallee.get(s.id)?.length ?? 0);
    }
    return m;
  }, [candidates, index]);

  /**
   * 该文件内每个函数的数据流角色（汇点 / 透传 / 阻断）。
   *
   * 调用图只说「谁调谁」，数据流摘要补上「数据到底传没传过去」——
   * 面板上一个绿点（阻断）就意味着「这个函数的调用者其实不用回归」，
   * 是影响面判断里信息量最大的一格。同名多定义按第一条摘要取（同文件内极少见）。
   */
  const flowRoleByName = useMemo(() => {
    const m = new Map<string, FlowRole>();
    if (!targetFile) return m;
    for (const f of dataFlow) {
      if (f.fileId !== targetFile.id || !f.functionName) continue;
      if (!m.has(f.functionName)) m.set(f.functionName, roleOf(f));
    }
    return m;
  }, [dataFlow, targetFile]);

  const fileReport = useMemo(
    () => (targetFile ? analyzeFileImpact(callEdges, targetFile.id, { index }) : null),
    [callEdges, targetFile, index]
  );

  const symbolReport = useMemo(
    () =>
      rootSymbolId ? analyzeImpact(callEdges, rootSymbolId, { symbols, index, maxDepth: 3 }) : null,
    [callEdges, rootSymbolId, symbols, index]
  );

  const openNode = (n: ImpactNode) => {
    if (!n.fileId) {
      showToast(t("impact.notInScan", { name: n.name }), "warning");
      return;
    }
    openSourceAt(n.fileId, n.callLine, t("impact.callPoint", { via: n.viaName || t("impact.target"), name: n.name }));
  };

  const drawPortrait = async () => {
    if (!activeSceneId) return;
    setRunning(true);
    try {
      const outcome = await runImpactPortraitFor(activeSceneId, {
        rootSymbolId: rootSymbolId ?? undefined,
        rootFileId: rootSymbolId ? undefined : targetFile?.id,
        maxDepth: 3,
      });
      showToast(outcome.message, outcome.severity);
    } finally {
      setRunning(false);
    }
  };

  // ── 空态：没选实体 / 没有调用图数据 ──
  if (callEdges.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: "center", color: "text.secondary" }}>
        <HubIcon sx={{ fontSize: 38, opacity: 0.2, mb: 1 }} />
        <Typography variant="caption" sx={{ display: "block" }}>
          {t("impact.noCallGraph")}
        </Typography>
        <Typography variant="caption" sx={{ display: "block", fontSize: 9.5, mt: 0.5 }}>
          {t("impact.noCallGraphHint")}
        </Typography>
      </Box>
    );
  }

  if (!targetFile) {
    return (
      <Box sx={{ p: 2, textAlign: "center", color: "text.secondary" }}>
        <CenterFocusStrongIcon sx={{ fontSize: 38, opacity: 0.2, mb: 1 }} />
        <Typography variant="caption" sx={{ display: "block" }}>
          {t("impact.selectFile")}
        </Typography>
        <Typography variant="caption" sx={{ display: "block", fontSize: 9.5, mt: 0.5 }}>
          {t("impact.selectFileHint")}
        </Typography>
      </Box>
    );
  }

  const level = symbolReport?.level ?? fileReport?.level ?? "isolated";
  const levelMeta = IMPACT_LEVEL_META[level];
  const blast = symbolReport?.blastRadius ?? {
    symbols: fileReport?.blastRadius.symbols ?? 0,
    files: fileReport?.blastRadius.files ?? 0,
    maxDepth: 0,
  };

  return (
    <Box
      sx={{
        height: "100%",
        overflow: "auto",
        p: 1.25,
        display: "flex",
        flexDirection: "column",
        gap: 1.25,
      }}
    >
      {/* ── 结论卡：一句话回答「能不能放心改」 ── */}
      <Box
        sx={{
          p: 1.1,
          borderRadius: 1,
          border: 1,
          borderColor: `${levelMeta.color}55`,
          bgcolor: `${levelMeta.color}12`,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.5 }}>
          <Chip
            label={impactLevelLabel(level)}
            size="small"
            sx={{
              height: 17,
              fontSize: 9,
              fontWeight: 700,
              color: "#fff",
              bgcolor: levelMeta.color,
            }}
          />
          <Typography sx={{ fontSize: 10, fontWeight: 700, minWidth: 0, flex: 1 }} noWrap>
            {symbolReport ? symbolReport.rootName : targetFile.name}
          </Typography>
          {symbolReport?.cyclic && (
            <Tooltip title={t("impact.cycleTip")}>
              <LoopIcon sx={{ fontSize: 14, color: "warning.main" }} />
            </Tooltip>
          )}
        </Box>
        <Typography sx={{ fontSize: 9.5, color: "text.secondary", display: "block" }}>
          {symbolReport ? summarizeImpact(symbolReport) : impactLevelHint(level)}
        </Typography>
        {/*
          数据流修正：调用图算出的爆炸半径是「调用可达」的上界。
          如果这个函数在数据流上是阻断的，真实波及远小于上面那个数字 ——
          不说这一句，用户会为一个其实很安全的改动做全量回归。
        */}
        {symbolReport &&
          (() => {
            const role = flowRoleByName.get(symbolReport.rootName);
            if (!role) return null;
            return (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.4, mt: 0.4 }}>
                <Box
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    flexShrink: 0,
                    backgroundColor: FLOW_ROLE_COLOR[role],
                  }}
                />
                <Typography sx={{ fontSize: 9, color: "text.secondary" }}>
                  {role === "blocker"
                    ? t("impact.flowBlocker")
                    : role === "sink"
                      ? t("impact.flowSink")
                      : t("impact.flowConduit")}
                </Typography>
              </Box>
            );
          })()}
        <Box sx={{ display: "flex", gap: 1.5, mt: 0.75 }}>
          {[
            { label: t("impact.blastSymbols"), value: blast.symbols },
            { label: t("impact.blastFiles"), value: blast.files },
            {
              label: t("impact.blastDepth"),
              value: symbolReport ? blast.maxDepth : (fileReport?.activeSymbols ?? 0),
              alt: symbolReport ? undefined : t("impact.participants"),
            },
          ].map((s) => (
            <Box key={s.label}>
              <Typography sx={{ fontSize: 15, fontWeight: 800, lineHeight: 1.1 }}>
                {s.value}
              </Typography>
              <Typography sx={{ fontSize: 8.5, color: "text.secondary" }}>
                {s.alt ?? s.label}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Button
        size="small"
        variant="outlined"
        startIcon={<HubIcon sx={{ fontSize: 15 }} />}
        disabled={running || !activeSceneId}
        onClick={() => void drawPortrait()}
        sx={{ fontSize: 10, py: 0.4, textTransform: "none" }}
      >
        {running ? t("impact.generate") : t("impact.portraitBtn")}
      </Button>

      {/* ── 文件级：改这个文件会波及哪些文件 ── */}
      {fileReport && fileReport.affectedFiles.length > 0 && (
        <Box>
          <Typography
            sx={{ fontSize: 9.5, fontWeight: 700, color: "text.secondary", letterSpacing: 0.5 }}
          >
            {t("impact.fileBlast", { n: fileReport.affectedFiles.length })}
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4, mt: 0.5 }}>
            {fileReport.affectedFiles.slice(0, 8).map((af) => (
              <Box
                key={af.fileId}
                onClick={() => {
                  const f = files.find((x) => x.id === af.fileId);
                  locateFileInCanvas(f, () =>
                    showToast(t("impact.notOnCanvas", { path: af.filePath }), "warning")
                  );
                }}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.75,
                  px: 0.75,
                  py: 0.4,
                  borderRadius: 0.75,
                  cursor: "pointer",
                  bgcolor: "action.hover",
                  "&:hover": { bgcolor: "action.selected" },
                }}
              >
                <Typography sx={{ fontSize: 10, minWidth: 0, flex: 1 }} noWrap>
                  {af.filePath}
                </Typography>
                <Chip
                  label={t("impact.places", { n: af.symbolCount })}
                  size="small"
                  sx={{ height: 14, fontSize: 8, "& .MuiChip-label": { px: 0.5 } }}
                />
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <Divider />

      {/* ── 符号选择器：挑一个函数作为影响面的圆心 ── */}
      <Box>
        <Typography
          sx={{ fontSize: 9.5, fontWeight: 700, color: "text.secondary", letterSpacing: 0.5 }}
        >
          {t("impact.callableSymbols", { n: candidates.length })}
        </Typography>
        {candidates.length === 0 ? (
          <Typography sx={{ fontSize: 9.5, color: "text.secondary", mt: 0.5 }}>
            {t("impact.noSymbols")}
          </Typography>
        ) : (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
            {candidates.slice(0, 40).map((s) => {
              const cnt = callerCounts.get(s.id) ?? 0;
              const active = s.id === rootSymbolId;
              const role = flowRoleByName.get(s.name);
              return (
                <Tooltip
                  key={s.id}
                  title={
                    t("impact.symbolTip", { kind: s.kind, line: s.lineStart, n: cnt }) +
                    (role ? t("impact.flowTip", { label: resolveFragments(FLOW_ROLE_LABEL[role]), hint: resolveFragments(FLOW_ROLE_HINT[role]) }) : "")
                  }
                >
                  <Chip
                    label={`${s.name}${cnt > 0 ? ` ${cnt}` : ""}`}
                    size="small"
                    color={active ? "primary" : "default"}
                    variant={active ? "filled" : "outlined"}
                    onClick={() => setRootSymbolId(active ? null : s.id)}
                    // 数据流角色色点：绿=阻断（调用方多半不用回归）橙=透传 红=写外部状态
                    icon={
                      role ? (
                        <Box
                          sx={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            ml: 0.55,
                            flexShrink: 0,
                            backgroundColor: FLOW_ROLE_COLOR[role],
                          }}
                        />
                      ) : undefined
                    }
                    sx={{
                      height: 18,
                      fontSize: 9,
                      fontFamily: "monospace",
                      maxWidth: 160,
                      "& .MuiChip-label": { px: 0.6 },
                    }}
                  />
                </Tooltip>
              );
            })}
          </Box>
        )}
        {/* 数据流图例：只在真有摘要时出现，避免不支持的语言里挂一行没用的说明 */}
        {flowRoleByName.size > 0 && (
          <Box sx={{ display: "flex", gap: 1, mt: 0.6, flexWrap: "wrap" }}>
            {(["sink", "conduit", "blocker"] as FlowRole[]).map((r) => (
              <Box key={r} sx={{ display: "flex", alignItems: "center", gap: 0.3 }}>
                <Box
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    backgroundColor: FLOW_ROLE_COLOR[r],
                  }}
                />
                <Typography sx={{ fontSize: 8.5, color: "text.secondary" }}>
                  {resolveFragments(FLOW_ROLE_LABEL[r]).split(" · ")[0]}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* ── 符号级上下游 ── */}
      {symbolReport ? (
        <>
          <Divider />
          <DirectionBlock
            title={t("impact.upstream")}
            hint={t("impact.upstreamHint")}
            icon={<CallReceivedIcon sx={{ fontSize: 14 }} />}
            color="#ef4444"
            layers={symbolReport.upstreamByDepth}
            onOpen={openNode}
          />
          <DirectionBlock
            title={t("impact.downstream")}
            hint={t("impact.downstreamHint")}
            icon={<CallMadeIcon sx={{ fontSize: 14 }} />}
            color="#3b82f6"
            layers={symbolReport.downstreamByDepth}
            onOpen={openNode}
          />
        </>
      ) : (
        candidates.length > 0 && (
          <Box sx={{ textAlign: "center", py: 1.5, color: "text.secondary" }}>
            <BlurOnIcon sx={{ fontSize: 26, opacity: 0.25, display: "block", mx: "auto" }} />
            <Typography sx={{ fontSize: 9.5, mt: 0.5 }}>
              {t("impact.pickSymbol")}
            </Typography>
          </Box>
        )
      )}
    </Box>
  );
}
