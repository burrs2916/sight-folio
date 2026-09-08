// project-sight: 实体图鉴（实体类型库观察页）
// 实体全部由系统内嵌（分析器插件注册 + 扫描产生），本页只做「观察」：
// 左侧默认按语言分组（公用实体独立成组）+ 搜索；右侧展示选中实体的类型画像（作用/属性/项目统计）。
// 不提供新建/编辑/删除/移动分组功能。
import { useState, useMemo, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Tooltip from "@mui/material/Tooltip";
import SearchIcon from "@mui/icons-material/Search";
import DescriptionIcon from "@mui/icons-material/Description";
import CodeIcon from "@mui/icons-material/Code";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import { componentRegistry } from "../editor/registry";
import { resolveEntityIcon } from "../editor/entityIconMap";
import { EntityRendererPreview } from "../editor/components/EntityRendererPreview";
import { analyzerRegistry, useAnalyzerVersion } from "../editor/analyzer";
import { useProjectStore } from "../store/projectStore";
import { t, resolveFragments } from "../i18n";
import type { ComponentDefinition } from "../types/editor";
import { languageColor } from "../utils/languageMeta";
import { isImageFile, isAssetFile } from "../editor/utils/fileKind";

// ─── 语言维度（核心：实体按语言分组，公用实体独立）───
// 语言主题色（小写 id → 色），与建模工具图例一致；公用灰。
// 语言配色统一走 languageMeta（短码/别名/全名自动适配，新增语言无需在此补）
function langColor(id: string): string {
  return languageColor(id);
}
/** 「通用」分组的专属中性色（非某语言） */
const COMMON_COLOR = "#64748b";

/** 语言展示名：优先 analyzer 注册表的 manifest.language，否则首字母大写兜底 */
function langDisplayName(id: string): string {
  const a = analyzerRegistry.getAllAnalyzers().find(
    (x) => (x.languageAliases ?? [x.language.toLowerCase()]).includes(id) || x.language.toLowerCase() === id
  );
  return a ? t(a.name) : id.charAt(0).toUpperCase() + id.slice(1);
}

/** 实体按语言分组：公用实体（无 languages）独立成组，其余按项目实际语言归组 */
function groupByLanguage(defs: ComponentDefinition[], projectLangs: string[]) {
  const common: ComponentDefinition[] = [];
  const byLang = new Map<string, ComponentDefinition[]>();
  for (const d of defs) {
    const langs = d.languages && d.languages.length ? d.languages : null;
    if (!langs) {
      common.push(d);
      continue;
    }
    for (const l of langs) {
      if (!projectLangs.includes(l)) continue;
      if (!byLang.has(l)) byLang.set(l, []);
      byLang.get(l)!.push(d);
    }
  }
  return { common, byLang };
}

// ─── 实体类别分组（自动，非用户可编辑；按类别维度使用）───
//
// 这张表必须覆盖**所有**分析器插件注册的实体 type：漏掉的会掉进「其他」，
// 而「其他」一旦超过三五条就退化成垃圾桶——用户在里面找 Trait 和在全量列表里找没区别，
// 「按类别」这个维度也就白提供了。
function getCategoryGroups(): { id: string; label: string; types: string[] }[] {
  return [
    // 容器：目录树里能同屏出现的层级单位
    { id: "core", label: t("entities.catCore"), types: ["file", "folder", "module", "package", "crate", "image", "asset"] },
    // 代码符号：源码里真实存在的声明
    { id: "symbol", label: t("entities.catSymbol"), types: ["class", "struct", "trait", "interface", "function"] },
    // 分析元素：扫描/画布产生的标注物，源码里没有对应声明
    {
      id: "analysis",
      label: t("entities.catAnalysis"),
      types: ["dependency-edge", "layer-marker", "annotation-text", "code-preview", "pattern-node"],
    },
    // 视图型：整张图（一个实体承载一个视图），与单个符号不是一个量级
    {
      id: "view",
      label: t("entities.catView"),
      types: [
        "architecture",
        "dependency",
        "layering",
        "inheritance",
        "interface-impl",
        "call-graph",
        "coroutine-flow",
        "component-tree",
        "complexity",
        "coupling",
        "unsafe-risk",
      ],
    },
  ];
}

function categorizeType(type: string): string {
  for (const g of getCategoryGroups()) if (g.types.includes(type)) return g.id;
  return "other";
}

/** 插件来源标签 */
function sourceLabel(def: ComponentDefinition): { label: string; color: string } {
  if (def.category?.startsWith("analyzer-")) {
    const id = def.category.slice("analyzer-".length);
    const analyzer = analyzerRegistry.getAnalyzer(id);
    if (analyzer) {
      const color = analyzer.language.toLowerCase() === "typescript" ? "#3178c6"
        : analyzer.language.toLowerCase() === "rust" ? "#dea584"
        : analyzer.language.toLowerCase() === "python" ? "#3776ab" : "#64748b";
      return { label: t(analyzer.name), color };
    }
    return { label: id, color: "#64748b" };
  }
  return { label: t("entities.builtin"), color: "#94a3b8" };
}

/** 类型说明（动态解释实体作用） */
function typeExplanation(def: ComponentDefinition): string {
  const extra = def.description ? def.description : "";
  const key = `entities.types.${def.type}`;
  const resolved = t(key);
  const baseText =
    resolved === key ? t("entities.typesFallback", { name: resolveFragments(def.name), type: def.type }) : resolved;
  return extra ? `${baseText} ${extra}` : baseText;
}

/** 类型画像卡 */
function TypePortrait({ def }: { def: ComponentDefinition }) {
  // folder 走专属画像：容器隐喻 + 真实树统计，从布局上与其他实体明显区分
  if (def.type === "folder") return <FolderPortrait def={def} />;
  const files = useProjectStore((s) => s.files);
  const deps = useProjectStore((s) => s.dependencies);
  const findings = useProjectStore((s) => s.findings);

  const stats = useMemo(() => {
    const nonDir = files.filter((f) => !f.isDirectory);
    switch (def.type) {
      case "file": return { value: nonDir.length, unit: t("entities.units.sourceFiles") };
      case "folder": return { value: files.filter((f) => f.isDirectory).length, unit: t("entities.units.dirs") };
      case "image": return { value: files.filter((f) => !f.isDirectory && (f.language === "image" || isImageFile(f.relPath || f.name))).length, unit: t("entities.units.assets") };
      case "asset": return { value: files.filter((f) => !f.isDirectory && (f.language === "asset" || isAssetFile(f.relPath || f.name))).length, unit: t("entities.units.assets") };
      case "module": return { value: deps.length, unit: t("entities.units.deps") };
      case "dependency-edge": return { value: deps.filter((d) => d.isCircular).length, unit: t("entities.units.circularDeps") };
      case "layer-marker": return { value: files.filter((f) => f.layerId).length, unit: t("entities.units.layeredFiles") };
      default: return { value: findings.filter((f) => f.targetType === def.type).length, unit: t("entities.units.findings") };
    }
  }, [def.type, files, deps, findings]);

  const configKeys = useMemo(() => {
    const keys = new Set<string>();
    if (def.configSchema) def.configSchema.forEach((f) => keys.add(f.key));
    Object.keys(def.defaultConfig || {}).forEach((k) => keys.add(k));
    return Array.from(keys);
  }, [def.configSchema, def.defaultConfig]);

  const src = sourceLabel(def);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      {/* 身份（实体真实 SVG 渲染外观） */}
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "background.paper" }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.25 }}>
          <EntityRendererPreview
            type={def.type}
            icon={def.icon}
            config={def.defaultConfig}
            width={150}
            height={76}
            scale={0.9}
            borderRadius={10}
          />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Box sx={{ display: "flex", alignItems: "center", color: "primary.main", flexShrink: 0 }}>
                {resolveEntityIcon(def.icon, 19, def.type)}
              </Box>
              <Typography variant="body1" sx={{ fontWeight: 600, fontSize: 15 }}>
                {resolveFragments(def.name)}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.5, flexWrap: "wrap" }}>
              <Chip label={def.type} size="small" sx={{ height: 16, fontSize: 9, "& .MuiChip-label": { px: 0.75 } }} />
              <Chip
                label={src.label}
                size="small"
                sx={{
                  height: 16,
                  fontSize: 9,
                  "& .MuiChip-label": { px: 0.75 },
                  bgcolor: `${src.color}1a`,
                  color: src.color,
                }}
              />
              <Chip label={`v${def.version}`} size="small" variant="outlined" sx={{ height: 16, fontSize: 9, "& .MuiChip-label": { px: 0.75 } }} />
            </Box>
          </Box>
        </Box>
        {/* 适用语言（按语言分组的核心信息，公用实体不显示） */}
        {def.languages && def.languages.length > 0 && (
          <Box
            sx={{
              mt: 1,
              pt: 1,
              borderTop: 1,
              borderColor: "divider",
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              flexWrap: "wrap",
            }}
          >
            <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>
              {t("entities.applicableLang")}
            </Typography>
            {def.languages.slice(0, 6).map((l) => (
              <Chip
                key={l}
                label={langDisplayName(l)}
                size="small"
                sx={{
                  height: 15,
                  fontSize: 8,
                  "& .MuiChip-label": { px: 0.5 },
                  bgcolor: `${langColor(l)}1a`,
                  color: langColor(l),
                }}
              />
            ))}
            {def.languages.length > 6 && (
              <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary" }}>
                +{def.languages.length - 6}
              </Typography>
            )}
          </Box>
        )}
        <Box
          sx={{
            mt: 1,
            pt: 1,
            borderTop: 1,
            borderColor: "divider",
            display: "flex",
            gap: 2,
          }}
        >
          <Typography variant="caption" sx={{ fontSize: 11, color: "text.secondary" }}>
            {t("entities.inProject")}<strong style={{ color: "text.primary" }}>{stats.value}</strong> {stats.unit}
          </Typography>
          <Typography variant="caption" sx={{ fontSize: 11, color: "text.secondary" }}>
            {t("entities.properties")}{t("entities.itemCount", { n: configKeys.length })}
          </Typography>
        </Box>
      </Paper>

      {/* 作用 */}
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "background.paper" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.75 }}>
          <InfoOutlinedIcon sx={{ fontSize: 13, color: "info.main" }} />
          <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "text.secondary" }}>
            {t("entities.role")}
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ fontSize: 12, lineHeight: 1.7 }}>
          {typeExplanation(def)}
        </Typography>
      </Paper>

      {/* 属性 */}
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "background.paper" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.75 }}>
          <AccountTreeIcon sx={{ fontSize: 13, color: "primary.main" }} />
          <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "text.secondary" }}>
            {t("entities.propDef")}
          </Typography>
        </Box>
        {configKeys.length === 0 ? (
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>
            {t("entities.noProps")}
          </Typography>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            {configKeys.map((k) => (
              <Box key={k} sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
                <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>{k}</Typography>
                <Typography variant="caption" sx={{ fontSize: 10, fontFamily: "monospace" }}>
                  {String((def.defaultConfig || {})[k] ?? "—")}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Paper>

      {/* 用法 */}
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "background.paper" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.75 }}>
          <CodeIcon sx={{ fontSize: 13, color: "text.secondary" }} />
          <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "text.secondary" }}>
            {t("entities.usage")}
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ fontSize: 11, lineHeight: 1.7, color: "text.secondary", display: "block" }}>
          {t("entities.usageDesc")}
        </Typography>
      </Paper>
    </Box>
  );
}

