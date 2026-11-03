/**
 * 画布小地图 / 风险热区俯瞰图（R33）
 *
 * 定位：**导航器 + 体检图**，常驻画布右下角。
 * - 导航：点一下跳过去、拖着视口框扫视全图（视口虚拟化之后这是唯一的全局手段）
 * - 体检：每个点按风险配色，「红色堆在哪个目录」一眼可见，不需要先去翻列表
 *
 * 性能约束（这块必须小心，画布卡顿是用户反复提的痛点）：
 * - 点集只在 `components` / 尺寸 / 配色模式变化时重算（useMemo），
 *   平移缩放**不会**触发点集重建；
 * - 平移手势期间视口框走 rAF 直写 DOM（读 viewportRef），
 *   与 useCanvasPanZoom 同一套思路，不让小地图把刚省下来的渲染又吃回去；
 * - 实体超过 MAX_DOTS 时按面积降采样，避免上万节点时 SVG 本身成为瓶颈。
 * - 点层（最多 MAX_DOTS 个 <rect>）拆成独立 memo 组件（R37）：`dots` 的
 *   **数据**本来就不随视口变，但 `dots.map(...)` 每次父渲染都要重建 1200 个
 *   React 元素并走一遍 reconcile —— 而平移期间视口 state 是节流提交的，
 *   每次提交都会重跑一次。memo 之后平移期间点层直接命中缓存、零 diff。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MapIcon from "@mui/icons-material/Map";
import CloseIcon from "@mui/icons-material/CloseFullscreen";
import IconButton from "@mui/material/IconButton";
import { contentBounds, type CanvasViewport } from "../utils/panZoom";
import { useEditorStore } from "../../store/editorStore";
import { t } from "../../i18n";
import {
  buildMinimapDots,
  centerViewportOn,
  computeProjection,
  minimapToWorld,
  projectRect,
  summarizeTiers,
  viewportWorldRect,
  RISK_TIER_COLORS,
  RISK_TIER_LABEL_KEYS,
  type RiskTier,
} from "../utils/minimap";
import type { SceneComponent } from "../../types/editor";

const MAP_W = 190;
const MAP_H = 130;
/** SVG 节点数上限：超过后按实体面积取前 N 个（大块=目录/模块，先保证骨架可辨） */
const MAX_DOTS = 1200;

/**
 * 小地图点层。
 *
 * 单独抽出来的唯一理由是**性能**：它接收的 `dots` 由 useMemo 产出，
 * 只在实体集合 / 选中集合 / 配色模式变化时换引用；而外层小地图会因为
 * `viewport`、`isPanning` 的变化频繁重渲染。不隔离的话，平移一次就要
 * 重建并 diff 上千个 `<rect>`，把 rAF 直写省下来的开销又吐回去。
 */
const MinimapDots = memo(function MinimapDots({ dots }: { dots: ReturnType<typeof buildMinimapDots> }) {
  return (
    <>
      {dots.map((d) => (
        <rect
          key={d.id}
          x={d.x}
          y={d.y}
          width={d.w}
          height={d.h}
          rx={0.5}
          fill={d.color}
          fillOpacity={d.selected ? 1 : 0.62}
          stroke={d.selected ? "var(--template-palette-primary-main)" : "none"}
          strokeWidth={d.selected ? 1 : 0}
        />
      ))}
    </>
  );
});

export interface CanvasMinimapProps {
  components: readonly SceneComponent[];
  selectedIds: readonly string[];
  /** 画布视口快照（节流提交，用于 React 渲染初值） */
  viewport: CanvasViewport;
  /** 画布实时视口（平移手势期间读它做 rAF 直写） */
  viewportRef: React.MutableRefObject<CanvasViewport>;
  /** 画布容器像素尺寸（换算视口框大小） */
  canvasSize: { width: number; height: number };
  isPanning: boolean;
  /** 应用新视口（点击/拖拽导航） */
  onNavigate: (next: CanvasViewport) => void;
  /** 实体 → 架构分层色（分层配色模式） */
  layerColorOf?: (c: SceneComponent) => string | undefined;
}

