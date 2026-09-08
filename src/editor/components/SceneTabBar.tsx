import { useState, useCallback, useEffect, startTransition } from "react";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import TextField from "@mui/material/TextField";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import { useEditorStore } from "../../store/editorStore";
import { useSceneStore } from "../../store/sceneStore";
import { analyzerRegistry, useActiveAnalyzer, type ViewTemplateRegistration } from "../../editor/analyzer";
import { portraitForTemplate, runPortrait } from "../utils/portraits";
import { useToastStore } from "../../store/toastStore";
import { t, resolveFragments } from "../../i18n";

/** 插件视角模板 → 添加视图下拉 */
function ViewTemplateMenu({
  anchorEl,
  onClose,
  onSelect,
}: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onSelect: (template: ViewTemplateRegistration | null) => void;
}) {
  const active = useActiveAnalyzer();
  const templates = active ? analyzerRegistry.getViewTemplates(active.id) : [];
  const open = Boolean(anchorEl);

  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: 280, mt: 0.5 } } }}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
    >
      <Box sx={{ px: 2, py: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          {active ? t("viewTab.templateLabel", { name: resolveFragments(active.name) }) : t("viewTab.newView")}
        </Typography>
      </Box>
      <Divider />
      <MenuItem
        onClick={() => onSelect(null)}
        dense
        sx={{ py: 1 }}
      >
        <ListItemIcon>
          <AutoAwesomeOutlinedIcon sx={{ fontSize: 18 }} />
        </ListItemIcon>
        <ListItemText
          primary={<Typography variant="body2">{t("viewTab.customView")}</Typography>}
          secondary={<Typography variant="caption" color="text.secondary">{t("viewTab.customViewDesc")}</Typography>}
        />
      </MenuItem>
      {templates.length > 0 && <Divider />}
      {templates.map((t) => (
        <MenuItem key={t.type} onClick={() => onSelect(t)} dense sx={{ py: 1 }}>
          <ListItemIcon>
            <VisibilityOutlinedIcon sx={{ fontSize: 18 }} />
          </ListItemIcon>
          <ListItemText
            primary={<Typography variant="body2">{resolveFragments(t.name)}</Typography>}
            secondary={
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", whiteSpace: "normal" }}>
                {resolveFragments(t.description)}
              </Typography>
            }
          />
        </MenuItem>
      ))}
    </Menu>
  );
}

