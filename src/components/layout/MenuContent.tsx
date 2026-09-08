import { useState, useCallback } from "react";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DashboardRoundedIcon from "@mui/icons-material/DashboardRounded";
import LayersRoundedIcon from "@mui/icons-material/LayersRounded";
import StorageRoundedIcon from "@mui/icons-material/StorageRounded";
import ExtensionRoundedIcon from "@mui/icons-material/ExtensionRounded";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import { useLocation, useNavigate } from "react-router-dom";
import { useSceneStore } from "../../store/sceneStore";
import { useLayoutStore } from "../../store/layoutStore";
import { t } from "../../i18n";
import type { AnalysisDSL } from "../../types/scene";
import { languageColor } from "../../utils/languageMeta";

/** 导航分组定义 */
interface NavItemDef {
  text: string;
  icon: React.ReactNode;
  path: string;
}
interface NavGroupDef {
  id: string;
  label: string;
  items: NavItemDef[];
}

/**
 * 主导航定义：必须在函数体内求值 —— t() 随当前语言取值，
 * 若放模块级会在加载时固化，切换语言后菜单不更新（历史事故）。
 */
function getNavGroups(): NavGroupDef[] {
  return [
    {
      id: "main",
      label: t("nav.main"),
      items: [
        { text: t("nav.dashboard"), icon: <DashboardRoundedIcon sx={{ fontSize: 19 }} />, path: "/" },
        { text: t("nav.analyzer"), icon: <LayersRoundedIcon sx={{ fontSize: 19 }} />, path: "/analyzer" },
        { text: t("nav.entities"), icon: <ExtensionRoundedIcon sx={{ fontSize: 19 }} />, path: "/entities" },
        { text: t("nav.published"), icon: <PublicRoundedIcon sx={{ fontSize: 19 }} />, path: "/published" },
        { text: t("nav.ai"), icon: <SmartToyIcon sx={{ fontSize: 19 }} />, path: "/ai" },
      ],
    },
  ];
}

