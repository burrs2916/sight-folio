import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Badge from '@mui/material/Badge';
import InputBase from '@mui/material/InputBase';
import Popper from '@mui/material/Popper';
import Paper from '@mui/material/Paper';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import SearchIcon from '@mui/icons-material/Search';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import DataObjectIcon from '@mui/icons-material/DataObject';
import AutoStoriesRoundedIcon from '@mui/icons-material/AutoStoriesRounded';
import ClearIcon from '@mui/icons-material/Clear';
import { useLayoutStore } from '../../store/layoutStore';
import { useSceneStore } from '../../store/sceneStore';
import { useProjectStore } from '../../store/projectStore';
import { useToastStore } from '../../store/toastStore';
import { useEditorStore } from '../../store/editorStore';
import { useWritingStore } from '../../store/writingStore';
import { t } from '../../i18n';
import { aiButtonSx } from '../../ai/aiBrand';
import LanguageToggle from '../i18n/LanguageToggle';
import { openWritingDesk } from '../../utils/writingDeskWindow';

interface AppNavbarProps {
  onSettingsClick?: () => void;
}

// 搜索项类型
interface AnalysisSearchResult {
  type: 'analysis';
  id: string;
  label: string;
  sublabel: string;
}
interface FileSearchResult {
  type: 'file';
  id: string;
  label: string;
  sublabel: string;
  language?: string | null;
}
type SearchResult = AnalysisSearchResult | FileSearchResult;

