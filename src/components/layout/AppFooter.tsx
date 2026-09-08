import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import BugReportIcon from "@mui/icons-material/BugReport";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import StorageIcon from "@mui/icons-material/Storage";
import { useSceneStore } from "../../store/sceneStore";
import { useProjectStore } from "../../store/projectStore";
import { useDataSourceStore } from "../../store/datasourceStore";
import { t } from "../../i18n";

export default function AppFooter() {
  const scenes = useSceneStore((s) => s.scenes);
  const findings = useProjectStore((s) => s.findings);
  const dataSources = useDataSourceStore((s) => s.dataSources);

  const analysisCount = scenes.length;
  const findingsCount = findings.length;
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const dsConnected = dataSources.filter((ds: any) => ds.status === "connected").length;
  const dsError = dataSources.filter((ds: any) => ds.status === "error").length;

  return (
    <Box
      component="footer"
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        px: 2,
        py: 0.75,
        backgroundColor: "background.paper",
        borderTop: 1,
        borderColor: "divider",
        minHeight: 32,
        flexShrink: 0,
        gap: 1,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <Typography variant="caption" color="text.disabled">
          {t("footer.desc")}
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ opacity: 0.3 }}>
          |
        </Typography>

        {/* 分析数 */}
        <Tooltip title={t("footer.analysisTitle")}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.3 }}>
            <FolderOpenIcon sx={{ fontSize: 11, color: "text.disabled" }} />
            <Typography variant="caption" color="text.disabled">
              {t("footer.analysisCount", { n: analysisCount })}
            </Typography>
          </Box>
        </Tooltip>

        {/* 审查发现 */}
        {findingsCount > 0 && (
          <Tooltip title={t("footer.criticalTitle", { n: criticalCount })}>
            <Chip
              icon={<BugReportIcon sx={{ fontSize: 11 }} />}
              label={t("footer.findingsCount", { n: findingsCount })}
              size="small"
              color={criticalCount > 0 ? "error" : "warning"}
              variant="outlined"
              sx={{ height: 18, fontSize: 9, "& .MuiChip-icon": { ml: 0.3 } }}
            />
          </Tooltip>
        )}
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        {/* 数据源状态 */}
        {dataSources.length > 0 && (
          <Tooltip title={t("footer.connected", { n: dsConnected })}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.3 }}>
              <StorageIcon sx={{ fontSize: 11, color: dsError > 0 ? "error.main" : "success.main" }} />
              <Typography variant="caption" color="text.disabled">
                {t("footer.dataSource")} {dsConnected}/{dataSources.length}
              </Typography>
            </Box>
          </Tooltip>
        )}

        <Typography variant="caption" color="text.disabled" sx={{ opacity: 0.3 }}>
          |
        </Typography>
        <Typography variant="caption" color="text.disabled">
          {t("footer.techStack")}
        </Typography>
      </Box>
    </Box>
  );
}
