import * as React from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import StorageRoundedIcon from "@mui/icons-material/StorageRounded";
import CloudQueueRoundedIcon from "@mui/icons-material/CloudQueueRounded";
import WifiIcon from "@mui/icons-material/Wifi";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ErrorRoundedIcon from "@mui/icons-material/ErrorRounded";
import SyncRoundedIcon from "@mui/icons-material/SyncRounded";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import CodeIcon from "@mui/icons-material/Code";
import { useDataSourceStore } from "../../store/datasourceStore";
import type { DataSourceType, DataSourceStatus } from "../../types/dataSource";
import type { BaseWidgetProps } from "../../types/widget";
import { t } from "../../i18n";

export interface DataSourceStatusCardProps extends BaseWidgetProps {}

const typeConfig: Record<DataSourceType, { icon: React.ReactNode; label: string }> = {
  http: { icon: <CloudQueueRoundedIcon />, label: t("datasource.typeHttp") },
  websocket: { icon: <WifiIcon />, label: t("datasource.typeWebsocket") },
  mqtt: { icon: <WifiIcon />, label: t("datasource.typeMqtt") },
  database: { icon: <StorageRoundedIcon />, label: t("datasource.typeDatabase") },
  "project-dir": { icon: <FolderOpenIcon />, label: t("datasource.typeProjectDir") },
  "git-repo": { icon: <CodeIcon />, label: t("datasource.typeGitRepo") },
};

const statusConfig: Record<DataSourceStatus, { color: "success" | "error" | "warning" | "default"; icon: React.ReactNode; label: string }> = {
  connected: { color: "success", icon: <CheckCircleRoundedIcon fontSize="small" />, label: t("datasource.statusConnected") },
  disconnected: { color: "default", icon: <ErrorRoundedIcon fontSize="small" />, label: t("datasource.statusDisconnected") },
  failed: { color: "error", icon: <ErrorRoundedIcon fontSize="small" />, label: t("datasource.statusFailed") },
  error: { color: "error", icon: <ErrorRoundedIcon fontSize="small" />, label: t("datasource.statusError") },
  connecting: { color: "warning", icon: <SyncRoundedIcon fontSize="small" sx={{ animation: "spin 1s linear infinite" }} />, label: t("datasource.statusConnecting") },
};

export default function DataSourceStatusCard({
  visible = true,
  style,
  className,
}: DataSourceStatusCardProps) {
  const { dataSources, addDataSource, testConnection } = useDataSourceStore();

  if (!visible) return null;

  const activeCount = dataSources.filter((d) => d.status === "connected").length;
  const errorCount = dataSources.filter((d) => d.status === "error" || d.status === "failed").length;

  return (
    <Card variant="outlined" sx={{ height: "100%" }} style={style} className={className}>
      <CardContent>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
          <Typography component="h2" variant="subtitle2">
            {t("datasource.statusTitle")}
          </Typography>
          <Tooltip title={t("datasource.testAll")}>
            <IconButton size="small" onClick={() => dataSources.forEach((ds) => { if (ds.connection.url) testConnection(ds.id); })}>
              <RefreshRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary">{t("datasource.connected")}</Typography>
            <Typography variant="h5" color="success.main">{activeCount}/{dataSources.length}</Typography>
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary">{t("datasource.error")}</Typography>
            <Typography variant="h5" color="error.main">{errorCount}</Typography>
          </Box>
        </Box>

        {dataSources.length === 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", py: 2 }}>
            {t("datasource.none")}
          </Typography>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {dataSources.map((ds) => (
              <Box
                key={ds.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  p: 1,
                  borderRadius: 1,
                  backgroundColor: (theme) =>
                    theme.vars
                      ? `rgba(${theme.vars.palette.background.defaultChannel} / 0.5)`
                      : "action.hover",
                  opacity: ds.enabled ? 1 : 0.5,
                }}
              >
                <Box sx={{ color: `${statusConfig[ds.status].color}.main`, display: "flex", alignItems: "center" }}>
                  {typeConfig[ds.type].icon}
                </Box>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                      {ds.name || t("datasource.unnamed")}
                    </Typography>
                    <Chip
                      size="small"
                      label={statusConfig[ds.status].label}
                      color={statusConfig[ds.status].color}
                      sx={{ height: 20, fontSize: "0.65rem" }}
                    />
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      {typeConfig[ds.type].label}
                    </Typography>
                    {ds.lastFetchedAt && (
                      <Typography variant="caption" color="text.secondary">
                        {new Date(ds.lastFetchedAt).toLocaleTimeString()}
                      </Typography>
                    )}
                  </Box>
                  {ds.lastError && (
                    <Typography variant="caption" color="error" noWrap sx={{ display: "block" }}>
                      {ds.lastError}
                    </Typography>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        )}

        <Box sx={{ display: "flex", gap: 1, mt: 2 }}>
          <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} fullWidth onClick={() => addDataSource({ name: t("datasource.newName", { n: dataSources.length + 1 }) })}>
            {t("datasource.addDataSource")}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