// ─── 文件夹专属画像：容器隐喻 + 真实树统计，从布局上与其他实体区分 ───
const FOLDER_COLOR = "#F59E0B";

function StatCell({ label, value, unit, sub }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0 }}>
      <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={label}>
        {label}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.25, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600, color: "text.primary", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={typeof value === "string" ? value : undefined}>
          {value}
        </Typography>
        {unit && <Typography component="span" sx={{ fontSize: 9, fontWeight: 400, color: "text.secondary", flexShrink: 0 }}>{unit}</Typography>}
      </Box>
      {sub != null && <Typography variant="caption" sx={{ fontSize: 8, color: "text.secondary" }}>{sub}</Typography>}
    </Box>
  );
}

function FolderPortrait({ def }: { def: ComponentDefinition }) {
  const files = useProjectStore((s) => s.files);

  const tree = useMemo(() => {
    const dirs = files.filter((f) => f.isDirectory);
    const nonDirs = files.filter((f) => !f.isDirectory);
    const depthOf = (relPath: string) => relPath.split("/").filter(Boolean).length;
    const dirDepths = dirs.map((d) => depthOf(d.relPath));
    const maxDepth = dirDepths.length ? Math.max(...dirDepths) : 0;
    const avgDepth = dirDepths.length
      ? Math.round((dirDepths.reduce((a, b) => a + b, 0) / dirDepths.length) * 10) / 10
      : 0;
    // 含文件最多的目录：按 parentId 聚合非目录文件
    const fileCountByParent = new Map<string | null, number>();
    nonDirs.forEach((f) => {
      fileCountByParent.set(f.parentId, (fileCountByParent.get(f.parentId) || 0) + 1);
    });
    let topRel: string | null = null;
    let topCount = 0;
    dirs.forEach((d) => {
      const c = fileCountByParent.get(d.id) || 0;
      if (c > topCount) { topCount = c; topRel = d.relPath; }
    });
    const deepestRel = dirs.length
      ? dirs.reduce((a, b) => (depthOf(a.relPath) >= depthOf(b.relPath) ? a : b)).relPath
      : null;
    return { dirCount: dirs.length, fileCount: nonDirs.length, maxDepth, avgDepth, topRel, topCount, deepestRel };
  }, [files]);

  const total = tree.dirCount + tree.fileCount;
  const filePct = total > 0 ? Math.round((tree.fileCount / total) * 100) : 0;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      {/* 身份区：容器强调（folder 主题色，区别于其他实体的 indigo） */}
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, borderColor: `${FOLDER_COLOR}55`, bgcolor: "background.paper" }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.25 }}>
          <EntityRendererPreview type={def.type} icon={def.icon} config={def.defaultConfig} width={150} height={76} scale={0.9} borderRadius={10} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Box sx={{ display: "flex", alignItems: "center", color: FOLDER_COLOR, flexShrink: 0 }}>
                {resolveEntityIcon(def.icon, 19, def.type)}
              </Box>
              <Typography variant="body1" sx={{ fontWeight: 600, fontSize: 15 }}>{resolveFragments(def.name)}</Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
              <Chip label={def.type} size="small" sx={{ height: 16, fontSize: 9, "& .MuiChip-label": { px: 0.75 } }} />
              <Chip label={t("entities.folderPortrait.container")} size="small" sx={{ height: 16, fontSize: 9, "& .MuiChip-label": { px: 0.75 }, bgcolor: `${FOLDER_COLOR}1a`, color: FOLDER_COLOR }} />
              <Chip label={`v${def.version}`} size="small" variant="outlined" sx={{ height: 16, fontSize: 9, "& .MuiChip-label": { px: 0.75 } }} />
            </Box>
          </Box>
        </Box>
        {/* 结构统计网格（2 列），其他实体无此区块 */}
        <Box sx={{ mt: 1.25, pt: 1.25, borderTop: 1, borderColor: "divider", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, rowGap: 1.1 }}>
          <StatCell label={t("entities.folderPortrait.statDirCount")} value={tree.dirCount} unit={t("entities.folderPortrait.unitsLayers")} />
          <StatCell label={t("entities.folderPortrait.statFileCount")} value={tree.fileCount} unit={t("entities.units.sourceFiles")} />
          <StatCell label={t("entities.folderPortrait.statMaxDepth")} value={tree.maxDepth} unit={t("entities.folderPortrait.unitsLayers")} />
          <StatCell label={t("entities.folderPortrait.statAvgDepth")} value={tree.avgDepth} unit={t("entities.folderPortrait.unitsLayers")} />
          <StatCell label={t("entities.folderPortrait.statDeepestDir")} value={tree.deepestRel ?? "—"} />
          <StatCell label={t("entities.folderPortrait.statLargestDir")} value={tree.topRel ?? "—"} sub={tree.topCount > 0 ? `${tree.topCount} ${t("entities.units.sourceFiles")}` : undefined} />
        </Box>
      </Paper>

      {/* 包含关系（比例条），其他实体无此区块 */}
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "background.paper" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.75 }}>
          <AccountTreeIcon sx={{ fontSize: 13, color: FOLDER_COLOR }} />
          <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "text.secondary" }}>
            {t("entities.folderPortrait.contains")}
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ fontSize: 11, color: "text.secondary", display: "block", mb: 0.75 }}>
          {t("entities.folderPortrait.containsDesc", { files: tree.fileCount, folders: tree.dirCount })}
        </Typography>
        <Box sx={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", bgcolor: "action.hover" }}>
          <Box sx={{ width: `${filePct}%`, bgcolor: FOLDER_COLOR }} title={`${t("entities.units.sourceFiles")} ${filePct}%`} />
          <Box sx={{ flex: 1, bgcolor: `${FOLDER_COLOR}66` }} />
        </Box>
      </Paper>

      {/* 作用 */}
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "background.paper" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.75 }}>
          <InfoOutlinedIcon sx={{ fontSize: 13, color: "info.main" }} />
          <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "text.secondary" }}>
            {t("entities.role")}
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ fontSize: 12, lineHeight: 1.7 }}>{typeExplanation(def)}</Typography>
      </Paper>

      {/* 属性：动态派生说明，不再展示 defaultConfig 死值 */}
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "background.paper" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.75 }}>
          <AccountTreeIcon sx={{ fontSize: 13, color: "primary.main" }} />
          <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "text.secondary" }}>
            {t("entities.propDef")}
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: "block", lineHeight: 1.6 }}>
          {t("entities.folderPortrait.dynamicProps")}
        </Typography>
      </Paper>
    </Box>
  );
}

