// sight-folio: 图层面板（需求 §5.2 LayerPanel + 附录 A.3 图层交互）
// 补齐 biosphere 有而 sight-folio 缺失的图层管理 UI：
//   - 图层树（分组/图层两级，展开/折叠）
//   - 显示/隐藏、锁定/解锁、透明度、颜色点
//   - 添加图层/分组、删除（默认层禁删）
//   - 上移/下移排序（reorderLayer）
// store 接口（editorStore）全部为既有实现，本组件只提供 UI 入口。
import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Slider from "@mui/material/Slider";
import Menu from "@mui/material/Menu";
import Divider from "@mui/material/Divider";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import LayersIcon from "@mui/icons-material/Layers";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import OpacityIcon from "@mui/icons-material/Opacity";
import { useEditorStore } from "../../store/editorStore";
import type { LayerNode, SceneComponent } from "../../types/editor";
import { getLayerDescendants } from "../../types/editor";
import { t, resolveFragments } from "../../i18n";

const LAYER_COLORS = [
  "#2196F3", "#4CAF50", "#FF9800", "#9C27B0",
  "#F44336", "#00BCD4", "#E91E63", "#8BC34A",
];

/** 组内的子图层（按 order 排序） */
function childrenOf(layers: LayerNode[], layer: LayerNode): LayerNode[] {
  return layer.children
    .map((cid) => layers.find((l) => l.id === cid))
    .filter((l): l is LayerNode => !!l)
    .sort((a, b) => a.order - b.order);
}

/** 预计算每图层（含子图层）实体数 —— 纯函数，可测 */
export function countEntitiesPerLayer(
  layers: LayerNode[],
  components: Pick<SceneComponent, "layerId">[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const layer of layers) {
    if (layer.type !== "layer") continue;
    const ids = new Set(getLayerDescendants(layers, layer.id));
    let n = 0;
    for (const c of components) if (ids.has(c.layerId)) n++;
    counts[layer.id] = n;
  }
  return counts;
}

interface LayerRowProps {
  layer: LayerNode;
  depth: number;
  layers: LayerNode[];
  counts: Record<string, number>;
  isActive: boolean;
  onActivate: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onOpacityChange: (id: string, v: number) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRename: (id: string, name: string) => void;
}

