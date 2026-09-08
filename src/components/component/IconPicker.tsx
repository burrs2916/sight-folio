import React, { useState, useEffect, useMemo } from "react";
import { t, resolveFragments } from "../../i18n";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import HistoryIcon from "@mui/icons-material/History";
import FolderIcon from "@mui/icons-material/Folder";
import CategoryIcon from "@mui/icons-material/Category";
import WidgetsIcon from "@mui/icons-material/Widgets";
import ExtensionIcon from "@mui/icons-material/Extension";
import SettingsIcon from "@mui/icons-material/Settings";
import DashboardIcon from "@mui/icons-material/Dashboard";
import LayersIcon from "@mui/icons-material/Layers";
import GridOnIcon from "@mui/icons-material/GridOn";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import RefreshIcon from "@mui/icons-material/Refresh";
import CheckIcon from "@mui/icons-material/Check";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import InfoIcon from "@mui/icons-material/Info";
import WarningIcon from "@mui/icons-material/Warning";
import ErrorIcon from "@mui/icons-material/Error";
import HelpIcon from "@mui/icons-material/Help";
import StarIcon from "@mui/icons-material/Star";
import VisibilityIcon from "@mui/icons-material/Visibility";
import CloseIcon from "@mui/icons-material/Close";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import BarChartIcon from "@mui/icons-material/BarChart";
import InsertChartIcon from "@mui/icons-material/InsertChart";
import PieChartIcon from "@mui/icons-material/PieChart";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import TimelineIcon from "@mui/icons-material/Timeline";
import BubbleChartIcon from "@mui/icons-material/BubbleChart";
import ScatterPlotIcon from "@mui/icons-material/ScatterPlot";
import DonutLargeIcon from "@mui/icons-material/DonutLarge";
import StackedBarChartIcon from "@mui/icons-material/StackedBarChart";
import WaterfallChartIcon from "@mui/icons-material/WaterfallChart";
import TableChartIcon from "@mui/icons-material/TableChart";
import SpeedIcon from "@mui/icons-material/Speed";
import MapIcon from "@mui/icons-material/Map";
import ArchitectureIcon from "@mui/icons-material/Architecture";
import WallpaperIcon from "@mui/icons-material/Wallpaper";
import WhatshotIcon from "@mui/icons-material/Whatshot";
import PublicIcon from "@mui/icons-material/Public";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import ImageIcon from "@mui/icons-material/Image";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import VideocamIcon from "@mui/icons-material/Videocam";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import PaletteIcon from "@mui/icons-material/Palette";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import TimerIcon from "@mui/icons-material/Timer";
import UploadIcon from "@mui/icons-material/Upload";
import DownloadIcon from "@mui/icons-material/Download";
import { resolveIcon } from "../../editor/plugins";
import { iconsApi } from "../../services/tauri";
import { ICON_SOURCE_PREFIX } from "../../utils/iconSource";
import type { IconGroup, SystemIcon } from "../../services/tauri";
import { CustomIconTabs } from "./CustomIconTabs";

