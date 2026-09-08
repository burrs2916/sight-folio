// project-sight: 实体详情 + 审查结果面板
// 映射 biosphere 属性面板 → 项目实体详情 + 审查结果
import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import DescriptionIcon from "@mui/icons-material/Description";
import FolderIcon from "@mui/icons-material/Folder";
import InventoryIcon from "@mui/icons-material/Inventory2";
import LinkIcon from "@mui/icons-material/Link";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { t } from "../../i18n";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import { useSceneStore } from "../../store/sceneStore";
import { useToastStore } from "../../store/toastStore";
import { runPortrait } from "../utils/portraits";

function entityTypeLabel(type: string): string {
  const key = `panel.entityType.${type}`;
  const v = t(key);
  return v === key ? type : v;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  file: <DescriptionIcon sx={{ fontSize: 20 }} />,
  folder: <FolderIcon sx={{ fontSize: 20 }} />,
  module: <InventoryIcon sx={{ fontSize: 20 }} />,
  "dependency-edge": <LinkIcon sx={{ fontSize: 20 }} />,
};

const SEVERITY_CONFIG: Record<string, { color: "error" | "warning" | "info"; icon: React.ReactNode }> = {
  critical: { color: "error", icon: <WarningAmberIcon sx={{ fontSize: 16 }} /> },
  warning: { color: "warning", icon: <WarningAmberIcon sx={{ fontSize: 16 }} /> },
  info: { color: "info", icon: <InfoOutlinedIcon sx={{ fontSize: 16 }} /> },
};

function formatFileSize(bytes: unknown): string {
  const n = typeof bytes === "number" ? bytes : parseInt(String(bytes), 10);
  if (isNaN(n)) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function strVal(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v == null) return "";
  return String(v);
}

