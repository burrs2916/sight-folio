import { memo, useState, useCallback } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import LayersIcon from "@mui/icons-material/Layers";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import { useProjectStore } from "../../store/projectStore";
import { t, resolveFragments } from "../../i18n";

const LAYER_COLORS = [
  "#94A3B8",
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
];

/**
 * 架构分层管理对话框
 * 显示当前 analysis 的所有分层 + 文件归属
 */
export const ArchitectureLayersPanel = memo(function ArchitectureLayersPanel({
  open,
  onClose,
  analysisId,
}: {
  open: boolean;
  onClose: () => void;
  analysisId: string | null;
}) {
  const layers = useProjectStore((s) => s.layers);
  const files = useProjectStore((s) => s.files);
  const createLayer = useProjectStore((s) => s.createLayer);
  const deleteLayer = useProjectStore((s) => s.deleteLayer);
  const saveLayer = useProjectStore((s) => s.saveLayer);

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(LAYER_COLORS[0]);
  const [editingNames, setEditingNames] = useState<Record<string, string>>({});
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!analysisId || !newName.trim()) return;
    const newLayer = await createLayer(analysisId, newName.trim(), newColor);
    if (newLayer) {
      // 设置 sortOrder 为新层的位置
      await saveLayer({ ...newLayer, sortOrder: layers.length, updatedAt: Math.floor(Date.now() / 1000) });
    }
    setNewName("");
    setNewColor(LAYER_COLORS[(layers.length + 1) % LAYER_COLORS.length]);
  };

  // 排序：上移
  const handleMoveUp = useCallback(
    async (index: number) => {
      if (index <= 0) return;
      const layer = layers[index];
      const prevLayer = layers[index - 1];
      if (!layer || !prevLayer) return;
      await saveLayer({ ...layer, sortOrder: prevLayer.sortOrder, updatedAt: Math.floor(Date.now() / 1000) });
      await saveLayer({ ...prevLayer, sortOrder: layer.sortOrder, updatedAt: Math.floor(Date.now() / 1000) });
    },
    [layers, saveLayer]
  );

  // 排序：下移
  const handleMoveDown = useCallback(
    async (index: number) => {
      if (index >= layers.length - 1) return;
      const layer = layers[index];
      const nextLayer = layers[index + 1];
      if (!layer || !nextLayer) return;
      await saveLayer({ ...layer, sortOrder: nextLayer.sortOrder, updatedAt: Math.floor(Date.now() / 1000) });
      await saveLayer({ ...nextLayer, sortOrder: layer.sortOrder, updatedAt: Math.floor(Date.now() / 1000) });
    },
    [layers, saveLayer]
  );

  // 防抖保存名称：只在失焦时保存
  const handleBlurName = useCallback(
    (layer: any) => {
      const newName = editingNames[layer.id];
      if (newName !== undefined && newName.trim() && newName.trim() !== layer.name) {
        saveLayer({ ...layer, name: newName.trim(), updatedAt: Math.floor(Date.now() / 1000) });
      }
      setEditingNames((prev) => {
        const next = { ...prev };
        delete next[layer.id];
        return next;
      });
    },
    [saveLayer, editingNames]
  );

  // 选择颜色
  const handleColorChange = useCallback(
    (layer: any, color: string) => {
      saveLayer({ ...layer, color, updatedAt: Math.floor(Date.now() / 1000) });
    },
    [saveLayer]
  );

  // 统计每个层的文件数
  const counts: Record<string, number> = {};
  files.forEach((f) => {
    if (!f.isDirectory && f.layerId) {
      counts[f.layerId] = (counts[f.layerId] || 0) + 1;
    }
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <LayersIcon sx={{ color: "primary.main" }} />
        {t("panel.layers.title")}
      </DialogTitle>
      <DialogContent dividers>
        {/* 新建 */}
        <Box sx={{ display: "flex", gap: 1, mb: 3, alignItems: "center" }}>
          <TextField
            size="small"
            label={t("panel.layers.newName")}
            placeholder={t("panel.layers.placeholder")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            sx={{ flex: 1 }}
          />
          <Box sx={{ display: "flex", gap: 0.5 }}>
            {LAYER_COLORS.map((c) => (
              <Box
                key={c}
                onClick={() => setNewColor(c)}
                sx={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  backgroundColor: c,
                  cursor: "pointer",
                  border: newColor === c ? "2px solid" : "1px solid",
                  borderColor: newColor === c ? "primary.main" : "divider",
                  transition: "all 0.15s",
                }}
              />
            ))}
          </Box>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleCreate}
            disabled={!newName.trim()}
          >
            {t("panel.layers.create")}
          </Button>
        </Box>

        {/* 已有分层 */}
        {layers.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
            <LayersIcon sx={{ fontSize: 40, opacity: 0.3 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>
              {t("panel.layers.noTitle")}
            </Typography>
            <Typography variant="caption">
              {t("panel.layers.noHint")}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {layers
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((layer, idx) => (
                <Box
                  key={layer.id}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    p: 1.5,
                    borderRadius: 1,
                    border: 1,
                    borderColor: "divider",
                    "&:hover": { borderColor: "primary.main" },
                  }}
                >
                  {/* 排序序号 */}
                  <Typography variant="caption" color="text.disabled" sx={{ width: 20, textAlign: "center", flexShrink: 0, fontSize: 10 }}>
                    {idx + 1}
                  </Typography>

                  {/* 颜色选择器 */}
                  <Box sx={{ position: "relative", flexShrink: 0 }}>
                    <Box
                      onClick={() => setColorPickerOpen(colorPickerOpen === layer.id ? null : layer.id)}
                      sx={{
                        width: 32,
                        height: 32,
                        borderRadius: 1,
                        backgroundColor: layer.color,
                        cursor: "pointer",
                        border: "2px solid transparent",
                        "&:hover": { borderColor: "primary.main" },
                      }}
                    />
                    {colorPickerOpen === layer.id && (
                      <Box
                        sx={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          zIndex: 10,
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 0.5,
                          p: 1,
                          bgcolor: "background.paper",
                          borderRadius: 1,
                          boxShadow: 4,
                          border: 1,
                          borderColor: "divider",
                          minWidth: 120,
                          mt: 0.5,
                        }}
                      >
                        {LAYER_COLORS.map((c) => (
                          <Box
                            key={c}
                            onClick={() => {
                              handleColorChange(layer, c);
                              setColorPickerOpen(null);
                            }}
                            sx={{
                              width: 22,
                              height: 22,
                              borderRadius: "50%",
                              backgroundColor: c,
                              cursor: "pointer",
                              border: layer.color === c ? "2px solid" : "1px solid",
                              borderColor: layer.color === c ? "primary.main" : "divider",
                              transition: "all 0.1s",
                              "&:hover": { transform: "scale(1.2)" },
                            }}
                          />
                        ))}
                      </Box>
                    )}

                  </Box>
                  {/* 名称（内联编辑 - 失焦保存） */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <TextField
                      size="small"
                      value={editingNames[layer.id] !== undefined ? editingNames[layer.id] : resolveFragments(layer.name)}
                      onChange={(e) =>
                        setEditingNames((prev) => ({ ...prev, [layer.id]: e.target.value }))
                      }
                      onBlur={() => handleBlurName(layer)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleBlurName(layer);
                      }}
                      fullWidth
                      variant="standard"
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {t("panel.layers.files", { n: counts[layer.id] || 0 })}
                  </Typography>

                  {/* 排序按钮 */}
                  <IconButton size="small" onClick={() => handleMoveUp(idx)} disabled={idx === 0}>
                    <ArrowUpwardIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                  <IconButton size="small" onClick={() => handleMoveDown(idx)} disabled={idx >= layers.length - 1}>
                    <ArrowDownwardIcon sx={{ fontSize: 14 }} />
                  </IconButton>

                  {/* 删除 */}
                  <IconButton size="small" onClick={() => deleteLayer(layer.id)} color="error">
                    <DeleteIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              ))}
          </Box>
        )}

        {/* 提示 */}
        <Box sx={{ mt: 3, p: 1.5, borderRadius: 1, backgroundColor: "action.hover" }}>
          <Typography variant="caption" color="text.secondary">
            {t("panel.layers.tip")}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("panel.layers.close")}</Button>
      </DialogActions>
    </Dialog>
  );
});