export const ICON_CATEGORIES: Array<{
  label: string;
  items: Array<{ key: string; label: string; Icon: React.ComponentType<any> }>;
}> = [
  {
    label: "icon.cat.0",
    items: [
      { key: "folder", label: "icon.folder", Icon: FolderIcon },
      { key: "category", label: "icon.category", Icon: CategoryIcon },
      { key: "widgets", label: "icon.widgets", Icon: WidgetsIcon },
      { key: "extension", label: "icon.extension", Icon: ExtensionIcon },
      { key: "settings", label: "icon.settings", Icon: SettingsIcon },
      { key: "dashboard", label: "icon.dashboard", Icon: DashboardIcon },
      { key: "layers", label: "icon.layers", Icon: LayersIcon },
      { key: "grid_on", label: "icon.grid_on", Icon: GridOnIcon },
      { key: "search", label: "icon.search", Icon: SearchIcon },
      { key: "add", label: "icon.add", Icon: AddIcon },
      { key: "edit", label: "icon.edit", Icon: EditIcon },
      { key: "delete", label: "icon.delete", Icon: DeleteIcon },
      { key: "refresh", label: "icon.refresh", Icon: RefreshIcon },
      { key: "check", label: "icon.check", Icon: CheckIcon },
      { key: "check_circle", label: "icon.check_circle", Icon: CheckCircleIcon },
      { key: "info", label: "icon.info", Icon: InfoIcon },
      { key: "warning", label: "icon.warning", Icon: WarningIcon },
      { key: "error", label: "icon.error", Icon: ErrorIcon },
      { key: "help", label: "icon.help", Icon: HelpIcon },
      { key: "star", label: "icon.star", Icon: StarIcon },
      { key: "visibility", label: "icon.visibility", Icon: VisibilityIcon },
      { key: "close", label: "icon.close", Icon: CloseIcon },
      { key: "arrow_back", label: "icon.arrow_back", Icon: ArrowBackIcon },
      { key: "arrow_forward", label: "icon.arrow_forward", Icon: ArrowForwardIcon },
    ],
  },
  {
    label: "icon.cat.1",
    items: [
      { key: "bar_chart", label: "icon.bar_chart", Icon: BarChartIcon },
      { key: "insert_chart", label: "icon.insert_chart", Icon: InsertChartIcon },
      { key: "pie_chart", label: "icon.pie_chart", Icon: PieChartIcon },
      { key: "show_chart", label: "icon.show_chart", Icon: ShowChartIcon },
      { key: "timeline", label: "icon.timeline", Icon: TimelineIcon },
      { key: "bubble_chart", label: "icon.bubble_chart", Icon: BubbleChartIcon },
      { key: "scatter_plot", label: "icon.scatter_plot", Icon: ScatterPlotIcon },
      { key: "donut_large", label: "icon.donut_large", Icon: DonutLargeIcon },
      { key: "stacked_bar_chart", label: "icon.stacked_bar_chart", Icon: StackedBarChartIcon },
      { key: "waterfall_chart", label: "icon.waterfall_chart", Icon: WaterfallChartIcon },
      { key: "table_chart", label: "icon.table_chart", Icon: TableChartIcon },
      { key: "speed", label: "icon.speed", Icon: SpeedIcon },
    ],
  },
  {
    label: "icon.cat.2",
    items: [
      { key: "map", label: "icon.map", Icon: MapIcon },
      { key: "architecture", label: "icon.architecture", Icon: ArchitectureIcon },
      { key: "wallpaper", label: "icon.wallpaper", Icon: WallpaperIcon },
      { key: "public", label: "icon.public", Icon: PublicIcon },
      { key: "whatshot", label: "icon.whatshot", Icon: WhatshotIcon },
      { key: "layers", label: "icon.layers", Icon: LayersIcon },
      { key: "view_in_ar", label: "icon.view_in_ar", Icon: ViewInArIcon },
    ],
  },
  {
    label: "icon.cat.3",
    items: [
      { key: "text_fields", label: "icon.text_fields", Icon: TextFieldsIcon },
      { key: "image", label: "icon.image", Icon: ImageIcon },
      { key: "crop_square", label: "icon.crop_square", Icon: CropSquareIcon },
      { key: "videocam", label: "icon.videocam", Icon: VideocamIcon },
      { key: "music_note", label: "icon.music_note", Icon: MusicNoteIcon },
      { key: "palette", label: "icon.palette", Icon: PaletteIcon },
      { key: "auto_awesome", label: "icon.auto_awesome", Icon: AutoAwesomeIcon },
      { key: "timer", label: "icon.timer", Icon: TimerIcon },
    ],
  },
  {
    label: "icon.cat.4",
    items: [
      { key: "upload", label: "icon.upload", Icon: UploadIcon },
      { key: "download", label: "icon.download", Icon: DownloadIcon },
    ],
  },
];

