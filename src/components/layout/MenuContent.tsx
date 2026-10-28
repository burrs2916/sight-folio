import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import LayersRoundedIcon from '@mui/icons-material/LayersRounded';
import BookIcon from '@mui/icons-material/Book';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import LocalLibraryRoundedIcon from '@mui/icons-material/LocalLibraryRounded';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLayoutStore } from '../../store/layoutStore';
import { t } from '../../i18n';

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
      // 创作主线：书架 / 语料库 / AI 助手 / 完结作品 是日常创作闭环的入口
      id: 'writing',
      label: t('nav.writing'),
      items: [
        { text: t('nav.dashboard'), icon: <DashboardRoundedIcon sx={{ fontSize: 19 }} />, path: '/' },
        { text: t('nav.library'), icon: <LocalLibraryRoundedIcon sx={{ fontSize: 19 }} />, path: '/library' },
        { text: t('nav.ai'), icon: <SmartToyIcon sx={{ fontSize: 19 }} />, path: '/ai' },
        { text: t('nav.published'), icon: <BookIcon sx={{ fontSize: 19 }} />, path: '/published' },
      ],
    },
      ];
}

/** 选中态导航项样式（主色指示条 + 主色 10% 底） */
const navButtonSx = (selected: boolean, collapsed: boolean) => ({
  borderRadius: 1.5,
  mx: 1,
  minHeight: 40,
  position: 'relative' as const,
  justifyContent: collapsed ? 'center' : 'flex-start',
  px: collapsed ? 1 : 1.5,
  transition: 'background-color 0.15s',
  '&.Mui-selected': {
    backgroundColor: (t: any) => (t.palette.mode === 'dark' ? 'rgba(99,102,241,0.16)' : 'rgba(99,102,241,0.1)'),
    '&:hover': {
      backgroundColor: (t: any) => (t.palette.mode === 'dark' ? 'rgba(99,102,241,0.24)' : 'rgba(99,102,241,0.16)'),
    },
  },
  '& .nav-indicator': {
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
        position: 'absolute',
        left: 2,
        top: '50%',
        transform: 'translateY(-50%)',
        width: 3,
        height: 20,
        borderRadius: 2,
        bgcolor: 'primary.main',
        opacity: 0,
        transition: 'opacity 0.2s',
      }}
    />
  );
}

/**
 * 左侧导航栏：只承担页面导航（总览 / 工作室 / 实体图鉴 / 已导出报告 / AI 助手）。
 * 作品与分析的展示、创建一律在工作室页面本体完成（用户定死的边界，侧栏不做业务对象陈列）。
 * 写作台（G5）不进侧栏：路由 /writing 保留，入口在工作室书场景工具栏（SceneEditorPage）。
 */
export default function MenuContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const collapsed = useLayoutStore((s) => s.config.sidebarCollapsed);

  /** 分组小标题（折叠时不显示） */
  const GroupLabel = ({ children }: { children: React.ReactNode }) =>
    collapsed ? null : (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
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
            textTransform: 'uppercase',
            color: 'text.disabled',
          }}
        >
          {children}
        </Typography>
      </Box>
    );

  return (
    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ overflowY: 'auto', flex: 1, pb: 1 }}>
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
                      color: selected ? 'primary.main' : 'inherit',
                      justifyContent: 'center',
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                  {!collapsed && (
                    <ListItemText
                      primary={
                        <Typography noWrap sx={{ fontSize: '0.84rem', fontWeight: selected ? 600 : 400 }}>
                          {item.text}
                        </Typography>
                      }
                    />
                  )}
                </ListItemButton>
              );
              return (
                <ListItem key={item.path} disablePadding sx={{ display: 'block' }}>
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
      </Box>
    </Box>
  );
}