/** 分组树节点 */
function GroupNode({
  label,
  count,
  color,
  icon,
  depth,
  selected,
  onClick,
}: {
  label: string;
  count?: number;
  color?: string;
  /** 叶子节点（具体实体类型）的类型图标 —— 分组节点不传 */
  icon?: ReactNode;
  depth: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        px: 1,
        py: 0.6,
        mx: 0.75,
        borderRadius: 1,
        cursor: "pointer",
        pl: 1 + depth * 1.25,
        bgcolor: selected ? "rgba(99,102,241,0.1)" : "transparent",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      {color && <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />}
      {icon && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            color: selected ? "primary.main" : "text.secondary",
          }}
        >
          {icon}
        </Box>
      )}
      <Typography noWrap sx={{ fontSize: 12, fontWeight: selected ? 600 : 400, flex: 1 }}>
        {label}
      </Typography>
      {typeof count === "number" && (
        <Box
          sx={{
            minWidth: 16,
            height: 16,
            px: 0.5,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            fontWeight: 600,
            color: "text.secondary",
            bgcolor: "action.hover",
          }}
        >
          {count}
        </Box>
      )}
    </Box>
  );
}

/** 形状图例：实体画布严格形状语言（R 形状语言）的速查，帮助认形状 */
const SHAPE_LEGEND: { shape: string; color: string; key: string }[] = [
  { shape: "file", color: "#3178C6", key: "shapeFile" },
  { shape: "folder", color: "#FB923C", key: "shapeFolder" },
  { shape: "module", color: "#3B82F6", key: "shapeModule" },
  { shape: "class", color: "#8B5CF6", key: "shapeClass" },
  { shape: "interface", color: "#EC4899", key: "shapeInterface" },
  { shape: "function", color: "#10B981", key: "shapeFunction" },
  { shape: "image", color: "#14b8a6", key: "shapeImage" },
  { shape: "asset", color: "#ea580c", key: "shapeAsset" },
];

