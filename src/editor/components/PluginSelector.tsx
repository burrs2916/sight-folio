// project-sight: 分析器插件切换器（§5.2 顶部工具栏 PluginSelector）
// 显示当前激活的分析器插件，下拉列出所有已注册插件（语言/版本/能力），
// 切换时调用 analyzerRegistry.setActiveAnalyzer 并给出全局通知。
//
// §联动（修复"插件是死的"痛点）：
// - 每个插件菜单项展示「当前分析」中该语言插件的实时统计
//   （文件数 / 符号数 / 引用边 / 审查发现 / 技术债），数据来自 projectStore
// - 切换插件 → 同时设置 projectStore.focusLanguage = 插件语言：
//   左侧实体面板 / 文件面板按该语言过滤展示，画布非该语言实体淡化，
//   实现"插件 ↔ 分析数据"的真实联动

import { useState, useMemo, useEffect } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import CheckIcon from "@mui/icons-material/Check";
import ExtensionIcon from "@mui/icons-material/Extension";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import { analyzerRegistry, useActiveAnalyzer, type AnalyzerManifest } from "../analyzer";
import { useToastStore } from "../../store/toastStore";
import { useProjectStore } from "../../store/projectStore";
import { t } from "../../i18n";
import { projectScanApi, type ParserCapability } from "../../services/tauri";
import { languageColor } from "../../utils/languageMeta";
import { LanguageIcon } from "../../utils/languageIcon";
import {
  evaluatePluginRules,
  summarizeRuleEvals,
  type RuleEngineData,
  type PluginRuleEval,
  type RuleEvalSummary,
} from "../utils/ruleEngine";

/**
 * 能力摘要（R45：以后端真实能力为准）。
 * 前端 manifest.capabilities 仅是 UI 声明（历史：vue 声明 dependencyAnalysis 但后端无实现），
 * 这里优先用后端 ParserRegistry 能力矩阵（parserCapabilitiesByLang），
 * 后端查不到时回退到前端声明（未扫描/未连接场景）。
 */
function capabilitySummary(m: AnalyzerManifest, backend?: ParserCapability): string {
  const parts: string[] = [];
  if (backend) {
    if (backend.symbols) parts.push(t("pluginSel.capScan"));
    if (backend.deps) parts.push(t("pluginSel.capDeps"));
    if (backend.ast) parts.push(t("pluginSel.capAst"));
    if (parts.length === 0) parts.push(t("pluginSel.capLimited"));
    return parts.join(" · ");
  }
  // 回退：前端声明（未拿到后端能力时）
  if (m.capabilities.scanning) parts.push(t("pluginSel.capScan"));
  if (m.capabilities.dependencyAnalysis) parts.push(t("pluginSel.capDeps"));
  if (m.capabilities.rules) parts.push(t("pluginSel.capRules"));
  if (m.capabilities.rendering) parts.push(t("pluginSel.capRender"));
  return parts.join(" · ");
}

/** 语言别名归一化（插件 manifest.language ↔ project_files.language） */
function normalizeLang(lang: string): string {
  const l = lang.toLowerCase();
  if (l === "javascript" || l === "typescript") return "typescript";
  return l;
}

