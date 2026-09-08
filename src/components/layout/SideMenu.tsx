import { styled } from "@mui/material/styles";
import MuiDrawer, { drawerClasses } from "@mui/material/Drawer";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import MenuContent from "./MenuContent";
import { useLayoutStore } from "../../store/layoutStore";
import { t } from "../../i18n";
import sightFolioLogo from "../../../assets/logo/sight-folio-logo.svg";

const DRAWER_WIDTH = 240;
const COLLAPSED_WIDTH = 64;

interface DrawerProps {
  collapsed: boolean;
}

const Drawer = styled(MuiDrawer, {
  shouldForwardProp: (prop) => prop !== "collapsed",
})<DrawerProps>(({ collapsed }) => ({
  width: collapsed ? COLLAPSED_WIDTH : DRAWER_WIDTH,
  flexShrink: 0,
  boxSizing: "border-box",
  whiteSpace: "nowrap",
  transition: "width 0.2s ease",
  [`& .${drawerClasses.paper}`]: {
    width: collapsed ? COLLAPSED_WIDTH : DRAWER_WIDTH,
    boxSizing: "border-box",
    position: "relative",
    overflowX: "hidden",
    transition: "width 0.2s ease",
    backgroundColor: "background.paper",
  },
}));

export default function SideMenu() {
  const config = useLayoutStore((s) => s.config);
  const collapsed = config.sidebarCollapsed;

  return (
    <Drawer
      variant="permanent"
      collapsed={collapsed}
      sx={{
        display: { xs: "none", md: "block" },
      }}
    >
      {/* 头部：Logo + 产品名（中文为主、英文为辅） */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          px: 1.5,
          py: 1.25,
          minHeight: 60,
          justifyContent: collapsed ? "center" : "flex-start",
        }}
      >
        {collapsed ? (
          <Tooltip title={`Sight Folio · ${t("app.tagline")}`} placement="right">
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
                boxShadow: "0 2px 10px rgba(42,86,136,0.3)",
              }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography
                noWrap
                sx={{
                  fontWeight: 800,
                  fontSize: 15.5,
                  lineHeight: 1.1,
                  letterSpacing: 0.2,
                  color: "text.primary",
                }}
              >
                {t("nav.productName")}
              </Typography>
              <Typography
                noWrap
                variant="caption"
                sx={{
                  fontSize: 10.5,
                  fontWeight: 500,
                  lineHeight: 1.35,
                  letterSpacing: 0.4,
                  color: "text.secondary",
                }}
              >
                {t("app.tagline")}
              </Typography>
            </Box>
          </>
        )}
      </Box>
      <Divider />
      <Box
        sx={{
          overflow: "auto",
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <MenuContent />
      </Box>
    </Drawer>
  );
}
