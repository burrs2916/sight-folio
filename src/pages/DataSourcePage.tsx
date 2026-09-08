import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardActions from "@mui/material/CardActions";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import DeleteIcon from "@mui/icons-material/Delete";
import StorageIcon from "@mui/icons-material/Storage";
import CloudIcon from "@mui/icons-material/Cloud";
import WifiIcon from "@mui/icons-material/Wifi";
import SyncIcon from "@mui/icons-material/Sync";
import DatabaseIcon from "@mui/icons-material/Storage";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import CodeIcon from "@mui/icons-material/Code";
import { useDataSourceStore } from "../store/datasourceStore";
import type { DataSourceType, DataSourceStatus } from "../types/dataSource";
import { t } from "../i18n";

const typeIcons: Record<DataSourceType, React.ReactNode> = {
  http: <CloudIcon />,
  websocket: <WifiIcon />,
  mqtt: <WifiIcon />,
  database: <DatabaseIcon />,
  "project-dir": <FolderOpenIcon />,
  "git-repo": <CodeIcon />,
};

const typeLabels: Record<DataSourceType, string> = {
  http: t("datasource.typeHttpRest"),
  websocket: t("datasource.typeWebsocketFull"),
  mqtt: t("datasource.typeMqttFull"),
  database: t("datasource.typeDatabase"),
  "project-dir": t("datasource.typeProjectDir"),
  "git-repo": t("datasource.typeGitRepo"),
};

const statusColors: Record<DataSourceStatus, "success" | "default" | "error" | "warning"> = {
  connected: "success",
  disconnected: "default",
  failed: "error",
  error: "error",
  connecting: "warning",
};

const statusLabels: Record<DataSourceStatus, string> = {
  connected: t("datasource.statusConnected"),
  disconnected: t("datasource.statusDisconnected"),
  failed: t("datasource.statusFailed"),
  error: t("datasource.statusError"),
  connecting: t("datasource.statusConnecting"),
};

function descKey(type: DataSourceType): string {
  const k = type === "project-dir" ? "projectDir" : type === "git-repo" ? "gitRepo" : type;
  return `datasource.typeDesc.${k}`;
}