function LayerRow({
  layer,
  depth,
  layers,
  counts,
  isActive,
  onActivate,
  onToggleVisibility,
  onToggleLock,
  onOpacityChange,
  onDelete,
  onMove,
  onRename,
}: LayerRowProps) {
  const [opacityAnchor, setOpacityAnchor] = useState<null | HTMLElement>(null);
  const isGroup = layer.type === "group";
  const kids = useMemo(() => childrenOf(layers, layer), [layers, layer]);
  const updateLayer = useEditorStore((s) => s.updateLayer);

  return (
    <>
      <Box
        onClick={() => onActivate(layer.id)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 0.75,
          py: 0.45,
          cursor: "pointer",
          borderRadius: 0.75,
          backgroundColor: isActive ? "action.selected" : "transparent",
          "&:hover": { backgroundColor: isActive ? "action.selected" : "action.hover" },
        }}
      >
        {/* 层级缩进 + 展开箭头/组图标 */}
        <Box sx={{ width: depth * 12, flexShrink: 0 }} />
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            flexShrink: 0,
            color: "text.secondary",
          }}
          onClick={(e) => {
            if (isGroup) {
              e.stopPropagation();
              updateLayer(layer.id, { expanded: !layer.expanded });
            }
          }}
        >
          {isGroup ? (
            layer.expanded ? (
              <ExpandMoreIcon sx={{ fontSize: 15 }} />
            ) : (
              <ChevronRightIcon sx={{ fontSize: 15 }} />
            )
          ) : null}
        </Box>
        {isGroup ? (
          layer.expanded ? (
            <FolderOpenIcon sx={{ fontSize: 15, color: layer.color || "#F59E0B", flexShrink: 0 }} />
          ) : (
            <FolderIcon sx={{ fontSize: 15, color: layer.color || "#F59E0B", flexShrink: 0 }} />
          )
        ) : (
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: layer.color || LAYER_COLORS[layer.order % LAYER_COLORS.length],
              flexShrink: 0,
            }}
          />
        )}

        {/* 名称（双击改名） */}
        <Typography
          variant="body2"
          onDoubleClick={(e) => {
            e.stopPropagation();
            const next = window.prompt(t("layerPanel.renamePrompt"), resolveFragments(layer.name));
            if (next && next.trim()) onRename(layer.id, next.trim());
          }}
          sx={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: isGroup ? 600 : 400,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            opacity: layer.visible ? 1 : 0.45,
          }}
        >
          {resolveFragments(layer.name)}
          {!isGroup && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
              {counts[layer.id] ?? 0}
            </Typography>
          )}
        </Typography>

        {/* 行内操作：透明度 + 排序 + 删除 */}
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 0.25 }}
          onClick={(e) => e.stopPropagation()}
        >
          <IconButton
            size="small"
            onClick={() => onToggleVisibility(layer.id)}
            sx={{ width: 18, height: 18 }}
            title={layer.visible ? t("layerPanel.hide") : t("layerPanel.show")}
           aria-label={layer.visible ? t("layerPanel.hide") : t("layerPanel.show")}>
            {layer.visible ? (
              <VisibilityIcon sx={{ fontSize: 13 }} />
            ) : (
              <VisibilityOffIcon sx={{ fontSize: 13, color: "text.disabled" }} />
            )}
          </IconButton>
          <IconButton
            size="small"
            onClick={() => onToggleLock(layer.id)}
            sx={{ width: 18, height: 18 }}
            title={layer.locked ? t("layerPanel.unlock") : t("layerPanel.lock")}
           aria-label={layer.locked ? t("layerPanel.unlock") : t("layerPanel.lock")}>
            {layer.locked ? (
              <LockIcon sx={{ fontSize: 13, color: "warning.main" }} />
            ) : (
              <LockOpenIcon sx={{ fontSize: 13 }} />
            )}
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setOpacityAnchor(e.currentTarget);
            }}
            sx={{ width: 18, height: 18 }}
            title={t("layerPanel.opacity", { n: Math.round(layer.opacity * 100) })}
           aria-label={t("layerPanel.opacity", { n: Math.round(layer.opacity * 100) })}>
            <OpacityIcon sx={{ fontSize: 13 }} />
          </IconButton>
          <IconButton size="small" onClick={() => onMove(layer.id, -1)} sx={{ width: 18, height: 18 }} title={t("layerPanel.moveUp")} aria-label={t("layerPanel.moveUp")}>
            <ArrowUpwardIcon sx={{ fontSize: 12 }} />
          </IconButton>
          <IconButton size="small" onClick={() => onMove(layer.id, 1)} sx={{ width: 18, height: 18 }} title={t("layerPanel.moveDown")} aria-label={t("layerPanel.moveDown")}>
            <ArrowDownwardIcon sx={{ fontSize: 12 }} />
          </IconButton>
          {!layer.isDefault && (
            <IconButton size="small" onClick={() => onDelete(layer.id)} sx={{ width: 18, height: 18 }} title={t("layerPanel.delete")} aria-label={t("layerPanel.delete")}>
              <DeleteOutlineRoundedIcon sx={{ fontSize: 12, color: "error.main" }} />
            </IconButton>
          )}
        </Box>
      </Box>

      {/* 透明度滑块 Popover 菜单 */}
      <Menu
        anchorEl={opacityAnchor}
        open={!!opacityAnchor}
        onClose={() => setOpacityAnchor(null)}
        slotProps={{ paper: { sx: { px: 1.5, py: 1, minWidth: 160 } } }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
          {t("layerPanel.opacityLabel", { n: Math.round(layer.opacity * 100) })}
        </Typography>
        <Slider
          size="small"
          value={layer.opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(_, v) => onOpacityChange(layer.id, v as number)}
        />
      </Menu>

      {/* 分组子图层递归 */}
      {isGroup && layer.expanded && kids.map((kid) => (
        <LayerRow
          key={kid.id}
          layer={kid}
          depth={depth + 1}
          layers={layers}
          counts={counts}
          isActive={kid.id === useEditorStore.getState().activeLayerId}
          onActivate={onActivate}
          onToggleVisibility={onToggleVisibility}
          onToggleLock={onToggleLock}
          onOpacityChange={onOpacityChange}
          onDelete={onDelete}
          onMove={onMove}
          onRename={onRename}
        />
      ))}
    </>
  );
}

