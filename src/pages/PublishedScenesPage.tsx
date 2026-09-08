import { useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import CardActions from "@mui/material/CardActions";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import UnpublishedRoundedIcon from "@mui/icons-material/UnpublishedRounded";
import FileDownloadRoundedIcon from "@mui/icons-material/FileDownloadRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import { useSceneStore, collectAiReportInputs } from "../store/sceneStore";
import { useProjectStore } from "../store/projectStore";
import { useToastStore } from "../store/toastStore";
import { generateReportHtml } from "../utils/reportGenerator";
import { openLiveWindow } from "../utils/previewWindow";
import { t, getLang } from "../i18n";
import type { SceneDSL } from "../types/scene";

const SCENE_COVER_GRADIENTS = [
  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
  "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
  "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
  "linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)",
  "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)",
];

function getSceneGradient(sceneId: string): string {
  let hash = 0;
  for (let i = 0; i < sceneId.length; i++) {
    hash = sceneId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return SCENE_COVER_GRADIENTS[Math.abs(hash) % SCENE_COVER_GRADIENTS.length];
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(getLang() === "zh-CN" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default function PublishedScenesPage() {
  const scenes = useSceneStore((s) => s.scenes);
  const loadScenes = useSceneStore((s) => s.loadScenes);
  const unpublishScene = useSceneStore((s) => s.unpublishScene);
  const showToast = useToastStore((s) => s.showToast);

  useEffect(() => {
    loadScenes();
  }, [loadScenes]);

  const publishedScenes = scenes.filter((s) => s.status === "published");

  const handleOpen = useCallback((scene: SceneDSL) => {
    openLiveWindow(scene.id, scene.name);
  }, []);

  const handleUnpublish = useCallback(async (scene: SceneDSL) => {
    await unpublishScene(scene.id);
    showToast(t("published.revoked", { name: scene.name }), "info");
  }, [unpublishScene, showToast]);

  const handleDownloadReport = useCallback(async (scene: SceneDSL) => {
    const projectStore = useProjectStore.getState();
    // 重新下载与首次导出必须给出同一份文档：同样带上 AI 结论与可信度声明，
    // 否则同一份报告在两个入口下载会内容不同，读者根本不知道该信哪一份。
    const aiInputs = await collectAiReportInputs(scene.id);
    const reportData = {
      ...aiInputs,
      analysis: scene as any,
      files: projectStore.files,
      modules: projectStore.modules,
      dependencies: projectStore.dependencies,
      layers: projectStore.layers,
      findings: projectStore.findings,
    };
    const html = generateReportHtml(reportData);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scene.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_")}_${t("published.reportSuffix")}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast(t("published.downloading", { name: scene.name }), "success");
  }, [showToast]);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
        <PublicRoundedIcon sx={{ fontSize: 28, color: "primary.main" }} />
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {t("published.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {t("published.subtitle")}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Chip
          label={t("published.count", { n: publishedScenes.length })}
          color="primary"
          variant="outlined"
          size="small"
        />
      </Box>

      {publishedScenes.length === 0 ? (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            py: 12,
            color: "text.secondary",
          }}
        >
          <UnpublishedRoundedIcon sx={{ fontSize: 64, opacity: 0.2, mb: 2 }} />
          <Typography variant="h6" sx={{ fontWeight: 500, opacity: 0.6 }}>
            {t("published.noneTitle")}
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.4, mt: 0.5 }}>
            {t("published.noneHint")}
          </Typography>
        </Box>
      ) : (
        <Grid container spacing={2.5}>
          {publishedScenes.map((scene) => {
            const cover = scene.thumbnail || getSceneGradient(scene.id);
            const isGradient = cover.startsWith("linear-gradient(");

            return (
              <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={scene.id}>
                <Card
                  variant="outlined"
                  sx={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    transition: "border-color 0.2s, box-shadow 0.2s",
                    "&:hover": {
                      borderColor: "primary.main",
                      boxShadow: 4,
                    },
                  }}
                >
                  <CardActionArea onClick={() => handleOpen(scene)}>
                    <Box
                      sx={{
                        height: 140,
                        background: isGradient ? cover : undefined,
                        backgroundImage: !isGradient ? `url(${cover})` : undefined,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "flex-end",
                        p: 1,
                      }}
                    >
                      <Chip
                        size="small"
                        label={t("published.chip")}
                        color="success"
                        sx={{
                          bgcolor: "rgba(0,0,0,0.5)",
                          color: "#fff",
                          backdropFilter: "blur(4px)",
                          "& .MuiChip-label": { px: 1, fontSize: "0.7rem" },
                        }}
                      />
                    </Box>
                    <CardContent sx={{ pb: 1 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3 }} noWrap>
                        {scene.name}
                      </Typography>
                      {scene.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} noWrap>
                          {scene.description}
                        </Typography>
                      )}
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 1 }}>
                        <Typography variant="caption" color="text.disabled">
                          {t("published.exportedOn", {
                            date: scene.publishedAt ? formatTimestamp(scene.publishedAt) : formatTimestamp(scene.updatedAt),
                          })}
                        </Typography>
                      </Box>
                    </CardContent>
                  </CardActionArea>
                  <CardActions sx={{ pt: 0, px: 1.5, pb: 1.5, justifyContent: "flex-end", gap: 0.25 }}>
                    <Tooltip title={t("published.reDownload")}>
                      <IconButton size="small" onClick={() => handleDownloadReport(scene)} sx={{ color: "primary.main" }}>
                        <ReplayRoundedIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t("published.revoke")}>
                      <IconButton size="small" onClick={() => handleUnpublish(scene)} sx={{ color: "text.secondary" }}>
                        <UnpublishedRoundedIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  </CardActions>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Box>
  );
}