const EMOJI_CATEGORIES: Array<{ label: string; items: string[] }> = [
  { label: "icon.emoji.auth", items: ["🔑", "🚪", "🔄", "✅", "👤", "🛡️", "🔒", "🔓", "🔐", "🔏", "📜", "🪪", "🗝️"] },
  { label: "icon.emoji.system", items: ["⚙️", "🔧", "📊", "📈", "📉", "📋", "📁", "📂", "🗂️", "📅", "📆", "⏰", "⏱️", "🔔", "📢", "📣"] },
  { label: "icon.emoji.communication", items: ["📧", "💬", "📱", "💻", "🌐", "📡", "🔔", "📌", "📮", "✉️", "💌", "📨", "📤", "📥", "📫", "📪"] },
  { label: "icon.emoji.business", items: ["🏢", "🏬", "🏦", "🏪", "🏭", "🏛️", "🏠", "🏗️", "🏘️", "🏨", "🏫", "🏬", "🏭"] },
  { label: "icon.emoji.people", items: ["🎯", "👥", "👤", "👨‍💼", "👩‍💼", "👨‍💻", "👩‍💻", "👨‍🎨", "👩‍🎨", "👨‍🔬", "👩‍🔬", "👨‍🏫", "👩‍🏫", "👨‍⚕️", "👩‍⚕️", "👨‍🚀"] },
  { label: "icon.emoji.nature", items: ["🌟", "⭐", "☀️", "🌤️", "⛅", "🌥️", "☁️", "🌦️", "🌧️", "⛈️", "🌩️", "🌪️", "🌫️", "🌬️", "🌀", "🌈"] },
  { label: "icon.emoji.gesture", items: ["👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "🤙", "👋", "🖐️", "✋", "🖖", "👏", "🙌", "👐", "🤲"] },
];

interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
  /** 默认值（用于"重置"按钮）— 不传则用 "folder" */
  defaultValue?: string;
}

const RECENT_KEY = "iconpicker_recent_v1";
const RECENT_MAX = 12;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

function saveRecent(icon: string) {
  try {
    const list = loadRecent().filter((x) => x !== icon);
    list.unshift(icon);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch { /* swallow */ }
}

export function IconPicker({ value, onChange, defaultValue = "folder" }: IconPickerProps) {
  const [mainTab, setMainTab] = useState(1);
  const [materialTab, setMaterialTab] = useState(0);
  const [emojiTab, setEmojiTab] = useState(0);
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<string[]>(() => loadRecent());

  const [groups, setGroups] = useState<IconGroup[]>([]);
  const [icons, setIcons] = useState<SystemIcon[]>([]);
  const [iconFileUrls, setIconFileUrls] = useState<Record<string, string>>({});
  const [iconsLoading, setIconsLoading] = useState(false);

  // 包装 onChange：写入"最近使用"
  const handleSelect = (icon: string) => {
    saveRecent(icon);
    setRecent(loadRecent());
    onChange(icon);
  };

  useEffect(() => {
    // 只要组件挂载就预加载图标文件 URL（用于"最近使用"中的 custom 图标和当前预览）
    if (Object.keys(iconFileUrls).length === 0 && !iconsLoading) {
      iconsApi.getIconFileUrls().then(setIconFileUrls).catch(() => {});
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mainTab === 2 && groups.length === 0 && !iconsLoading) {
      setIconsLoading(true);
      Promise.all([iconsApi.getAllGroups(), iconsApi.getAllIcons(), iconsApi.getIconFileUrls()])
        .then(([g, i, u]) => {
          setGroups(g);
          setIcons(i);
          setIconFileUrls(u);
        })
        .catch(() => {})
        .finally(() => setIconsLoading(false));
    }
  }, [mainTab, groups.length, iconsLoading]);

  // 搜索过滤：跨 Material/Emoji 模糊匹配
  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.trim().toLowerCase();
    const materialMatches: Array<{ key: string; label: string; Icon: React.ComponentType<any> }> = [];
    for (const cat of ICON_CATEGORIES) {
      for (const item of cat.items) {
        if (resolveFragments(item.label).toLowerCase().includes(q) || item.key.toLowerCase().includes(q)) {
          materialMatches.push(item);
        }
      }
    }
    const emojiMatches: Array<{ emoji: string; label: string }> = [];
    for (const cat of EMOJI_CATEGORIES) {
      if (resolveFragments(cat.label).toLowerCase().includes(q)) {
        cat.items.forEach((e) => emojiMatches.push({ emoji: e, label: resolveFragments(cat.label) }));
      } else {
        cat.items.filter((e) => e.includes(q)).forEach((e) => emojiMatches.push({ emoji: e, label: resolveFragments(cat.label) }));
      }
    }
    return { material: materialMatches, emoji: emojiMatches };
  }, [search]);

  const getDisplayName = () => {
    if (/^\p{Emoji}/u.test(value) && value.length <= 2) {
      return value;
    }
    if (value.startsWith("custom-")) {
      const icon = icons.find((i) => i.id === value.replace("custom-", ""));
      return icon?.name || t("icon.customIcon");
    }
    // Strip "material:" prefix for lookup
    const searchKey = value.startsWith("material:") ? value.slice(9) : value;
    const found = ICON_CATEGORIES.flatMap((c) => c.items).find((i) => i.key === searchKey);
    return resolveFragments(found?.label || searchKey);
  };

  const renderPreview = () => {
    if (/^\p{Emoji}/u.test(value) && value.length <= 2) {
      return <Typography sx={{ fontSize: 18 }}>{value}</Typography>;
    }
    if (value.startsWith("custom-")) {
      const iconId = value.replace("custom-", "");
      const url = iconFileUrls[iconId];
      return url ? (
        <img src={url} alt="" style={{ maxWidth: 18, maxHeight: 18 }} />
      ) : (
        <FolderIcon sx={{ fontSize: 18 }} />
      );
    }
    return resolveIcon(value, "folder", 18);
  };

  // 选中匹配函数：兼容裸值和 material: 前缀
  const isSelected = (key: string) => {
    return value === key || value === `${ICON_SOURCE_PREFIX.material}${key}`;
  };

  return (
    <Box>
      <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary", mb: 0.5, display: "block" }}>
        图标
      </Typography>
      {/* 当前选中预览 + 重置 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          p: 0.75,
          borderRadius: 1,
          border: "1px solid",
          borderColor: "divider",
          mb: 1,
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "action.hover",
            borderRadius: 0.5,
            color: "text.secondary",
            flexShrink: 0,
          }}
        >
          {renderPreview()}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 600, display: "block", lineHeight: 1.2 }}>
            {getDisplayName()}
          </Typography>
          <Typography variant="caption" sx={{ fontSize: 9, color: "text.disabled", display: "block", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {value || t("icon.notSet")}
          </Typography>
        </Box>
        {value !== defaultValue && (
          <Tooltip title={t("icon.restoreDefault")}>
            <IconButton size="small" onClick={() => onChange(defaultValue)} sx={{ p: 0.5 }}>
              <RestartAltIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* 搜索框 */}
      <TextField
        size="small"
        fullWidth
        placeholder={t("icon.searchPlaceholder")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ mb: 1, "& .MuiInputBase-input": { fontSize: 11, py: 0.5 } }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 14, color: "text.disabled" }} />
              </InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setSearch("")} sx={{ p: 0.25 }}>
                  <CloseIcon sx={{ fontSize: 12 }} />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          },
        }}
      />

      {/* 搜索结果 */}
      {searchResults && (
        <Box sx={{ mb: 1 }}>
          <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary", mb: 0.5, display: "block" }}>
            搜索结果（{searchResults.material.length + searchResults.emoji.length}）
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(8, 1fr)",
              gap: 0.5,
              maxHeight: 180,
              overflow: "auto",
            }}
          >
            {searchResults.material.map((item) => (
              <Paper
                key={`m-${item.key}`}
                onClick={() => handleSelect(`${ICON_SOURCE_PREFIX.material}${item.key}`)}
                sx={{
                  p: 0.5,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 0.25,
                  borderRadius: 0.75,
                  cursor: "pointer",
                  border: "2px solid",
                  borderColor: isSelected(item.key) ? "primary.main" : "divider",
                  bgcolor: isSelected(item.key) ? "primary.main" : "transparent",
                  color: isSelected(item.key) ? "primary.contrastText" : "text.secondary",
                  transition: "all 0.1s",
                  "&:hover": { transform: "scale(1.08)", borderColor: "primary.main" },
                }}
              >
                <item.Icon sx={{ fontSize: 18 }} />
                <Typography variant="caption" sx={{ fontSize: 7, lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                  {resolveFragments(item.label)}
                </Typography>
              </Paper>
            ))}
            {searchResults.emoji.map((e, idx) => (
              <Paper
                key={`e-${idx}-${e.emoji}`}
                onClick={() => handleSelect(e.emoji)}
                sx={{
                  p: 0.5,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 0.75,
                  cursor: "pointer",
                  border: "2px solid",
                  borderColor: value === e.emoji ? "primary.main" : "divider",
                  bgcolor: value === e.emoji ? "action.selected" : "transparent",
                  transition: "all 0.1s",
                  "&:hover": { transform: "scale(1.1)", borderColor: "primary.main" },
                }}
              >
                <Typography sx={{ fontSize: "1.1rem" }}>{e.emoji}</Typography>
              </Paper>
            ))}
            {searchResults.material.length === 0 && searchResults.emoji.length === 0 && (
              <Typography variant="caption" sx={{ fontSize: 10, color: "text.disabled", gridColumn: "span 8", textAlign: "center", py: 1 }}>
                未找到匹配图标
              </Typography>
            )}
          </Box>
        </Box>
      )}

      {/* 最近使用 */}
      {!searchResults && recent.length > 0 && (
        <Box sx={{ mb: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
            <HistoryIcon sx={{ fontSize: 11, color: "text.secondary" }} />
            <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary" }}>
              最近使用
            </Typography>
          </Box>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(8, 1fr)",
              gap: 0.5,
            }}
          >
            {recent.map((iconStr, idx) => {
              const isEmoji = /^\p{Emoji}/u.test(iconStr) && iconStr.length <= 2;
              const isCustom = iconStr.startsWith("custom-");
              const sel = value === iconStr || (iconStr.startsWith("material:") && isSelected(iconStr.slice(9)));
              const customUrl = isCustom ? iconFileUrls[iconStr.slice(7)] : null;
              return (
                <Paper
                  key={`r-${idx}`}
                  onClick={() => handleSelect(iconStr)}
                  sx={{
                    p: 0.5,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 0.75,
                    cursor: "pointer",
                    border: "2px solid",
                    borderColor: sel ? "primary.main" : "divider",
                    bgcolor: sel ? "action.selected" : "transparent",
                    transition: "all 0.1s",
                    "&:hover": { transform: "scale(1.1)", borderColor: "primary.main" },
                  }}
                >
                  {isEmoji ? (
                    <Typography sx={{ fontSize: "1rem" }}>{iconStr}</Typography>
                  ) : isCustom && customUrl ? (
                    <img src={customUrl} alt="" style={{ maxWidth: 16, maxHeight: 16, objectFit: "contain" }} />
                  ) : (
                    resolveIcon(iconStr, "folder", 16)
                  )}
                </Paper>
              );
            })}
          </Box>
        </Box>
      )}

      {!searchResults && (
      <Tabs
        value={mainTab}
        onChange={(_, v) => setMainTab(v)}
        variant="fullWidth"
        sx={{
          minHeight: 28,
          mb: 0.5,
          "& .MuiTab-root": { minHeight: 28, py: 0, fontSize: 10, minWidth: "auto", px: 1 },
        }}
      >
        <Tab label="😀 Emoji" />
        <Tab label="🎨 Material" />
        <Tab label={t("icon.tabCustom")} />
      </Tabs>
      )}

      {!searchResults && mainTab === 0 && (
        <>
          <Tabs
            value={emojiTab}
            onChange={(_, v) => setEmojiTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ minHeight: 24, mb: 0.5, "& .MuiTab-root": { minHeight: 24, py: 0, fontSize: 9, minWidth: "auto", px: 0.8 } }}
          >
            {EMOJI_CATEGORIES.map((cat, idx) => (
              <Tab key={idx} label={resolveFragments(cat.label)} />
            ))}
          </Tabs>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(8, 1fr)",
              gap: 0.5,
              maxHeight: 150,
              overflow: "auto",
              "&::-webkit-scrollbar": { width: 3 },
              "&::-webkit-scrollbar-thumb": { borderRadius: 2 },
            }}
          >
            {EMOJI_CATEGORIES[emojiTab]?.items.map((emoji, idx) => {
              const sel = value === emoji;
              return (
                <Paper
                  key={idx}
                  onClick={() => handleSelect(emoji)}
                  sx={{
                    p: 0.5,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 0.75,
                    cursor: "pointer",
                    border: "2px solid",
                    borderColor: sel ? "primary.main" : "divider",
                    bgcolor: sel ? "action.selected" : "transparent",
                    transition: "all 0.1s",
                    "&:hover": {
                      bgcolor: "action.hover",
                      borderColor: "primary.main",
                      transform: "scale(1.1)",
                    },
                  }}
                >
                  <Typography sx={{ fontSize: "1.1rem" }}>{emoji}</Typography>
                </Paper>
              );
            })}
          </Box>
        </>
      )}

      {!searchResults && mainTab === 1 && (
        <>
          <Tabs
            value={materialTab}
            onChange={(_, v) => setMaterialTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ minHeight: 24, mb: 0.5, "& .MuiTab-root": { minHeight: 24, py: 0, fontSize: 9, minWidth: "auto", px: 0.8 } }}
          >
            {ICON_CATEGORIES.map((cat, idx) => (
              <Tab key={idx} label={resolveFragments(cat.label)} />
            ))}
          </Tabs>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              gap: 0.5,
              maxHeight: 150,
              overflow: "auto",
              "&::-webkit-scrollbar": { width: 3 },
              "&::-webkit-scrollbar-thumb": { borderRadius: 2 },
            }}
          >
            {ICON_CATEGORIES[materialTab]?.items.map((item) => (
              <Paper
                key={item.key}
                onClick={() => handleSelect(`${ICON_SOURCE_PREFIX.material}${item.key}`)}
                sx={{
                  p: 0.5,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 0.25,
                  borderRadius: 0.75,
                  cursor: "pointer",
                  border: "2px solid",
                  borderColor: isSelected(item.key) ? "primary.main" : "divider",
                  bgcolor: isSelected(item.key) ? "primary.main" : "transparent",
                  color: isSelected(item.key) ? "primary.contrastText" : "text.secondary",
                  transition: "all 0.1s",
                  "&:hover": {
                    bgcolor: isSelected(item.key) ? "primary.main" : "action.hover",
                    borderColor: "primary.main",
                    transform: "scale(1.08)",
                  },
                }}
              >
                <Box
                  sx={{
                    width: 24,
                    height: 24,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <item.Icon sx={{ fontSize: 18 }} />
                </Box>
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: 7,
                    textAlign: "center",
                    lineHeight: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "100%",
                  }}
                >
                  {resolveFragments(item.label)}
                </Typography>
              </Paper>
            ))}
          </Box>
        </>
      )}

      {!searchResults && mainTab === 2 && (
        <Box sx={{ maxHeight: 250, overflow: "auto", "&::-webkit-scrollbar": { width: 3 }, "&::-webkit-scrollbar-thumb": { borderRadius: 2 } }}>
          {iconsLoading ? (
            <Typography variant="caption" color="text.secondary" sx={{ p: 2, textAlign: "center", display: "block" }}>
              加载中...
            </Typography>
          ) : (
            <CustomIconTabs
              groups={groups}
              icons={icons}
              iconFileUrls={iconFileUrls}
              onSelectIcon={(iconId) => handleSelect(`custom-${iconId}`)}
            />
          )}
        </Box>
      )}
    </Box>
  );
}