export function PluginSelector() {
  const active = useActiveAnalyzer();
  const toast = useToastStore((s) => s.success);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  // ─── 后端解析器真实能力矩阵（R45 前后端能力联动）───
  // 挂载时查询一次；查不到（非 Tauri 环境/命令未注册）时回退前端声明。
  const [backendCaps, setBackendCaps] = useState<Record<string, ParserCapability> | null>(null);
  useEffect(() => {
    let cancelled = false;
    projectScanApi
      .listParserCapabilities()
      .then((caps) => {
        if (cancelled) return;
        const byLang: Record<string, ParserCapability> = {};
        for (const c of caps) byLang[c.language] = c;
        setBackendCaps(byLang);
      })
      .catch(() => {
        /* 非 Tauri 环境：保持 null，回退前端声明 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── 当前分析的实时数据（插件 ↔ 分析联动）───
  const files = useProjectStore((s) => s.files);
  const symbols = useProjectStore((s) => s.symbols);
  const symbolRefs = useProjectStore((s) => s.symbolRefs);
  const findings = useProjectStore((s) => s.findings);
  const techDebt = useProjectStore((s) => s.techDebt);
  const focusLanguage = useProjectStore((s) => s.focusLanguage);
  const setFocusLanguage = useProjectStore((s) => s.setFocusLanguage);
  // ─── 插件规则执行引擎输入（ruleEngine）───
  const metrics = useProjectStore((s) => s.metrics);
  const modules = useProjectStore((s) => s.modules);
  const dependencies = useProjectStore((s) => s.dependencies);
  const layers = useProjectStore((s) => s.layers);
  const deadSymbols = useProjectStore((s) => s.deadSymbols);

  // 每个插件语言 → { files, symbols, refs, findings, techDebt } 统计
  //
  // 修复：findings 的 targetId 是 project_files.id（uuid），不是路径。
  // 原来直接 inferLang(targetId) 永远落到 "unknown"，导致菜单里
  // 每个插件的「N 发现」恒为 0。这里改为先按 id 查到文件再取语言。
  const statsByLang = useMemo(() => {
    type Stat = { files: number; symbols: number; refs: number; findings: number; techDebt: number };
    const map = new Map<string, Stat>();
    const bump = (lang: string, key: keyof Stat) => {
      const e = map.get(lang) ?? { files: 0, symbols: 0, refs: 0, findings: 0, techDebt: 0 };
      e[key] += 1;
      map.set(lang, e);
    };

    // 文件 id → 归一化语言：优先用扫描时写入的 language 字段，
    // 缺失时退回按扩展名推断（后端对少见扩展名会留空）
    const langByFileId = new Map<string, string>();
    files.forEach((f) => {
      if (f.isDirectory) return;
      const lang = f.language ? normalizeLang(f.language) : inferLang(f.relPath);
      langByFileId.set(f.id, lang);
      bump(lang, "files");
    });

    symbols.forEach((s) => bump(langByFileId.get(s.fileId) ?? inferLang(s.filePath || ""), "symbols"));
    symbolRefs.forEach((r) => bump(langByFileId.get(r.fromFileId) ?? inferLang(r.fromFilePath), "refs"));
    findings.forEach((fd) => {
      // 目标可能是文件、模块或符号；只有文件目标能归类到语言，
      // 其余归 unknown（不会污染各语言插件的计数）
      bump(langByFileId.get(fd.targetId) ?? "unknown", "findings");
    });
    techDebt.forEach((d) => bump(langByFileId.get(d.fileId) ?? inferLang(d.filePath), "techDebt"));

    return map;
  }, [files, symbols, symbolRefs, findings, techDebt]);

  // ─── 插件规则真实执行（§4.4 RuleRegistry → 可执行）───
  // 此前插件规则只是装饰性声明，从未运行；这里用已扫描数据逐条判定，
  // 每个插件显示「规则 N · 违规 M」，激活插件展开明细（每条规则的通过/违规数）。
  const engineData = useMemo<RuleEngineData>(
    () => ({
      files,
      fileMetrics: metrics,
      modules,
      deps: dependencies,
      layers,
      deadSymbols,
      findings,
    }),
    [files, metrics, modules, dependencies, layers, deadSymbols, findings]
  );
  const evalsByAnalyzer = useMemo(() => {
    const map = new Map<string, { evals: PluginRuleEval[]; summary: RuleEvalSummary }>();
    for (const m of analyzerRegistry.getAllAnalyzers()) {
      const evals = evaluatePluginRules(m, engineData);
      map.set(m.id, { evals, summary: summarizeRuleEvals(evals) });
    }
    return map;
  }, [engineData]);
  const activeEvals = active ? evalsByAnalyzer.get(active.id) : undefined;

  const handleOpen = (e: React.MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget);
  const handleClose = () => setAnchorEl(null);

  const handleSelect = (id: string, name: string, language: string) => {
    handleClose();
    if (analyzerRegistry.setActiveAnalyzer(id)) {
      // 插件 ↔ 分析数据联动：切换插件即切换语言焦点
      const lang = normalizeLang(language);
      setFocusLanguage(lang);
      const st = statsByLang.get(lang);
      const detail = st && st.files > 0
        ? t("pluginSel.analysisDetail", { files: st.files, symbols: st.symbols, refs: st.refs, findings: st.findings })
        : t("pluginSel.noLangData");
      toast(t("pluginSel.switched", { name: t(name), detail }));
    }
  };

  const analyzers = analyzerRegistry.getAllAnalyzers();

  return (
    <>
      <Tooltip title={t("pluginSel.tip")}>
        <Button
          size="small"
          onClick={handleOpen}
          startIcon={
            <Box
              component="span"
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                bgcolor: active ? languageColor(active.language) : "#64748b",
                flexShrink: 0,
              }}
            />
          }
          endIcon={<ExtensionIcon sx={{ fontSize: 13 }} />}
          sx={{
            textTransform: "none",
            fontSize: 11,
            minHeight: 24,
            py: 0,
            px: 1,
            color: "text.secondary",
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            "&:hover": { borderColor: "primary.main", color: "primary.main" },
          }}
        >
          {active ? (
            <>
              {t(active.name)}
              <Box component="span" sx={{ opacity: 0.65, ml: 0.5, fontSize: 10 }}>
                v{active.version}
              </Box>
            </>
          ) : (
            t("pluginSel.noAnalyzer")
          )}
        </Button>
      </Tooltip>

      {/* 语言焦点指示器：插件已联动时显示当前聚焦语言 + 清除按钮 */}
      {focusLanguage && active && (
        <Tooltip title={t("pluginSel.focusTip")}>
          <Chip
            size="small"
            icon={<FilterAltIcon sx={{ fontSize: 11 }} />}
            label={t("pluginSel.focus", { lang: focusLanguage })}
            onDelete={() => setFocusLanguage(null)}
            sx={{
              height: 22,
              fontSize: 10,
              ml: 0.5,
              bgcolor: `${languageColor(focusLanguage)}18`,
              color: languageColor(focusLanguage),
              "& .MuiChip-deleteIcon": { fontSize: 13, color: "inherit" },
            }}
          />
        </Tooltip>
      )}

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        slotProps={{ paper: { sx: { width: 400, maxHeight: 460, mt: 0.5 } } }}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {t("pluginSel.title", { n: analyzers.length })}
          </Typography>
        </Box>
        <Divider />
        {analyzers.length === 0 && (
          <MenuItem disabled>
            <Typography variant="body2" color="text.secondary">
              {t("pluginSel.noAnalyzers")}
            </Typography>
          </MenuItem>
        )}
        {analyzers.map((m) => {
          const isActive = m.id === active?.id;
          const lang = normalizeLang(m.language);
          const st = statsByLang.get(lang);
          const isFocused = focusLanguage === lang;
          return (
            <MenuItem
              key={m.id}
              onClick={() => handleSelect(m.id, m.name, m.language)}
              selected={isActive}
              dense
              sx={{ py: 1 }}
            >
              <ListItemIcon>
                <LanguageIcon lang={m.language} size={28} />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                    <Typography variant="body2" sx={{ fontWeight: isActive ? 600 : 400 }}>
                      {t(m.name)}
                    </Typography>
                    <Chip
                      label={m.language}
                      size="small"
                      sx={{ height: 16, fontSize: 9, "& .MuiChip-label": { px: 0.75 } }}
                    />
                    {isFocused && (
                      <Chip
                        label={t("pluginSel.focused")}
                        size="small"
                        sx={{
                          height: 15,
                          fontSize: 9,
                          bgcolor: `${languageColor(m.language)}22`,
                          color: languageColor(m.language),
                          "& .MuiChip-label": { px: 0.5 },
                        }}
                      />
                    )}
                  </Box>
                }
                secondary={
                  <Box component="span" sx={{ display: "block", mt: 0.25 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                      v{m.version} · {capabilitySummary(m, backendCaps?.[normalizeLang(m.language)])}
                    </Typography>
                    {st && st.files > 0 && (
                      <Box
                        component="span"
                        sx={{
                          display: "block",
                          color: "primary.main",
                          fontSize: 10,
                          fontWeight: 500,
                          mt: 0.25,
                        }}
                      >
                        {t("pluginSel.analysisStats", { files: st.files, symbols: st.symbols, refs: st.refs, findings: st.findings, debt: st.techDebt })}
                      </Box>
                    )}
                    <Box component="span" sx={{ display: "block", color: "text.disabled", fontSize: 10 }}>
                      {t("pluginSel.templateStats", { e: m.entityTypes.length, v: m.viewTemplates.length, l: m.layerTypes.length, r: m.rules.length })}
                    </Box>
                    {(() => {
                      const rs = evalsByAnalyzer.get(m.id)?.summary;
                      if (!rs) return null;
                      return (
                        <Box
                          component="span"
                          sx={{
                            display: "block",
                            fontSize: 10,
                            mt: 0.25,
                            color:
                              rs.violationCount > 0
                                ? rs.failingRules > 0
                                  ? "#f97316"
                                  : "#eab308"
                                : "#22c55e",
                            fontWeight: 500,
                          }}
                        >
                          {rs.violationCount > 0
                            ? t("pluginSel.rulesViolation", { e: rs.executed, t: rs.total, n: rs.violationCount, f: rs.failingRules })
                            : t("pluginSel.rulesClean", { e: rs.executed, t: rs.total })}
                          {rs.unsupported > 0 ? t("pluginSel.rulesUnsupported", { n: rs.unsupported }) : ""}
                        </Box>
                      );
                    })()}
                  </Box>
                }
              />
              {isActive && (
                <ListItemIcon sx={{ justifyContent: "flex-end", minWidth: 28 }}>
                  <CheckIcon sx={{ fontSize: 16, color: "primary.main" }} />
                </ListItemIcon>
              )}
            </MenuItem>
          );
        })}
        {activeEvals && activeEvals.evals.length > 0 && (
          <>
            <Divider />
            <Box sx={{ px: 2, py: 1 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 0.5 }}
              >
                <FactCheckIcon sx={{ fontSize: 13 }} />
                {t("pluginSel.rulesDetail", { name: active?.name ?? t("pluginSel.plugin") })}
              </Typography>
              <Box sx={{ mt: 0.5, display: "flex", flexDirection: "column", gap: 0.35 }}>
                {activeEvals.evals.map((e) => {
                  const n = e.violations.length;
                  const color = !e.supported ? "#94a3b8" : n > 0 ? "#f97316" : "#22c55e";
                  return (
                    <Box key={e.rule.id} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                      <Chip
                        size="small"
                        label={!e.supported ? t("pluginSel.unsupported") : n > 0 ? t("pluginSel.violations", { n }) : t("pluginSel.passed")}
                        sx={{
                          height: 16,
                          minWidth: 52,
                          fontSize: 9,
                          bgcolor: `${color}18`,
                          color,
                          "& .MuiChip-label": { px: 0.5 },
                          flexShrink: 0,
                        }}
                      />
                      <Tooltip
                        title={e.unsupportedReason ?? (n > 0 ? e.violations.slice(0, 3).map((v) => v.detail).join("；") : t("pluginSel.noViolation"))}
                        placement="left"
                      >
                        <Typography variant="caption" noWrap sx={{ fontSize: 10, color: "text.secondary" }}>
                          {t(e.rule.name)}
                          {!e.supported ? t("pluginSel.needsAst") : ""}
                        </Typography>
                      </Tooltip>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </>
        )}
        <Divider />
        <Box sx={{ px: 2, py: 0.75 }}>
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>
            {t("pluginSel.footer")}
          </Typography>
        </Box>
      </Menu>
    </>
  );
}

/** 从路径推断语言（插件语言 ↔ 文件数据匹配） */
function inferLang(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".ts") || p.endsWith(".tsx")) return "typescript";
  if (p.endsWith(".js") || p.endsWith(".jsx")) return "javascript";
  if (p.endsWith(".vue")) return "vue";
  if (p.endsWith(".rs")) return "rust";
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".go")) return "go";
  if (p.endsWith(".java")) return "java";
  if (p.endsWith(".kt") || p.endsWith(".kts")) return "kotlin";
  if (p.endsWith(".c") || p.endsWith(".cpp") || p.endsWith(".cc") || p.endsWith(".cxx") || p.endsWith(".h") || p.endsWith(".hpp")) return "c/c++";
  if (p.endsWith(".php")) return "php";
  return "unknown";
}