export function CanvasLayerPanel() {
  const layers = useEditorStore((s) => s.layers);
  const components = useEditorStore((s) => s.components);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const addLayer = useEditorStore((s) => s.addLayer);
  const addLayerGroup = useEditorStore((s) => s.addLayerGroup);
  const removeLayer = useEditorStore((s) => s.removeLayer);
  const updateLayer = useEditorStore((s) => s.updateLayer);
  const reorderLayer = useEditorStore((s) => s.reorderLayer);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);

  const counts = useMemo(
    () => countEntitiesPerLayer(layers, components),
    [layers, components]
  );

  const roots = useMemo(
    () =>
      layers
        .filter((l) => l.parentId === null)
        .sort((a, b) => a.order - b.order),
    [layers]
  );

  const totalEntities = useMemo(
    () => Object.values(counts).reduce((a, b) => a + b, 0),
    [counts]
  );

  /** 上移/下移：与同级兄弟交换 order */
  const handleMove = (id: string, dir: -1 | 1) => {
    const layer = layers.find((l) => l.id === id);
    if (!layer) return;
    const siblings = layers
      .filter((l) => l.parentId === layer.parentId)
      .sort((a, b) => a.order - b.order);
    const idx = siblings.findIndex((l) => l.id === id);
    const target = siblings[idx + dir];
    if (!target) return;
    reorderLayer(id, target.order);
    reorderLayer(target.id, layer.order);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* 顶部操作条 */}
      <Box sx={{ px: 1, py: 0.75, display: "flex", alignItems: "center", gap: 0.5, borderBottom: 1, borderColor: "divider" }}>
        <LayersIcon sx={{ fontSize: 15, color: "text.secondary" }} />
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, fontSize: 11 }}>
          {t("layerPanel.stats", { n: roots.length, m: totalEntities })}
        </Typography>
        <Tooltip title={t("layerPanel.addLayer")}>
          <IconButton size="small" onClick={() => addLayer(undefined, activeLayerId)} sx={{ width: 24, height: 24 }} aria-label={t("layerPanel.addLayer")}>
            <AddIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("layerPanel.addGroup")}>
          <IconButton size="small" onClick={() => addLayerGroup(undefined, activeLayerId)} sx={{ width: 24, height: 24 }} aria-label={t("layerPanel.addGroup")}>
            <FolderIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 0.5, py: 0.5 }}>
        {roots.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 3, color: "text.secondary" }}>
            <LayersIcon sx={{ fontSize: 32, opacity: 0.2, mb: 1 }} />
            <Typography variant="caption" sx={{ display: "block" }}>
              {t("layerPanel.noLayers")}
            </Typography>
          </Box>
        ) : (
          roots.map((root) => (
            <LayerRow
              key={root.id}
              layer={root}
              depth={0}
              layers={layers}
              counts={counts}
              isActive={root.id === activeLayerId}
              onActivate={(id) => setActiveLayer(id)}
              onToggleVisibility={(id) => {
                const l = layers.find((x) => x.id === id);
                if (l) updateLayer(id, { visible: !l.visible });
              }}
              onToggleLock={(id) => {
                const l = layers.find((x) => x.id === id);
                if (l) updateLayer(id, { locked: !l.locked });
              }}
              onOpacityChange={(id, v) => updateLayer(id, { opacity: v })}
              onDelete={(id) => removeLayer(id)}
              onMove={handleMove}
              onRename={(id, name) => updateLayer(id, { name })}
            />
          ))
        )}
        <Divider sx={{ my: 1 }} />
        <Typography variant="caption" color="text.secondary" sx={{ px: 1, display: "block", fontSize: 10, lineHeight: 1.6 }}>
          {t("layerPanel.help1")}
          <br />
          {t("layerPanel.help2")}
        </Typography>
      </Box>
    </Box>
  );
}