export function SceneTabBar() {
  const views = useEditorStore((s) => s.views);
  const activeViewId = useEditorStore((s) => s.activeViewId);
  const previewMode = useEditorStore((s) => s.previewMode);
  const switchView = useEditorStore((s) => s.switchView);
  const addView = useEditorStore((s) => s.addView);
  const removeView = useEditorStore((s) => s.removeView);
  const renameView = useEditorStore((s) => s.renameView);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);

  const handleSwitch = useCallback(
    (_: React.SyntheticEvent, value: string) => {
      startTransition(() => {
        switchView(value);
      });
    },
    [switchView]
  );

  const handleAddClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    setAddMenuAnchor(e.currentTarget);
  }, []);

  const handleAddMenuClose = useCallback(() => {
    setAddMenuAnchor(null);
  }, []);

  const handleAdd = useCallback(
    (template: ViewTemplateRegistration | null) => {
      setAddMenuAnchor(null);
      const idx = views.length + 1;
      if (template) {
        // 应用视角模板（§4.5）：defaultLayers → 新视图图层，layout → 缩放/平移/网格
        addView(template.name, {
          layers: template.defaultLayers.map((l) => ({ name: l.name, color: l.color })),
          layout: {
            scale: template.layout.scale,
            panX: template.layout.panX,
            panY: template.layout.panY,
            grid: template.layout.grid,
          },
        });
        // 视角模板 → 自动画像（§A 需求点）：模板名已暗示画像维度，
        // 创建完立即出图，避免"复杂度热力模板 → 空白画布"断链。
        // VIEW_TEMPLATE_PORTRAIT 已覆盖全部已注册模板 type，理论上不会落空；
        // 万一插件注册了未映射的新 type，这里给出明确提示而不是静默空白。
        const kind = portraitForTemplate(template.type);
        const sceneId = useSceneStore.getState().activeSceneId;
        // v2.30 修复：模板自动出图必须补传 projectRoot。重构四象限画像的 churn 维
        // 自愈（analyzeGitHistory）依赖 projectRoot，漏传时横轴（变更热度）永远全 0、
        // 散点塌成一条竖线 —— 用户观感即「不能用」。与菜单点击路径
        // （SceneEditorPage.tsx:994 已传 activeScene?.projectRoot）保持同一口径。
        const sceneRoot = useSceneStore.getState().getActiveScene()?.projectRoot ?? null;
        if (kind && sceneId) {
          void runPortrait(kind, sceneId, undefined, sceneRoot).then((o) =>
            useToastStore.getState().showToast(o.message, o.severity)
          );
        } else if (sceneId) {
          useToastStore
            .getState()
            .showToast(
              t("viewTab.noPortraitToast", { name: resolveFragments(template.name), type: template.type }),
              "info"
            );
        }
      } else {
        addView(t("viewTab.viewN", { n: idx }));
      }
    },
    [addView, views.length]
  );

  const handleRemove = useCallback(
    (viewId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setDeleteTarget(viewId);
    },
    [setDeleteTarget]
  );

  const confirmDelete = useCallback(() => {
    if (deleteTarget) {
      removeView(deleteTarget);
    }
    setDeleteTarget(null);
  }, [deleteTarget, removeView]);

  const startEdit = useCallback((viewId: string, name: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingId(viewId);
    setEditingName(resolveFragments(name));
  }, []);

  const confirmEdit = useCallback(() => {
    if (editingId && editingName.trim()) {
      const trimmed = editingName.trim();
      const duplicate = views.some((v) => v.id !== editingId && v.name === trimmed);
      if (duplicate) {
        return;
      }
      renameView(editingId, trimmed);
    }
    setEditingId(null);
  }, [editingId, editingName, renameView, views]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  useEffect(() => {
    if (!previewMode || views.length <= 1) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const currentIdx = views.findIndex((v) => v.id === activeViewId);
      if (e.key === "ArrowLeft" && currentIdx > 0) {
        e.preventDefault();
        startTransition(() => {
          switchView(views[currentIdx - 1].id);
        });
      } else if (e.key === "ArrowRight" && currentIdx < views.length - 1) {
        e.preventDefault();
        startTransition(() => {
          switchView(views[currentIdx + 1].id);
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewMode, views, activeViewId, switchView]);

  if (previewMode && views.length <= 1) {
    return null;
  }

  if (previewMode && views.length > 1) {
    return (
      <Box
        sx={{
          position: "absolute",
          top: 8,
          left: 8,
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          backgroundColor: (theme) =>
            theme.palette.mode === "dark"
              ? "rgba(30,30,42,0.85)"
              : "rgba(255,255,255,0.85)",
          borderRadius: 1.5,
          px: 0.5,
          py: 0.25,
          backdropFilter: "blur(12px)",
          border: 1,
          borderColor: (theme) =>
            theme.palette.mode === "dark"
              ? "rgba(255,255,255,0.08)"
              : "rgba(0,0,0,0.06)",
          opacity: 0.4,
          transition: "opacity 0.2s",
          "&:hover": { opacity: 1 },
          userSelect: "none",
        }}
      >
        {views.map((view) => (
          <Box
            key={view.id}
            onClick={() => switchView(view.id)}
            sx={{
              px: 1.5,
              py: 0.5,
              fontSize: 12,
              cursor: "pointer",
              borderRadius: 1,
              color: activeViewId === view.id ? "primary.main" : "text.secondary",
              backgroundColor:
                activeViewId === view.id
                  ? (theme) =>
                      theme.palette.mode === "dark"
                        ? "rgba(144,202,249,0.15)"
                        : "rgba(25,118,210,0.08)"
                  : "transparent",
              fontWeight: activeViewId === view.id ? 600 : 400,
              transition: "all 0.15s",
              "&:hover": {
                backgroundColor:
                  activeViewId === view.id
                    ? (theme) =>
                        theme.palette.mode === "dark"
                          ? "rgba(144,202,249,0.2)"
                          : "rgba(25,118,210,0.12)"
                    : (theme) =>
                        theme.palette.mode === "dark"
                          ? "rgba(255,255,255,0.06)"
                          : "rgba(0,0,0,0.04)",
              },
            }}
          >
            {resolveFragments(view.name)}
          </Box>
        ))}
      </Box>
    );
  }

  const isDuplicateName = editingId
    ? views.some((v) => v.id !== editingId && v.name === editingName.trim())
    : false;

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        height: 36,
        minHeight: 36,
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        px: 0.5,
        userSelect: "none",
      }}
    >
      {views.length === 1 ? (
        <>
          <Box sx={{ display: "flex", alignItems: "center", px: 1.5, fontSize: 12, color: "text.primary" }}>
            {editingId === views[0].id ? (
              <TextField
                value={editingName}
                size="small"
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isDuplicateName) confirmEdit();
                  if (e.key === "Escape") cancelEdit();
                }}
                onBlur={() => {
                  if (!isDuplicateName) confirmEdit();
                }}
                autoFocus
                error={isDuplicateName}
                helperText={isDuplicateName ? t("viewTab.nameExists") : undefined}
                sx={{
                  "& .MuiInputBase-input": { fontSize: 12, py: 0, px: 0.5, height: 20 },
                  "& .MuiOutlinedInput-root": { py: 0 },
                  "& .MuiFormHelperText-root": { fontSize: 9, mx: 0, mt: 0.5, lineHeight: 1 },
                  width: isDuplicateName ? 100 : 80,
                }}
              />
            ) : views[0].id === "default" ? (
              <span style={{ cursor: "default" }}>{resolveFragments(views[0].name)}</span>
            ) : (
              <>
                <span
                  onDoubleClick={() => startEdit(views[0].id, views[0].name)}
                  style={{ cursor: "text" }}
                >
                  {resolveFragments(views[0].name)}
                </span>
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); startEdit(views[0].id, views[0].name); }}
                  sx={{ p: 0.15, ml: 0.5, opacity: 0.3, "&:hover": { opacity: 1 } }}
                >
                  <EditIcon sx={{ fontSize: 10 }} />
                </IconButton>
              </>
            )}
          </Box>
          <Box sx={{ flex: 1 }} />
          <Tooltip title={t("viewTab.addViewTip")}>
            <IconButton size="small" onClick={handleAddClick} sx={{ mx: 0.5 }}>
              <AddIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </>
      ) : (
        <>
          <Tabs
            value={activeViewId}
            onChange={handleSwitch}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              minHeight: 36,
              flex: 1,
              "& .MuiTabs-indicator": { height: 2, bottom: 0 },
              "& .MuiTab-root": {
                minHeight: 36,
                px: 1.5,
                py: 0,
                fontSize: 12,
                textTransform: "none",
                minWidth: "auto",
              },
            }}
          >
            {views.map((view) => (
              <Tab
                key={view.id}
                value={view.id}
                label={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    {editingId === view.id ? (
                      <TextField
                        value={editingName}
                        size="small"
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !isDuplicateName) confirmEdit();
                          if (e.key === "Escape") cancelEdit();
                        }}
                        onBlur={() => {
                          if (!isDuplicateName) confirmEdit();
                        }}
                        autoFocus
                        error={isDuplicateName}
                        helperText={isDuplicateName ? t("viewTab.nameExists") : undefined}
                        sx={{
                          "& .MuiInputBase-input": { fontSize: 12, py: 0, px: 0.5, height: 20 },
                          "& .MuiOutlinedInput-root": { py: 0 },
                          "& .MuiFormHelperText-root": { fontSize: 9, mx: 0, mt: 0.5, lineHeight: 1 },
                          width: isDuplicateName ? 100 : 80,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <span
                          onDoubleClick={(e) => { e.stopPropagation(); if (view.id !== "default") startEdit(view.id, view.name); }}
                          style={{ cursor: view.id === "default" ? "default" : "text" }}
                        >
                          {resolveFragments(view.name)}
                        </span>
                        {views.length > 1 && view.id !== "default" && (
                          <>
                            <Box
                              component="span"
                              role="button"
                              tabIndex={0}
                              onClick={(e) => startEdit(view.id, view.name, e)}
                              sx={{ display: "inline-flex", alignItems: "center", justifyContent: "center", p: 0.15, opacity: 0.3, cursor: "pointer", borderRadius: 0.5, "&:hover": { opacity: 1 } }}
                            >
                              <EditIcon sx={{ fontSize: 10 }} />
                            </Box>
                            <Box
                              component="span"
                              role="button"
                              tabIndex={0}
                              onClick={(e) => handleRemove(view.id, e)}
                              sx={{ display: "inline-flex", alignItems: "center", justifyContent: "center", p: 0.15, opacity: 0.3, cursor: "pointer", borderRadius: 0.5, "&:hover": { opacity: 1 } }}
                            >
                              <CloseIcon sx={{ fontSize: 10 }} />
                            </Box>
                          </>
                        )}
                      </>
                    )}
                  </Box>
                }
              />
            ))}
          </Tabs>
          <Tooltip title={t("viewTab.addViewTip")}>
            <IconButton size="small" onClick={handleAddClick} sx={{ mx: 0.5 }}>
              <AddIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </>
      )}

      <ViewTemplateMenu anchorEl={addMenuAnchor} onClose={handleAddMenuClose} onSelect={handleAdd} />

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>{t("viewTab.deleteTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t("viewTab.deleteConfirm", { name: resolveFragments(views.find((v) => v.id === deleteTarget)?.name ?? "") })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} size="small">{t("viewTab.cancel")}</Button>
          <Button onClick={confirmDelete} color="error" size="small" variant="contained">{t("viewTab.delete")}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