export default function AppNavbar({ onSettingsClick }: AppNavbarProps) {
  const config = useLayoutStore((s) => s.config);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const collapsed = config.sidebarCollapsed;

  // ─── 全局搜索 ───
  const navigate = useNavigate();
  const location = useLocation();
  const requestAiPanel = useEditorStore((s) => s.requestAiPanel);
  // 全局 AI 助手入口：编辑器内直接切到右侧 AI 面板（tab5），其他页跳 AI 全页
  const handleAiClick = () => {
    navigate('/ai');
  };

  // 写作台全局入口：拉起独立写作台窗口，打开当前主窗口选定的作品；
  // 未选定作品时入口禁用（避免打开无绑定作品的空窗口）
  const activeBookId = useWritingStore((s) => s.activeBookId);
  const handleOpenDesk = useCallback(() => {
    const bookId = useWritingStore.getState().activeBookId;
    if (!bookId) return;
    void openWritingDesk({ bookId });
  }, []);
  const [searchText, setSearchText] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scenes = useSceneStore((s) => s.scenes);
  const files = useProjectStore((s) => s.files);
  const activeAnalysisId = useProjectStore((s) => s.activeAnalysisId);
  const setActiveScene = useSceneStore((s) => s.setActiveScene);
  const showToast = useToastStore((s) => s.showToast);

  // 搜索过滤：分析名 + 文件名 + 符号索引
  const searchResults = useMemo<SearchResult[]>(() => {
    if (!searchText.trim()) return [];
    const q = searchText.toLowerCase().trim();
    const results: SearchResult[] = [];

    // 搜索分析名称
    scenes.forEach((s) => {
      if (s.name.toLowerCase().includes(q)) {
        results.push({ type: 'analysis', id: s.id, label: s.name, sublabel: t('nav.analysis') });
      }
    });

    // 搜索文件路径/名称
    files.forEach((f) => {
      if (f.name.toLowerCase().includes(q) || f.relPath.toLowerCase().includes(q)) {
        results.push({ type: 'file', id: f.id, label: f.name, sublabel: f.relPath, language: f.language });
      }
    });

    return results.slice(0, 30); // 最多 30 条
  }, [searchText, scenes, files]);

  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      setSearchText('');
      setSearchOpen(false);
      if (result.type === 'analysis') {
        setActiveScene(result.id);
        navigate('/analyzer');
      } else {
        // 文件结果不适合导航，尝试在编辑器中选中
        inputRef.current?.blur();
      }
    },
    [setActiveScene, navigate, showToast],
  );

  // 点击外部关闭搜索
  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (!searchRef.current?.contains(e.relatedTarget as Node)) {
      setSearchOpen(false);
    }
  }, []);

  return (
    <AppBar
      position="sticky"
      sx={{
        flexShrink: 0,
        backgroundColor: 'background.paper',
        color: 'text.primary',
        boxShadow: 'none',
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Toolbar variant="dense" sx={{ gap: 0.5 }}>
        {/* 侧边栏展开/折叠按钮 */}
        <IconButton
          size="small"
          onClick={toggleSidebar}
          sx={{ color: 'text.secondary' }}
          aria-label={t('nav.toggleSidebar')}
        >
          {collapsed ? <MenuIcon sx={{ fontSize: 20 }} /> : <MenuOpenIcon sx={{ fontSize: 20 }} />}
        </IconButton>

        {/* 项目名 */}
        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary', mr: 1 }}>
          Sight Folio
        </Typography>

        {/* 全局搜索栏 */}
        <Box
          ref={searchRef}
          onBlur={handleBlur}
          sx={{
            display: { xs: 'none', sm: 'flex' },
            alignItems: 'center',
            backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
            borderRadius: 1,
            px: 1,
            ml: 1,
            minWidth: 180,
            maxWidth: 320,
            flex: 1,
            transition: 'background-color 0.15s',
            '&:hover': {
              backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'),
            },
            position: 'relative',
          }}
        >
          <SearchIcon sx={{ fontSize: 16, color: 'text.disabled', mr: 0.5 }} />
          <InputBase
            inputRef={inputRef}
            placeholder={t('search.placeholder')}
            size="small"
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchOpen(false);
                setSearchText('');
                inputRef.current?.blur();
              }
            }}
            sx={{
              fontSize: 12,
              width: '100%',
              '& .MuiInputBase-input': { py: 0.5 },
            }}
          />
          {searchText && (
            <IconButton
              size="small"
              onClick={() => {
                setSearchText('');
                setSearchOpen(false);
              }}
              sx={{ p: 0.25 }}
              aria-label={t('nav.clearSearch')}
            >
              <ClearIcon sx={{ fontSize: 14 }} />
            </IconButton>
          )}

          {/* 搜索结果下拉 */}
          <Popper
            open={searchOpen && searchResults.length > 0}
            anchorEl={searchRef.current}
            placement="bottom-start"
            sx={{ zIndex: 1300, width: searchRef.current?.offsetWidth ?? 320, maxWidth: 400 }}
          >
            <Paper
              elevation={8}
              sx={{
                mt: 0.5,
                maxHeight: 300,
                overflow: 'auto',
                borderRadius: 1.5,
              }}
            >
              <List dense disablePadding>
                {searchResults.map((r) => (
                  <ListItemButton
                    key={`${r.type}-${r.id}`}
                    onClick={() => handleSearchSelect(r)}
                    sx={{ gap: 1, px: 1.5, py: 0.75 }}
                  >
                    <ListItemIcon sx={{ minWidth: 0 }}>
                      {r.type === 'analysis' ? (
                        <DescriptionRoundedIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                      ) : (
                        <InsertDriveFileIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 500 }}>
                          {r.label}
                        </Typography>
                      }
                      secondary={
                        <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled' }}>
                          {r.sublabel}
                        </Typography>
                      }
                    />
                    {r.type === 'analysis' && (
                      <Typography variant="caption" sx={{ fontSize: 9, color: 'primary.main', flexShrink: 0 }}>
                        {t('search.open')}
                      </Typography>
                    )}
                  </ListItemButton>
                ))}
              </List>
            </Paper>
          </Popper>
        </Box>

        <Box sx={{ flexGrow: 1 }} />

        {/* 版本号 */}
        <Typography variant="caption" color="text.disabled" sx={{ mr: 0.5 }}>
          v0.1.0
        </Typography>

        {/* 通知铃铛 */}
        <Tooltip title={t('ui.notifications')}>
          <IconButton size="small" sx={{ color: 'text.secondary' }} aria-label={t('ui.notifications')}>
            <Badge badgeContent={0} color="error" variant="dot">
              <NotificationsNoneOutlinedIcon sx={{ fontSize: 18 }} />
            </Badge>
          </IconButton>
        </Tooltip>

        {/* 语言切换（右上角中/英） */}
        <LanguageToggle />

        {/* 写作台入口（全局常驻，主行动：拉起独立写作台窗口，打开当前活跃书） */}
        <Tooltip title={activeBookId ? t('writing.openInWritingDesk') : t('writing.deskNeedBook')}>
          <span>
            <Button
              size="small"
              disabled={!activeBookId}
              onClick={handleOpenDesk}
              startIcon={<AutoStoriesRoundedIcon sx={{ fontSize: 16 }} />}
              sx={{
                px: 1.2,
                py: 0.4,
                borderRadius: 5,
                fontSize: 12,
                ml: 0.5,
                color: 'primary.contrastText',
                backgroundColor: 'primary.main',
                whiteSpace: 'nowrap',
                '&:hover': { backgroundColor: 'primary.dark' },
                '&.Mui-disabled': {
                  color: 'rgba(255,255,255,0.72)',
                  backgroundColor: 'rgba(74,51,143,0.45)',
                },
              }}
            >
              {t('writing.launchDesk')}
            </Button>
          </span>
        </Tooltip>

        {/* AI 助手入口（全局常驻，靛紫渐变，统一 AI 视觉） */}
        <Tooltip title={t('aiPanel.openAssistant')}>
          <Button
            size="small"
            onClick={handleAiClick}
            startIcon={<SmartToyIcon sx={{ fontSize: 16 }} />}
            sx={{ ...aiButtonSx, px: 1.2, py: 0.4, borderRadius: 5, fontSize: 12, ml: 0.5 }}
          >
            {t('aiPanel.assistantBtn')}
          </Button>
        </Tooltip>

        {/* 设置按钮 */}
        <Tooltip title={t('ui.settings')}>
          <IconButton
            size="small"
            onClick={onSettingsClick}
            sx={{ color: 'text.secondary' }}
            aria-label={t('ui.settings')}
          >
            <SettingsRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Toolbar>
    </AppBar>
  );
}
