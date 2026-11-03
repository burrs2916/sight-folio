import { styled } from '@mui/material/styles';
import MuiDrawer, { drawerClasses } from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import MenuContent from './MenuContent';
import { useLayoutStore } from '../../store/layoutStore';
import { SIDEBAR_COLLAPSED_WIDTH } from '../../theme/appearanceScales';
import { t } from '../../i18n';
import sightFolioLogo from '../../../assets/logo/sight-folio-logo.svg';
import { primaryTint } from '../../theme/themeTokens';
import { uiFontSize } from '../../theme/appearanceScales';

const COLLAPSED_WIDTH = SIDEBAR_COLLAPSED_WIDTH;

interface DrawerProps {
  collapsed: boolean;
  expandedWidth: number;
}

/**
 * 侧栏容器。宽度取自 layoutStore.sidebarWidth（「布局预设 / 侧栏宽度」的真实落点）。
 *
 * 病灶（第十八轮修）：此前这里写死 DRAWER_WIDTH = 240，而 store 里的 sidebarWidth 全项目
 * 无人消费 —— 于是「标准」与「宽屏」两套布局渲染结果一模一样，用户看到的现象就是
 * 「布局预设点了没反应」。
 */
const Drawer = styled(MuiDrawer, {
  shouldForwardProp: (prop) => prop !== 'collapsed' && prop !== 'expandedWidth',
})<DrawerProps>(({ collapsed, expandedWidth }) => ({
  width: collapsed ? COLLAPSED_WIDTH : expandedWidth,
  flexShrink: 0,
  boxSizing: 'border-box',
  whiteSpace: 'nowrap',
  transition: 'width 0.2s ease',
  [`& .${drawerClasses.paper}`]: {
    width: collapsed ? COLLAPSED_WIDTH : expandedWidth,
    boxSizing: 'border-box',
    position: 'relative',
    overflowX: 'hidden',
    transition: 'width 0.2s ease',
    backgroundColor: 'background.paper',
  },
}));

export default function SideMenu() {
  const config = useLayoutStore((s) => s.config);
  const collapsed = config.sidebarCollapsed;
  // 侧栏在左还是在右：主区与侧栏都是外层 flex 的直接子项，用 order 换位最稳
  // （permanent Drawer 的 anchor 只管滑入方向，不管在 flex 行里的位置）。
  const onRight = config.sidebarPosition === 'right';

  return (
    <Drawer
      variant="permanent"
      collapsed={collapsed}
      expandedWidth={config.sidebarWidth}
      sx={{
        display: { xs: 'none', md: 'block' },
        order: onRight ? 1 : 0,
      }}
    >
      {/* 头部：Logo + 产品名（中文为主、英文为辅） */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          px: 1.5,
          py: 1.25,
          minHeight: 60,
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        {collapsed ? (
          <Tooltip title={`Sight Folio · ${t('app.tagline')}`} placement={onRight ? 'left' : 'right'}>
            <Box
              component="img"
              src={sightFolioLogo}
              alt="Sight Folio logo"
              sx={{ width: 30, height: 30, borderRadius: 1.5, flexShrink: 0 }}
            />
          </Tooltip>
        ) : (
          <>
            <Box
              component="img"
              src={sightFolioLogo}
              alt="Sight Folio logo"
              sx={{
                width: 34,
                height: 34,
                borderRadius: 1.5,
                flexShrink: 0,
                boxShadow: (t) => `0 2px 10px ${primaryTint(t, 0.3)}`,
              }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography
                noWrap
                sx={{
                  fontWeight: 800,
                  fontSize: uiFontSize(15.5),
                  lineHeight: 1.1,
                  letterSpacing: 0.2,
                  color: 'text.primary',
                }}
              >
                {t('nav.productName')}
              </Typography>
              <Typography
                noWrap
                variant="caption"
                sx={{
                  fontSize: uiFontSize(10.5),
                  fontWeight: 500,
                  lineHeight: 1.35,
                  letterSpacing: 0.4,
                  color: 'text.secondary',
                }}
              >
                {t('app.tagline')}
              </Typography>
            </Box>
          </>
        )}
      </Box>
      <Divider />
      <Box
        sx={{
          overflow: 'auto',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <MenuContent />
      </Box>
    </Drawer>
  );
}