/** 行数格式化：1234 → 1.2k */
function formatLines(n?: number): string {
  if (!n || n <= 0) return "0";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 */
function relativeTime(ts?: number): string {
  if (!ts) return "";
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return t("time.justNow");
  if (diff < 3600) return t("time.minutesAgo", { n: Math.floor(diff / 60) });
  if (diff < 86400) return t("time.hoursAgo", { n: Math.floor(diff / 3600) });
  return t("time.daysAgo", { n: Math.floor(diff / 86400) });
}

/** 选中态导航项样式（主色指示条 + 主色 10% 底） */
const navButtonSx = (selected: boolean, collapsed: boolean) => ({
  borderRadius: 1.5,
  mx: 1,
  minHeight: 40,
  position: "relative" as const,
  justifyContent: collapsed ? "center" : "flex-start",
  px: collapsed ? 1 : 1.5,
  transition: "background-color 0.15s",
  "&.Mui-selected": {
    backgroundColor: (t: any) =>
      t.palette.mode === "dark" ? "rgba(99,102,241,0.16)" : "rgba(99,102,241,0.1)",
    "&:hover": {
      backgroundColor: (t: any) =>
        t.palette.mode === "dark" ? "rgba(99,102,241,0.24)" : "rgba(99,102,241,0.16)",
    },
  },
  "& .nav-indicator": {
    opacity: selected ? 1 : 0,
  },
});

/** 左侧主色指示条 */
function NavIndicator() {
  return (
    <Box
      component="span"
      className="nav-indicator"
      sx={{
        position: "absolute",
        left: 2,
        top: "50%",
        transform: "translateY(-50%)",
        width: 3,
        height: 20,
        borderRadius: 2,
        bgcolor: "primary.main",
        opacity: 0,
        transition: "opacity 0.2s",
      }}
    />
  );
}

export default function MenuContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const collapsed = useLayoutStore((s) => s.config.sidebarCollapsed);

  const scenes = useSceneStore((s) => s.scenes);
  const activeSceneId = useSceneStore((s) => s.activeSceneId);
  const setActiveScene = useSceneStore((s) => s.setActiveScene);
  const createScene = useSceneStore((s) => s.createScene);
  const updateScene = useSceneStore((s) => s.updateScene);
  const deleteScene = useSceneStore((s) => s.deleteScene);
  const duplicateScene = useSceneStore((s) => s.duplicateScene);

  const onSelectAnalysis = (id: string) => {
    setActiveScene(id);
    if (location.pathname !== "/analyzer") navigate("/analyzer");
  };

  const onNewAnalysis = async () => {
    try {
      const scene = await createScene({ name: t("nav.newAnalysisName", { n: scenes.length + 1 }) });
      setActiveScene(scene.id);
      navigate("/analyzer");
    } catch (e) {
      console.error("[MenuContent] create scene failed", e);
    }
  };

  // ─── 分析项上下文菜单 ───
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    scene: AnalysisDSL;
  } | null>(null);

  const [renameDialog, setRenameDialog] = useState<{
    open: boolean;
    scene: AnalysisDSL | null;
    name: string;
  }>({ open: false, scene: null, name: "" });

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, scene: AnalysisDSL) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ mouseX: e.clientX, mouseY: e.clientY, scene });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleRename = useCallback(() => {
    if (!contextMenu) return;
    setRenameDialog({
      open: true,
      scene: contextMenu.scene,
      name: contextMenu.scene.name,
    });
    setContextMenu(null);
  }, [contextMenu]);

  const handleRenameConfirm = useCallback(async () => {
    if (!renameDialog.scene || !renameDialog.name.trim()) return;
    try {
      await updateScene(renameDialog.scene.id, { name: renameDialog.name.trim() });
    } catch (e) {
      console.error("[MenuContent] rename failed", e);
    }
    setRenameDialog({ open: false, scene: null, name: "" });
  }, [renameDialog, updateScene]);

  const handleDuplicate = useCallback(async () => {
    if (!contextMenu) return;
    try {
      const dup = await duplicateScene(contextMenu.scene.id);
      if (dup) {
        setActiveScene(dup.id);
        if (location.pathname !== "/analyzer") navigate("/analyzer");
      }
    } catch (e) {
      console.error("[MenuContent] duplicate failed", e);
    }
    setContextMenu(null);
  }, [contextMenu, duplicateScene, setActiveScene, location.pathname, navigate]);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;
    try {
      const sceneId = contextMenu.scene.id;
      // 如果删除的是当前激活的分析，先切换到其他分析
      if (sceneId === activeSceneId) {
        const remaining = scenes.filter((s) => s.id !== sceneId);
        if (remaining.length > 0) {
          setActiveScene(remaining[0].id);
        }
      }
      await deleteScene(sceneId);
    } catch (e) {
      console.error("[MenuContent] delete failed", e);
    }
    setContextMenu(null);
  }, [contextMenu, activeSceneId, scenes, setActiveScene, deleteScene]);

  /** 分组小标题（折叠时不显示） */
  const GroupLabel = ({ children, count }: { children: React.ReactNode; count?: number }) =>
    collapsed ? null : (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          pt: 1.25,
          pb: 0.5,
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: "text.disabled",
          }}
        >
          {children}
        </Typography>
        {typeof count === "number" && (
          <Box
            sx={{
              minWidth: 16,
              height: 16,
              px: 0.5,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              fontWeight: 600,
              color: "text.secondary",
              bgcolor: "action.hover",
            }}
          >
            {count}
          </Box>
        )}
      </Box>
    );

  return (
    <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* ─── 主导航分组 ─── */}
      <Box sx={{ overflowY: "auto", flex: 1, pb: 1 }}>
        {getNavGroups().map((group) => (
          <List key={group.id} dense sx={{ py: 0.5 }}>
            <GroupLabel>{group.label}</GroupLabel>
            {group.items.map((item) => {
              const selected = location.pathname === item.path;
              const btn = (
                <ListItemButton
                  selected={selected}
                  onClick={() => navigate(item.path)}
                  sx={navButtonSx(selected, collapsed)}
                >
                  <NavIndicator />
                  <ListItemIcon
                    sx={{
                      minWidth: 0,
                      mr: collapsed ? 0 : 2,
                      color: selected ? "primary.main" : "inherit",
                      justifyContent: "center",
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                  {!collapsed && (
                    <ListItemText
                      primary={
                        <Typography noWrap sx={{ fontSize: "0.84rem", fontWeight: selected ? 600 : 400 }}>
                          {item.text}
                        </Typography>
                      }
                    />
                  )}
                </ListItemButton>
              );
              return (
                <ListItem key={item.path} disablePadding sx={{ display: "block" }}>
                  {collapsed ? (
                    <Tooltip title={item.text} placement="right">
                      {btn}
                    </Tooltip>
                  ) : (
                    btn
                  )}
                </ListItem>
              );
            })}
          </List>
        ))}

        {/* ─── 我的分析：项目历史卡片（一个项目 = 一个分析） ─── */}
        {!collapsed && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              px: 2,
              pt: 1.25,
              pb: 0.5,
            }}
          >
            <Typography
              variant="caption"
              sx={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: "text.disabled",
              }}
            >
              {t("nav.myAnalyses")}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Box
                sx={{
                  minWidth: 16,
                  height: 16,
                  px: 0.5,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 600,
                  color: "text.secondary",
                  bgcolor: "action.hover",
                }}
              >
                {scenes.length}
              </Box>
              <Tooltip title={t("nav.newAnalysis")} placement="top">
                <IconButton
                  size="small"
                  onClick={onNewAnalysis}
                  sx={{
                    p: 0.25,
                    color: "primary.main",
                    "&:hover": { bgcolor: "rgba(99,102,241,0.12)" },
                  }}
                >
                  <AddRoundedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        )}
        <Box sx={{ px: 0.75, display: "flex", flexDirection: "column", gap: 0.5 }}>
          {scenes.map((scene) => {
            const selected = scene.id === activeSceneId;
            const langColor = languageColor(scene.primaryLanguage);
            const lang = scene.primaryLanguage || t("time.notScanned");
            const scanned = (scene.totalFiles ?? 0) > 0;
            return (
              <Tooltip key={scene.id} title={scene.name} placement="right" disableHoverListener={!collapsed}>
                <Paper
                  variant="outlined"
                  onClick={() => onSelectAnalysis(scene.id)}
                  onContextMenu={(e) => handleContextMenu(e, scene)}
                  sx={{
                    p: 0.75,
                    borderRadius: 1.5,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 0.75,
                    borderColor: selected ? "primary.main" : "divider",
                    bgcolor: selected ? "rgba(99,102,241,0.08)" : "transparent",
                    transition: "all 0.15s",
                    "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
                  }}
                >
                  {/* 语言色块 */}
                  <Box
                    sx={{
                      width: 30,
                      height: 30,
                      borderRadius: 1,
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      bgcolor: `${langColor}22`,
                      border: "1px solid",
                      borderColor: `${langColor}55`,
                    }}
                  >
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: langColor }} />
                  </Box>
                  {!collapsed && (
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography noWrap sx={{ fontSize: 12, fontWeight: selected ? 600 : 500, lineHeight: 1.3 }}>
                        {scene.name}
                      </Typography>
                      <Typography noWrap sx={{ fontSize: 9, color: "text.secondary", lineHeight: 1.4 }}>
                        {lang}
                        {scanned
                          ? ` · ${t("nav.fileCount", { n: scene.totalFiles })} · ${t("nav.lineCount", { n: formatLines(scene.totalLines) })}`
                          : ` · ${t("time.notScanned")}`}
                      </Typography>
                      <Typography noWrap sx={{ fontSize: 9, color: "text.disabled", lineHeight: 1.4 }}>
                        {relativeTime(scene.updatedAt)}
                      </Typography>
                    </Box>
                  )}
                </Paper>
              </Tooltip>
            );
          })}
        </Box>
        {/* 折叠态：列表底部放置新建入口 */}
        {collapsed && (
          <Box sx={{ px: 0.75, mt: 0.5, display: "flex", justifyContent: "center" }}>
            <Tooltip title={t("nav.newAnalysis")} placement="right">
              <IconButton
                size="small"
                onClick={onNewAnalysis}
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 1.5,
                  color: "primary.main",
                  border: "1px dashed",
                  borderColor: "primary.main",
                  "&:hover": { bgcolor: "rgba(99,102,241,0.12)" },
                }}
              >
                <AddRoundedIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>

      {/* ─── 分析项右键上下文菜单 ─── */}
      <Menu
        open={contextMenu !== null}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
        slotProps={{
          paper: {
            sx: {
              minWidth: 160,
              py: 0.5,
            },
          },
        }}
      >
        <MenuItem onClick={handleRename} dense sx={{ gap: 1, fontSize: 13 }}>
          <DriveFileRenameOutlineIcon sx={{ fontSize: 16 }} />
          {t("nav.rename")}
        </MenuItem>
        <MenuItem onClick={handleDuplicate} dense sx={{ gap: 1, fontSize: 13 }}>
          <ContentCopyIcon sx={{ fontSize: 16 }} />
          {t("nav.copy")}
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleDelete} dense sx={{ gap: 1, fontSize: 13, color: "error.main" }}>
          <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
          {t("nav.delete")}
        </MenuItem>
      </Menu>

      {/* ─── 重命名对话框 ─── */}
      <Dialog
        open={renameDialog.open}
        onClose={() => setRenameDialog({ open: false, scene: null, name: "" })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: 15 }}>{t("nav.renameTitle")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={t("nav.analysisName")}
            value={renameDialog.name}
            onChange={(e) =>
              setRenameDialog((prev) => ({ ...prev, name: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameConfirm();
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            size="small"
            onClick={() => setRenameDialog({ open: false, scene: null, name: "" })}
          >
            {t("nav.cancel")}
          </Button>
          <Button size="small" variant="contained" onClick={handleRenameConfirm}>
            {t("nav.confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