function numVal(v: unknown): number | null {
  if (typeof v === "number") return v;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, flexShrink: 0, mr: 1 }}>
        {label}
      </Typography>
      <Typography
        variant="caption"
        noWrap
        sx={{
          fontSize: 11,
          fontFamily: mono ? "monospace" : undefined,
          maxWidth: 160,
          overflow: "hidden",
          textOverflow: "ellipsis",
          textAlign: "right",
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

export function EntityInfoPanel() {
  const components = useEditorStore((s) => s.components);
  const selectedIds = useEditorStore((s) => s.selection.selectedIds);
  const findings = useProjectStore((s) => s.findings);
  const dependencies = useProjectStore((s) => s.dependencies);
  const files = useProjectStore((s) => s.files);

  const selectedComponent = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    return components.find((c) => c.id === selectedIds[0]) ?? null;
  }, [components, selectedIds]);

  const selectedFindings = useMemo(() => {
    if (!selectedComponent) return [];
    const targetName = strVal(selectedComponent.config?.fileName) || strVal(selectedComponent.config?.filePath) || strVal(selectedComponent.name);
    if (!targetName) return [];
    return findings.filter(
      (f) => f.message?.includes(targetName) || (f.targetId && f.targetId.includes(targetName))
    );
  }, [findings, selectedComponent]);

  if (!selectedComponent) {
    return (
      <Box
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          p: 2,
          color: "text.secondary",
        }}
      >
          <Typography variant="caption" sx={{ textAlign: "center", opacity: 0.6 }}>
          {t("panel.entityInfo.selectHint")}
        </Typography>
      </Box>
    );
  }

  const cfg = selectedComponent.config || {};
  const type = selectedComponent.type;
  const typeLabel = entityTypeLabel(type);
  const fileName = strVal(cfg.fileName) || selectedComponent.name;
  const filePath = strVal(cfg.filePath);
  const language = strVal(cfg.language);
  const layerName = strVal(cfg.layerName);
  const fileSize = numVal(cfg.fileSize);
  const depCount = numVal(cfg.dependencyCount);

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Box sx={{ color: "primary.main", display: "flex" }}>
          {TYPE_ICONS[type] || <DescriptionIcon sx={{ fontSize: 20 }} />}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" noWrap sx={{ fontSize: 13, fontWeight: 600 }}>
            {fileName}
          </Typography>
          <Chip label={typeLabel} size="small" variant="outlined" sx={{ height: 18, fontSize: 10, mt: 0.25 }} />
        </Box>
      </Box>

      {/* 实体详情 */}
      <Box sx={{ px: 1.5, py: 1, overflow: "auto", flex: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary", display: "block", mb: 0.75 }}>
          {t("panel.entityInfo.title")}
        </Typography>

        {language && <DetailRow label={t("panel.entityInfo.language")} value={language} />}
        {filePath && <DetailRow label={t("panel.entityInfo.path")} value={filePath} mono />}
        {fileSize != null && <DetailRow label={t("panel.entityInfo.size")} value={formatFileSize(fileSize)} />}
        {depCount != null && <DetailRow label={t("panel.entityInfo.depCount")} value={String(depCount)} />}
        {layerName && <DetailRow label={t("panel.entityInfo.layer")} value={layerName} />}
        {selectedComponent.transform && (
          <>
            <DetailRow label={t("panel.entityInfo.position")} value={`(${Math.round(selectedComponent.transform.x)}, ${Math.round(selectedComponent.transform.y)})`} />
            <DetailRow label={t("panel.entityInfo.dimensions")} value={`${Math.round(selectedComponent.transform.width)} × ${Math.round(selectedComponent.transform.height)}`} />
          </>
        )}

        {/* v2.17 依赖画像选中节点：展示该文件的完整依赖明细（全量 dependencies，不受 top-90 采样限制） */}
        {selectedComponent && (selectedComponent.config as any)?.portraitMode === "dependency" && (() => {
          const dcfg = selectedComponent.config as any;
          const fid: string = dcfg.fileId;
          const outDeps = dependencies.filter((d) => d.fromId === fid).map((d) => d.toId);
          const inDeps = dependencies.filter((d) => d.toId === fid).map((d) => d.fromId);
          const nameOf = (id: string) => files.find((f) => f.id === id)?.name ?? id;
          const locate = (id: string) => {
            const ed = useEditorStore.getState();
            const c = ed.components.find((cc) => (cc.config as any)?.fileId === id);
            if (c) {
              ed.focusComponent(c.id);
            } else {
              const sid = useSceneStore.getState().activeSceneId;
              if (sid) {
                void runPortrait("dependency", sid, { focusFileId: id }).then((res) =>
                  useToastStore.getState().showToast(res.message, res.severity)
                );
              }
            }
          };
          const renderRow = (id: string) => (
            <Box
              key={id}
              sx={{ display: "flex", alignItems: "center", px: 0.5, py: 0.25, borderRadius: 0.5, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
              onClick={() => locate(id)}
              title={t("panel.entityInfo.depRowHint")}
            >
              <Typography variant="caption" noWrap sx={{ fontSize: 11, maxWidth: 210, overflow: "hidden", textOverflow: "ellipsis" }}>
                {nameOf(id)}
              </Typography>
            </Box>
          );
          const cap = 12;
          return (
            <>
              <Divider sx={{ my: 1.5 }} />
              <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary", display: "block", mb: 0.75 }}>
                {t("panel.entityInfo.depSection")}
              </Typography>
              <Button size="small" variant="outlined" sx={{ mb: 0.75, textTransform: "none", fontSize: 11, height: 24 }} onClick={() => locate(fid)}>
                {t("panel.entityInfo.depFocusBtn")}
              </Button>
              {dcfg.depDepth != null && <DetailRow label={t("panel.entityInfo.depDepth")} value={String(dcfg.depDepth)} />}
              {dcfg.moduleName && <DetailRow label={t("panel.entityInfo.depModule")} value={String(dcfg.moduleName)} />}
              <DetailRow label={dcfg.inCycle ? t("panel.entityInfo.depInCycle", { n: dcfg.cycleSize ?? 0 }) : t("panel.entityInfo.depNotInCycle")} value="" />
              <Box sx={{ mt: 0.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, display: "block", mb: 0.25 }}>{t("panel.entityInfo.depImports", { n: outDeps.length })}</Typography>
                {outDeps.length === 0 ? (
                  <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>{t("panel.entityInfo.depNone")}</Typography>
                ) : (
                  <>
                    {outDeps.slice(0, cap).map(renderRow)}
                    {outDeps.length > cap && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: "block", mt: 0.25 }}>{t("panel.entityInfo.depMore", { n: outDeps.length - cap })}</Typography>
                    )}
                  </>
                )}
              </Box>
              <Box sx={{ mt: 0.75 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, display: "block", mb: 0.25 }}>{t("panel.entityInfo.depImportedBy", { n: inDeps.length })}</Typography>
                {inDeps.length === 0 ? (
                  <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>{t("panel.entityInfo.depNone")}</Typography>
                ) : (
                  <>
                    {inDeps.slice(0, cap).map(renderRow)}
                    {inDeps.length > cap && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: "block", mt: 0.25 }}>{t("panel.entityInfo.depMore", { n: inDeps.length - cap })}</Typography>
                    )}
                  </>
                )}
              </Box>
            </>
          );
        })()}

        {/* 审查结果 */}
        {selectedFindings.length > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary", display: "block", mb: 0.75 }}>
              {t("panel.entityInfo.reviewTitle", { n: selectedFindings.length })}
            </Typography>
            {selectedFindings.map((f, i) => {
              const sevCfg = SEVERITY_CONFIG[f.severity];
              return (
                <Paper
                  key={f.id || i}
                  variant="outlined"
                  sx={{
                    p: 1,
                    mb: 0.75,
                    borderLeft: 3,
                    borderColor: sevCfg ? `${sevCfg.color}.main` : "grey.500",
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.25 }}>
                    {sevCfg ? sevCfg.icon : <InfoOutlinedIcon sx={{ fontSize: 16 }} />}
                    <Chip
                      label={f.severity}
                      size="small"
                      color={sevCfg ? sevCfg.color : "default"}
                      sx={{ height: 16, fontSize: 9 }}
                    />
                  </Box>
                  <Typography variant="caption" sx={{ display: "block", mt: 0.25, fontSize: 11 }}>
                    {f.message}
                  </Typography>
                  {f.suggestion && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25, fontSize: 10 }}>
                      {t("panel.entityInfo.suggestion")}: {f.suggestion}
                    </Typography>
                  )}
                </Paper>
              );
            })}
          </>
        )}

        {selectedFindings.length === 0 && (
          <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: "block" }}>
            {t("panel.entityInfo.noReview")}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