/** 单个形状的小预览（与画布形状语言一致，纯 SVG） */
function MiniShape({ color }: { shape: string; color: string }) {
  return (
    <svg viewBox="0 0 44 26" width={34} height={20} style={{ flexShrink: 0 }}>
      {color === "#FB923C" ? (
        // folder：顶部标签
        <>
          <rect x={4} y={4} width={18} height={5} rx={2} fill={color} />
          <rect x={2} y={8} width={40} height={16} rx={3} fill="none" stroke={color} strokeWidth={1.4} />
        </>
      ) : color === "#3B82F6" ? (
        // module：层叠
        <>
          <rect x={8} y={8} width={34} height={14} rx={3} fill="none" stroke={color} strokeWidth={1.2} opacity={0.5} />
          <rect x={2} y={3} width={34} height={14} rx={3} fill="none" stroke={color} strokeWidth={1.4} />
        </>
      ) : color === "#8B5CF6" ? (
        // class：三段框
        <>
          <rect x={2} y={3} width={40} height={20} rx={2} fill="none" stroke={color} strokeWidth={1.4} />
          <line x1={2} y1={11} x2={42} y2={11} stroke={color} strokeWidth={0.8} />
          <line x1={2} y1={18} x2={42} y2={18} stroke={color} strokeWidth={0.8} />
        </>
      ) : color === "#EC4899" ? (
        // interface：胶囊 + lollipop
        <>
          <circle cx={7} cy={13} r={4} fill="none" stroke={color} strokeWidth={1.4} />
          <line x1={11} y1={13} x2={16} y2={13} stroke={color} strokeWidth={1.4} />
          <rect x={16} y={5} width={26} height={16} rx={8} fill="none" stroke={color} strokeWidth={1.4} />
        </>
      ) : color === "#10B981" ? (
        // function：全胶囊
        <rect x={2} y={5} width={40} height={16} rx={8} fill="none" stroke={color} strokeWidth={1.4} />
      ) : color === "#14b8a6" ? (
        // image：矩形 + 太阳 + 山（经典图片图标轮廓）
        <>
          <rect x={2} y={3} width={40} height={20} rx={3} fill="none" stroke={color} strokeWidth={1.4} />
          <circle cx={13} cy={10} r={3} fill="none" stroke={color} strokeWidth={1.2} />
          <path d="M6 23 L18 12 L26 19 L32 14 L42 23" fill="none" stroke={color} strokeWidth={1.2} />
        </>
      ) : color === "#ea580c" ? (
        // asset：矩形 + 对角数据斜线（二进制资源隐喻）
        <>
          <rect x={2} y={3} width={40} height={20} rx={3} fill="none" stroke={color} strokeWidth={1.4} />
          <path d="M10 23 L34 3" stroke={color} strokeWidth={1.2} />
          <path d="M22 23 L40 5" stroke={color} strokeWidth={1.2} opacity={0.5} />
        </>
      ) : (
        // file：折角文档
        <>
          <path d="M3 4 H30 L41 15 V23 Q41 25 39 25 H3 Q1 25 1 23 V6 Q1 4 3 4 Z" fill="none" stroke={color} strokeWidth={1.4} />
          <path d="M30 4 L30 15 L41 15" fill="none" stroke={color} strokeWidth={0.8} opacity={0.6} />
        </>
      )}
    </svg>
  );
}