export default function CanvasMinimap({
  components,
  selectedIds,
  viewport,
  viewportRef,
  canvasSize,
  isPanning,
  onNavigate,
  layerColorOf,
}: CanvasMinimapProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [colorMode, setColorMode] = useState<"risk" | "layer">("risk");
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRectRef = useRef<SVGRectElement>(null);
  const draggingRef = useRef(false);

  // ─── 投影与点集（与视口无关，平移缩放不重算）───
  const proj = useMemo(
    () => computeProjection(contentBounds(components), { width: MAP_W, height: MAP_H }),
    [components]
  );

  const dots = useMemo(() => {
    if (!proj) return [];
    const all = buildMinimapDots(components, proj, { selectedIds, colorMode, layerColorOf });
    if (all.length <= MAX_DOTS) return all;
    // 降采样：按面积降序保留，大实体（目录/模块头）优先，保证俯瞰骨架不塌
    return [...all].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, MAX_DOTS);
  }, [components, proj, selectedIds, colorMode, layerColorOf]);

  const tiers = useMemo(() => summarizeTiers(dots), [dots]);

  // ─── 视口框：state 给初值，平移手势期间 rAF 直写 DOM ───
  const applyViewRect = useCallback(
    (vp: CanvasViewport) => {
      const el = viewRectRef.current;
      if (!el || !proj) return;
      const world = viewportWorldRect(vp, canvasSize);
      const r = projectRect({ x: world.x, y: world.y, width: world.width, height: world.height }, proj);
      el.setAttribute("x", String(r.x));
      el.setAttribute("y", String(r.y));
      el.setAttribute("width", String(Math.max(4, r.w)));
      el.setAttribute("height", String(Math.max(4, r.h)));
    },
    [proj, canvasSize]
  );

  useEffect(() => {
    applyViewRect(viewport);
  }, [applyViewRect, viewport]);

  useEffect(() => {
    if (!isPanning) return;
    let raf = 0;
    const tick = () => {
      applyViewRect(viewportRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPanning, applyViewRect, viewportRef]);

  // ─── 导航交互：按下即跳，按住可扫视 ───
  const navigateTo = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg || !proj) return;
      const rect = svg.getBoundingClientRect();
      const world = minimapToWorld(clientX - rect.left, clientY - rect.top, proj);
      onNavigate(centerViewportOn(world, viewportRef.current.scale, canvasSize));
    },
    [proj, onNavigate, viewportRef, canvasSize]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // 别让画布把它当成平移手势
      draggingRef.current = true;
      navigateTo(e.clientX, e.clientY);
    },
    [navigateTo]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      navigateTo(e.clientX, e.clientY);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [navigateTo]);

  /**
   * 图例点击 → 「带我去看最红的地方」。
   *
   * 这是小地图从"缩略图"变成"分析入口"的关键一步：看到红点堆积不是终点，
   * 一键把这批实体选中并收敛视野，才算把全局体检接回到具体工作面。
   * 复用 R32 的 selectComponents（一次 store 更新）+ requestFit(ids)（只框命中集合）。
   */
  const handleFocusTier = useCallback(
    (tier: RiskTier) => {
      const ids = dots.filter((d) => d.tier === tier).map((d) => d.id);
      if (ids.length === 0) return;
      const store = useEditorStore.getState();
      store.selectComponents(ids);
      store.requestFit(ids);
    },
    [dots]
  );

  if (components.length === 0) return null;

  if (collapsed) {
    return (
      <Tooltip title={t("canvasTip.minimapExpand")} placement="left">
        <IconButton
          size="small"
          onClick={() => setCollapsed(false)}
          sx={{
            position: "absolute",
            right: 12,
            bottom: 12,
            zIndex: 11,
            backgroundColor: "rgb(var(--template-palette-background-paperChannel) / 0.9)",
            border: 1,
            borderColor: "divider",
            backdropFilter: "blur(8px)",
            "&:hover": { backgroundColor: "rgb(var(--template-palette-background-paperChannel) / 0.98)" },
          }}
         aria-label={t("canvasTip.minimapExpand")}>
          <MapIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <Box
      sx={{
        position: "absolute",
        right: 12,
        bottom: 12,
        zIndex: 11,
        width: MAP_W,
        borderRadius: 1.5,
        border: 1,
        borderColor: "divider",
        overflow: "hidden",
        backgroundColor: "rgb(var(--template-palette-background-paperChannel) / 0.92)",
        backdropFilter: "blur(10px)",
        boxShadow: 3,
      }}
      // 小地图内部的滚轮不应该穿透去缩放画布
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 标题条：配色模式切换 + 折叠 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 0.75,
          py: 0.25,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <MapIcon sx={{ fontSize: 12, color: "text.secondary" }} />
        <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary", flex: 1 }}>
          {t("canvasTip.minimapTitle")}
        </Typography>
        <Tooltip title={colorMode === "risk" ? t("canvasTip.minimapRiskHint") : t("canvasTip.minimapLayerHint")}>
          <Typography
            variant="caption"
            onClick={() => setColorMode((m) => (m === "risk" ? "layer" : "risk"))}
            sx={{
              fontSize: 9,
              px: 0.5,
              cursor: "pointer",
              borderRadius: 0.5,
              color: "primary.main",
              "&:hover": { backgroundColor: "action.hover" },
            }}
          >
            {colorMode === "risk" ? t("canvasTip.minimapRiskShort") : t("canvasTip.minimapLayerShort")}
          </Typography>
        </Tooltip>
        <Tooltip title={t("canvasTip.minimapCollapse")}>
          <IconButton size="small" onClick={() => setCollapsed(true)} sx={{ p: 0.25 }} aria-label={t("canvasTip.minimapCollapse")}>
            <CloseIcon sx={{ fontSize: 11 }} />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ position: "relative", cursor: "crosshair" }} onMouseDown={handleMouseDown}>
        <svg ref={svgRef} width={MAP_W} height={MAP_H} style={{ display: "block" }}>
          <MinimapDots dots={dots} />
          {/* 视口框（位置由 rAF/effect 直写属性，React 只给占位） */}
          <rect
            ref={viewRectRef}
            x={0}
            y={0}
            width={0}
            height={0}
            fill="rgb(var(--template-palette-primary-mainChannel) / 0.12)"
            stroke="var(--template-palette-primary-main)"
            strokeWidth={1}
            pointerEvents="none"
          />
        </svg>
      </Box>

      {/* 图例：风险分布计数（也是「这个项目健不健康」的一行体检结论） */}
      {colorMode === "risk" && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 0.75, py: 0.25, borderTop: 1, borderColor: "divider", flexWrap: "wrap" }}>
          {(["critical", "warning", "watch", "healthy"] as RiskTier[])
            .filter((tier) => tiers[tier] > 0)
            .map((tier) => (
              <Tooltip key={tier} title={t("canvasTip.minimapTierTip", { label: t(RISK_TIER_LABEL_KEYS[tier]), n: tiers[tier] })}>
                <Box
                  onClick={() => handleFocusTier(tier)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.25,
                    px: 0.25,
                    borderRadius: 0.5,
                    cursor: "pointer",
                    "&:hover": { backgroundColor: "action.hover" },
                  }}
                >
                  <Box sx={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: RISK_TIER_COLORS[tier] }} />
                  <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary" }}>
                    {tiers[tier]}
                  </Typography>
                </Box>
              </Tooltip>
            ))}
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" sx={{ fontSize: 9, color: "text.disabled" }}>
            {t("canvasTip.minimapNavigate")}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