export default function DataSourcePage() {
  const {
    dataSources,
    addDataSource,
    deleteDataSource,
    setDataSourceEnabled,
    testConnection,
  } = useDataSourceStore();

  const activeCount = dataSources.filter((d) => d.status === "connected").length;
  const errorCount = dataSources.filter((d) => d.status === "error" || d.status === "failed").length;

  const handleAddDataSource = async (type: DataSourceType) => {
    await addDataSource({
      name: `${typeLabels[type]} ${dataSources.filter((d) => d.type === type).length + 1}`,
      type,
    });
  };

  const newTypes: DataSourceType[] = ["http", "websocket", "mqtt", "database", "project-dir", "git-repo"];

  return (
    <Box sx={{ width: "100%" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography component="h1" variant="h4" sx={{ fontWeight: 600 }}>
          {t("datasource.pageTitle")}
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          {newTypes.map((tp) => (
            <Button
              key={tp}
              variant={tp === "project-dir" || tp === "git-repo" ? "outlined" : "text"}
              size="small"
              startIcon={typeIcons[tp]}
              onClick={() => handleAddDataSource(tp)}
              sx={{ fontSize: 12 }}
            >
              {typeLabels[tp]}
            </Button>
          ))}
        </Box>
      </Box>

      <Box sx={{ display: "flex", gap: 2, mb: 3 }}>
        <Paper sx={{ p: 2, flex: 1, textAlign: "center" }}>
          <Typography variant="caption" color="text.secondary">{t("datasource.total")}</Typography>
          <Typography variant="h4">{dataSources.length}</Typography>
        </Paper>
        <Paper sx={{ p: 2, flex: 1, textAlign: "center" }}>
          <Typography variant="caption" color="text.secondary">{t("datasource.connectedCount")}</Typography>
          <Typography variant="h4" color="success.main">{activeCount}</Typography>
        </Paper>
        <Paper sx={{ p: 2, flex: 1, textAlign: "center" }}>
          <Typography variant="caption" color="text.secondary">{t("datasource.errorCount")}</Typography>
          <Typography variant="h4" color="error.main">{errorCount}</Typography>
        </Paper>
      </Box>

      {dataSources.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <StorageIcon sx={{ fontSize: 48, color: "text.secondary", mb: 1 }} />
          <Typography variant="h6" color="text.secondary">{t("datasource.emptyTitle")}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("datasource.emptyHint")}
          </Typography>
          <Button variant="outlined" onClick={() => handleAddDataSource("http")}>
            {t("datasource.addButton")}
          </Button>
        </Paper>
      ) : (
        <Grid container spacing={3}>
          {dataSources.map((ds) => (
            <Grid key={ds.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
              <Card sx={{ height: "100%", opacity: ds.enabled ? 1 : 0.6 }}>
                <CardContent>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 2 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <StorageIcon color="primary" />
                      <Typography variant="h6" noWrap>{ds.name || t("datasource.unnamed")}</Typography>
                    </Box>
                    <Chip label={statusLabels[ds.status]} color={statusColors[ds.status]} size="small" />
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                    {typeIcons[ds.type]}
                    <Typography variant="body2" color="text.secondary">
                      {typeLabels[ds.type]}
                    </Typography>
                  </Box>
                  {ds.description && (
                    <Typography variant="body2" color="text.secondary">
                      {ds.description}
                    </Typography>
                  )}
                  {ds.connection.url && (
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", mt: 1 }}>
                      {ds.connection.url}
                    </Typography>
                  )}
                  {ds.lastError && (
                    <Typography variant="caption" color="error" sx={{ display: "block", mt: 1 }}>
                      {ds.lastError}
                    </Typography>
                  )}
                  {ds.lastFetchedAt && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                      {t("datasource.lastFetched")}: {new Date(ds.lastFetchedAt).toLocaleString()}
                    </Typography>
                  )}
                  {ds.testApis.length > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                      {t("datasource.testApis", { n: ds.testApis.length })}
                    </Typography>
                  )}
                </CardContent>
                <CardActions sx={{ justifyContent: "space-between" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Switch
                      size="small"
                      checked={ds.enabled}
                      onChange={(e) => setDataSourceEnabled(ds.id, e.target.checked)}
                    />
                    <Typography variant="caption">{ds.enabled ? t("ui.enabled") : t("ui.disabled")}</Typography>
                  </Box>
                  <Box sx={{ display: "flex", gap: 0.5 }}>
                    <Tooltip title={t("datasource.testConnection")}>
                      <IconButton size="small" onClick={() => testConnection(ds.id)} disabled={!ds.connection.url}>
                        <SyncIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t("nav.delete")}>
                      <IconButton size="small" onClick={() => deleteDataSource(ds.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <Paper sx={{ p: 3, mt: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {t("datasource.typeDescTitle")}
        </Typography>
        <Grid container spacing={2}>
          {newTypes.map((tp) => {
            const icon = tp === "database" ? <DatabaseIcon color="primary" />
              : tp === "project-dir" ? <FolderOpenIcon color="primary" />
              : tp === "git-repo" ? <CodeIcon color="primary" />
              : tp === "http" ? <CloudIcon color="primary" />
              : <WifiIcon color="primary" />;
            return (
              <Grid key={tp} size={{ xs: 12, sm: 6, md: 3 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  {icon}
                  <Box>
                    <Typography variant="subtitle2">{typeLabels[tp]}</Typography>
                    <Typography variant="body2" color="text.secondary">{t(descKey(tp))}</Typography>
                  </Box>
                </Box>
              </Grid>
            );
          })}
        </Grid>
      </Paper>
    </Box>
  );
}