function ShapeLegend() {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "wrap" }}>
      <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "text.secondary", flexShrink: 0 }}>
        {t("entities.shapeLegend")}
      </Typography>
      {SHAPE_LEGEND.map((s) => (
        <Box key={s.key} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <MiniShape shape={s.shape} color={s.color} />
          <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>
            {t(`entities.${s.key}`)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export default function EntityCatalogPage() {
  const analyzerVersion = useAnalyzerVersion();
  const defs = useMemo(() => componentRegistry.getAll(), []);
  const files = useProjectStore((s) => s.files);
  const layers = useProjectStore((s) => s.layers);

  const [dimension, setDimension] = useState<"all" | "category" | "source" | "layer" | "language">("language");
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [selectedLang, setSelectedLang] = useState<string | null>(null);
  const [expandedLang, setExpandedLang] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? defs.filter(
          (d) =>
            resolveFragments(d.name).toLowerCase().includes(q) || t(d.name).toLowerCase().includes(q) ||
            d.type.toLowerCase().includes(q) ||
            (d.description || "").toLowerCase().includes(q)
        )
      : defs;
  }, [defs, search]);

  const selectedDef = useMemo(
    () => defs.find((d) => d.type === selectedType) ?? null,
    [defs, selectedType]
  );

  // 仅设置选中实体；不清空 selectedLang，否则语言组展开状态会被一并收回
  const selectType = (type: string) => {
    setSelectedType(type);
    setSelectedLayerId(null);
  };

  // 本项目实际语言：从扫描文件聚合；无文件时回退全部已注册语言，避免空页
  const projectLangs = useMemo(() => {
    const fromFiles = new Set<string>();
    for (const f of files) if (f.language) fromFiles.add(f.language.toLowerCase());
    if (fromFiles.size > 0) return Array.from(fromFiles);
    const all = new Set<string>();
    for (const a of analyzerRegistry.getAllAnalyzers()) {
      for (const id of a.languageAliases ?? [a.language.toLowerCase()]) all.add(id);
    }
    return Array.from(all);
  }, [files, analyzerVersion]);

  const langGroups = useMemo(() => groupByLanguage(filtered, projectLangs), [filtered, projectLangs]);

  // 分层文件列表（维度=layer 时展示）
  const selectedLayer = layers.find((l) => l.id === selectedLayerId) ?? null;
  const layerFiles = useMemo(
    () => (selectedLayerId ? files.filter((f) => !f.isDirectory && f.layerId === selectedLayerId) : []),
    [files, selectedLayerId]
  );

  // 右侧网格数据：语言维度且选中某语言时显示该语言实体，否则显示过滤全集
  const gridItems =
    dimension === "language" && selectedLang ? langGroups.byLang.get(selectedLang) ?? [] : filtered;

  return (
    <Box sx={{ display: "flex", gap: 1.5, height: "100%", minHeight: 0 }}>
      {/* ─── 左侧：搜索 + 维度分组树 ─── */}
      <Box
        sx={{
          width: 260,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          bgcolor: "background.paper",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
          <TextField
            fullWidth
            size="small"
            placeholder={t("entities.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 16 }} />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ "& .MuiInputBase-input": { fontSize: 12, py: 0.75 } }}
          />
          <Box sx={{ display: "flex", gap: 0.5, mt: 1, flexWrap: "wrap" }}>
            {(
              [
                ["all", t("entities.dimAll")],
                ["language", t("entities.dimLanguage")],
                ["category", t("entities.dimCategory")],
                ["source", t("entities.dimSource")],
                ["layer", t("entities.dimLayer")],
              ] as const
            ).map(([id, label]) => (
              <Chip
                key={id}
                label={label}
                size="small"
                onClick={() => setDimension(id)}
                sx={{
                  height: 22,
                  fontSize: 10,
                  "& .MuiChip-label": { px: 0.75 },
                  bgcolor: dimension === id ? "primary.main" : "action.hover",
                  color: dimension === id ? "#fff" : "text.primary",
                  "&:hover": { bgcolor: dimension === id ? "primary.dark" : "action.selected" },
                }}
              />
            ))}
          </Box>
        </Box>

        <Box sx={{ flex: 1, overflow: "auto", py: 0.75 }}>
          {dimension === "all" && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
              <GroupNode
                label={t("entities.allEntities")}
                count={filtered.length}
                depth={0}
                selected={selectedType === null && selectedLayerId === null && selectedLang === null}
                onClick={() => { setSelectedType(null); setSelectedLayerId(null); setSelectedLang(null); }}
              />
              {filtered.map((d) => (
                <GroupNode
                  key={d.type}
                  label={resolveFragments(d.name)}
                  icon={resolveEntityIcon(d.icon, 15, d.type)}
                  depth={1}
                  selected={selectedType === d.type}
                  onClick={() => selectType(d.type)}
                />
              ))}
            </Box>
          )}

          {dimension === "language" && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
              {/* 公用实体组（file/folder/module/分析标注类等，跨语言） */}
              <GroupNode
                label={t("entities.catCommon")}
                count={langGroups.common.length}
                color={COMMON_COLOR}
                depth={0}
                selected={selectedType === null && selectedLayerId === null && selectedLang === null}
                onClick={() => { setSelectedType(null); setSelectedLayerId(null); setSelectedLang(null); }}
              />
              {langGroups.common.map((d) => (
                <GroupNode
                  key={d.type}
                  label={resolveFragments(d.name)}
                  icon={resolveEntityIcon(d.icon, 15, d.type)}
                  depth={1}
                  selected={selectedType === d.type}
                  onClick={() => selectType(d.type)}
                />
              ))}
              {/* 各语言组（仅项目实际语言，按语言主题色 + 展示名） */}
              {Array.from(langGroups.byLang.entries()).map(([lang, items]) => (
                <Box key={lang}>
                  <GroupNode
                    label={langDisplayName(lang)}
                    count={items.length}
                    color={langColor(lang)}
                    depth={0}
                    selected={expandedLang === lang}
                    onClick={() => {
                      if (expandedLang === lang) { setExpandedLang(null); setSelectedLang(null); }
                      else { setExpandedLang(lang); setSelectedLang(lang); }
                      setSelectedType(null); setSelectedLayerId(null);
                    }}
                  />
                  {expandedLang === lang &&
                    items.map((d) => (
                      <GroupNode
                        key={d.type}
                        label={resolveFragments(d.name)}
                        icon={resolveEntityIcon(d.icon, 15, d.type)}
                        depth={1}
                        selected={selectedType === d.type}
                        onClick={() => selectType(d.type)}
                      />
                    ))}
                </Box>
              ))}
            </Box>
          )}

          {dimension === "category" && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
              {getCategoryGroups().map((g) => {
                const items = filtered.filter((d) => categorizeType(d.type) === g.id);
                return (
                  <Box key={g.id}>
                    <GroupNode label={g.label} count={items.length} depth={0} selected={false} onClick={() => {}} />
                    {items.map((d) => (
                      <GroupNode
                        key={d.type}
                        label={resolveFragments(d.name)}
                        icon={resolveEntityIcon(d.icon, 15, d.type)}
                        depth={1}
                        selected={selectedType === d.type}
                        onClick={() => selectType(d.type)}
                      />
                    ))}
                  </Box>
                );
              })}
              {(() => {
                const items = filtered.filter((d) => categorizeType(d.type) === "other");
                return items.length > 0 ? (
                  <Box>
                    <GroupNode label={t("entities.other")} count={items.length} depth={0} selected={false} onClick={() => {}} />
                    {items.map((d) => (
                      <GroupNode
                        key={d.type}
                        label={resolveFragments(d.name)}
                        icon={resolveEntityIcon(d.icon, 15, d.type)}
                        depth={1}
                        selected={selectedType === d.type}
                        onClick={() => selectType(d.type)}
                      />
                    ))}
                  </Box>
                ) : null;
              })()}
            </Box>
          )}

          {dimension === "source" && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
              {(() => {
                const groups = new Map<string, ComponentDefinition[]>();
                for (const d of filtered) {
                  const label = sourceLabel(d).label;
                  if (!groups.has(label)) groups.set(label, []);
                  groups.get(label)!.push(d);
                }
                return Array.from(groups.entries()).map(([label, items]) => (
                  <Box key={label}>
                    <GroupNode label={label} count={items.length} depth={0} selected={false} onClick={() => {}} />
                    {items.map((d) => (
                      <GroupNode
                        key={d.type}
                        label={resolveFragments(d.name)}
                        icon={resolveEntityIcon(d.icon, 15, d.type)}
                        depth={1}
                        selected={selectedType === d.type}
                        onClick={() => selectType(d.type)}
                      />
                    ))}
                  </Box>
                ));
              })()}
            </Box>
          )}

          {dimension === "layer" && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
              {layers.length === 0 && (
                <Typography variant="caption" color="text.disabled" sx={{ px: 1.5, py: 1, fontSize: 10 }}>
                  {t("entities.noLayers")}
                </Typography>
              )}
              {layers.map((l) => {
                const count = files.filter((f) => !f.isDirectory && f.layerId === l.id).length;
                return (
                  <GroupNode
                    key={l.id}
                    label={l.name}
                    count={count}
                    color={l.color || "#94A3B8"}
                    depth={0}
                    selected={selectedLayerId === l.id}
                    onClick={() => { setSelectedLayerId(l.id); setSelectedType(null); setSelectedLang(null); }}
                  />
                );
              })}
            </Box>
          )}
        </Box>
      </Box>

      {/* ─── 右侧：类型画像 / 分层文件列表 / 实体网格 ─── */}
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* 形状图例（吸顶，帮助认形状语言） */}
        <Box sx={{ flexShrink: 0, px: 0.5, py: 0.75, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <ShapeLegend />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, overflow: "auto", p: 0.25 }}>
        {selectedLayer ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: selectedLayer.color || "#94A3B8" }} />
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {selectedLayer.name}
              </Typography>
              <Chip label={t("entities.filesCount", { n: layerFiles.length })} size="small" sx={{ height: 18, fontSize: 10, "& .MuiChip-label": { px: 0.75 } }} />
            </Box>
            {layerFiles.length === 0 ? (
              <Typography variant="caption" color="text.disabled">
                {t("entities.noFilesInLayer")}
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                {layerFiles.map((f) => (
                  <Paper
                    key={f.id}
                    variant="outlined"
                    sx={{ px: 1.25, py: 0.75, borderRadius: 1.5, display: "flex", alignItems: "center", gap: 1 }}
                  >
                    <DescriptionIcon sx={{ fontSize: 15, color: "text.secondary" }} />
                    <Typography noWrap sx={{ fontSize: 12, flex: 1 }}>
                      {f.name}
                    </Typography>
                    {f.language && (
                      <Chip label={f.language} size="small" sx={{ height: 15, fontSize: 8, "& .MuiChip-label": { px: 0.5 } }} />
                    )}
                    <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>
                      {t("nav.lineCount", { n: f.lineCount })}
                    </Typography>
                  </Paper>
                ))}
              </Box>
            )}
          </Box>
        ) : selectedDef ? (
          <TypePortrait def={selectedDef} />
        ) : (
          /* 实体网格（全部 / 某语言） */
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 1 }}>
            {gridItems.map((d) => {
              const src = sourceLabel(d);
              return (
                <Paper
                  key={d.type}
                  variant="outlined"
                  onClick={() => selectType(d.type)}
                  sx={{
                    p: 1.25,
                    borderRadius: 1.5,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    "&:hover": {
                      borderColor: "primary.main",
                      boxShadow: (t) => `0 0 0 1px ${t.palette.mode === "dark" ? "rgba(99,102,241,0.4)" : "rgba(99,102,241,0.2)"}`,
                    },
                  }}
                >
                  {/* 实体真实 SVG 渲染预览 */}
                  <EntityRendererPreview
                    type={d.type}
                    icon={d.icon}
                    config={d.defaultConfig}
                    width={158}
                    height={66}
                    scale={0.7}
                    borderRadius={8}
                  />
                  {/* 类型图标 + 名称：图标是列表里最快的类型识别手段 */}
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 1 }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: src.color,
                        flexShrink: 0,
                      }}
                    >
                      {resolveEntityIcon(d.icon, 17, d.type)}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography noWrap sx={{ fontSize: 12, fontWeight: 500 }}>
                        {resolveFragments(d.name)}
                      </Typography>
                      <Typography noWrap variant="caption" sx={{ fontSize: 9, color: src.color }}>
                        {src.label}
                      </Typography>
                    </Box>
                  </Box>
                  <Typography
                    variant="caption"
                    sx={{
                      fontSize: 10,
                      color: "text.secondary",
                      display: "-webkit-box",
                      mt: 1,
                      lineHeight: 1.5,
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {d.description || typeExplanation(d)}
                  </Typography>
                </Paper>
              );
            })}
            {gridItems.length === 0 && (
              <Typography variant="caption" color="text.disabled" sx={{ py: 4, textAlign: "center" }}>
                {t("entities.noMatching")}
              </Typography>
            )}
          </Box>
        )}
        </Box>
      </Box>
    </Box>
  );
}
