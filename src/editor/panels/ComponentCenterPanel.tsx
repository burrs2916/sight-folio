// sight-folio: 左面板 - 实体实例 + 扫描文件 + 分析器插件
// 实体 Tab 从「静态实体类型」升级为「分析实例联动」：
//   - 模块（project_modules）→ 点击在画布定位
//   - 符号（project_symbols，类/函数/接口/结构体/枚举）→ 点击定位到源文件实体
//   - 审查发现（findings）→ 点击定位到目标文件实体
//   - 实体类型（可拖拽模板）保留为底部折叠组，不丢失拖拽能力
import { useState, useMemo, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import DescriptionIcon from '@mui/icons-material/Description';
import FolderIcon from '@mui/icons-material/Folder';
import InventoryIcon from '@mui/icons-material/Inventory2';
import LinkIcon from '@mui/icons-material/Link';
import LayersIcon from '@mui/icons-material/Layers';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import CodeIcon from '@mui/icons-material/Code';
import ExtensionIcon from '@mui/icons-material/Extension';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import DataObjectIcon from '@mui/icons-material/DataObject';
import FunctionsIcon from '@mui/icons-material/Functions';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import RuleIcon from '@mui/icons-material/Rule';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import CallMadeIcon from '@mui/icons-material/CallMade';
import BuildIcon from '@mui/icons-material/Build';
import BlockIcon from '@mui/icons-material/Block';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import PersonIcon from '@mui/icons-material/Person';
import PublicIcon from '@mui/icons-material/Public';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { WritingEntitiesTab } from './WritingLeftTabs';
import { WritingStructureTreeTab } from './WritingTreeTab';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import InputBase from '@mui/material/InputBase';
import { componentRegistry } from '../registry';
import { ScannedFilesPanel } from './ScannedFilesPanel';
import { CanvasLayerPanel } from './CanvasLayerPanel';
import { ProjectTree } from './ProjectTree';
import { buildFileTree, countTree } from '../utils/fileTree';
import { isImageFile } from '../utils/fileKind';
import { buildImagePreviewData, getCachedProjectRoot } from '../utils/imageAsset';
import { VirtualRows } from './VirtualRows';
import { tokenizeQuery, filterByTokens, countLabel } from '../utils/virtualList';
import { useToastStore } from '../../store/toastStore';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { findComponentForFile, highlightInCanvas, findNearestDirComponent } from '../utils/canvasLink';
import { rerenderDirectoryTree, runPortrait } from '../utils/portraits';
import { useSceneStore } from '../../store/sceneStore';
import { navigateToSource, navigateToSourceByPath, navigateToModule } from '../utils/sourceNavigate';
import { groupRefsBySymbol } from '../utils/symbolRefs';
import type { ProjectSymbolRef, ChangeCoupling } from '../../services/tauri';
import type { SceneComponent, LayerNode } from '../../types/editor';
import { t, resolveFragments } from '../../i18n';

const PANEL_WIDTH = 200;
const PANEL_COLLAPSED_WIDTH = 40;

/**
 * 虚拟列表里的统一行高（px）。
 * 定高是虚拟滚动的前提；取 34 是「11px 标题 + 9px 副标题 + 上下留白」的实测值，
 * 改动这里必须同步确认行内不会被裁切。
 */
const INSTANCE_ROW_H = 34;

const SYMBOL_KIND_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  class: { label: 'class', color: '#EC4899', icon: <ViewModuleIcon sx={{ fontSize: 12 }} /> },
  function: { label: 'function', color: '#06B6D4', icon: <FunctionsIcon sx={{ fontSize: 12 }} /> },
  interface: { label: 'interface', color: '#8B5CF6', icon: <DataObjectIcon sx={{ fontSize: 12 }} /> },
  struct: { label: 'struct', color: '#F59E0B', icon: <ViewModuleIcon sx={{ fontSize: 12 }} /> },
  enum: { label: 'enum', color: '#10B981', icon: <DataObjectIcon sx={{ fontSize: 12 }} /> },
  trait: { label: 'trait', color: '#14B8A6', icon: <DataObjectIcon sx={{ fontSize: 12 }} /> },
  type_alias: { label: 'type_alias', color: '#94A3B8', icon: <DataObjectIcon sx={{ fontSize: 12 }} /> },
  module: { label: 'module', color: '#6366F1', icon: <InventoryIcon sx={{ fontSize: 12 }} /> },
  const: { label: 'const', color: '#64748B', icon: <DataObjectIcon sx={{ fontSize: 12 }} /> },
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#E24B4A',
  warning: '#EF9F27',
  info: '#378ADD',
};
const SEVERITY_LABELS: Record<string, string> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
};

/** 符号类型名（跟随 UI 语言；未知类型回退原始 kind） */
function symbolKindLabel(kind: string): string {
  const v = t(`leftPanel.symbolKind.${kind}`);
  return v && !v.startsWith('leftPanel.symbolKind.') ? v : kind;
}
/** 严重度名（跟随 UI 语言；未知回退原始值） */
function severityLabel(sev: string): string {
  const v = t(`leftPanel.sev.${sev}`);
  return v && !v.startsWith('leftPanel.sev.') ? v : sev;
}
/** 技术债标记名（跟随 UI 语言；未知回退原始标记） */
function markerLabel(marker: string): string {
  const v = t(`leftPanel.marker.${marker}`);
  return v && !v.startsWith('leftPanel.marker.') ? v : marker;
}

/** 分组标题（带折叠箭头 + 计数） */
function GroupHeader({
  icon,
  label,
  count,
  open,
  onToggle,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  /** 数字，或搜索状态下的「命中/总数」文案（countLabel 产出） */
  count: number | string;
  open: boolean;
  onToggle: () => void;
  color?: string;
}) {
  return (
    <Box
      onClick={onToggle}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1,
        py: 0.5,
        cursor: 'pointer',
        borderRadius: 0.5,
        '&:hover': { backgroundColor: 'action.hover' },
      }}
    >
      <Box sx={{ color: color || 'text.secondary', display: 'flex', alignItems: 'center' }}>{icon}</Box>
      <Typography variant="caption" sx={{ flex: 1, fontWeight: 600, fontSize: 11 }}>
        {label}
      </Typography>
      <Chip label={count} size="small" sx={{ height: 15, fontSize: 9, '& .MuiChip-label': { px: 0.5 } }} />
      {open ? (
        <ExpandLessIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
      ) : (
        <ExpandMoreIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
      )}
    </Box>
  );
}

/** 单行实例条目 */
function InstanceRow({
  onClick,
  icon,
  title,
  subtitle,
  badge,
  badgeColor,
  height,
}: {
  onClick: () => void;
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  badgeColor?: string;
  /**
   * 固定行高（px）。仅虚拟列表里需要 —— 虚拟滚动的算术前提是「每行等高」，
   * 内容自适应高度会让滚动条长度和实际内容对不上（滚到底还剩半屏）。
   * 不传则保持原有的内容自适应高度，普通分组视觉零变化。
   */
  height?: number;
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: height ? 0 : 0.35,
        ...(height ? { height, boxSizing: 'border-box' } : null),
        cursor: 'pointer',
        borderRadius: 0.5,
        '&:hover': { backgroundColor: 'action.hover' },
      }}
      title={typeof title === 'string' ? title : undefined}
    >
      {icon && (
        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: badgeColor || 'text.disabled' }}>
          {icon}
        </Box>
      )}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            fontSize: 11,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </Typography>
        {subtitle && (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              fontSize: 9,
              color: 'text.secondary',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>
      {badge}
    </Box>
  );
}

/** 实体实例 Tab：模块 / 符号 / 审查发现（与分析数据联动） */
function EntityInstancesTab() {
  const files = useProjectStore((s) => s.files);
  const modules = useProjectStore((s) => s.modules);
  const symbols = useProjectStore((s) => s.symbols);
  const findings = useProjectStore((s) => s.findings);
  const structureSummary = useProjectStore((s) => s.structureSummary);
  const symbolRefs = useProjectStore((s) => s.symbolRefs);
  const metrics = useProjectStore((s) => s.metrics);
  const techDebt = useProjectStore((s) => s.techDebt);
  const deadSymbols = useProjectStore((s) => s.deadSymbols);
  const clones = useProjectStore((s) => s.clones);
  const changeCoupling = useProjectStore((s) => s.changeCoupling);
  const focusLanguage = useProjectStore((s) => s.focusLanguage);
  const showToast = useToastStore((s) => s.showToast);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    tree: true,
    symbols: true,
    findings: true,
    techDebt: true,
    dead: true,
    clones: true,
    coupling: true,
    types: false,
  });
  const toggleGroup = (key: string) => setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  // ══════════════════════════════════════════════════════════════
  // 面板搜索（R32）
  //
  // 此前每个分组都是 `slice(0, 40)` 硬截断：库里 3800 条审查发现只露 40 条，
  // 剩下的既翻不到也搜不着 —— 这正是「左侧面板是死的」的实感来源。
  // 搜索 + 虚拟滚动是一对：搜索让数据可达，虚拟滚动让放开截断后不卡。
  // ══════════════════════════════════════════════════════════════
  const [query, setQuery] = useState('');
  const tokens = useMemo(() => tokenizeQuery(query), [query]);
  const filtering = tokens.length > 0;

  // ─── 展开的符号引用列表（点击符号行展开/收起）───
  const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(new Set());
  const toggleSymbolRefs = (symbolId: string) =>
    setExpandedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(symbolId)) next.delete(symbolId);
      else next.add(symbolId);
      return next;
    });

  const fileCount = files.filter((f) => !f.isDirectory).length;
  const totalSymbols = structureSummary?.totalSymbols ?? symbols.length;

  // 复杂度高风险文件数（高/极高，复杂度热力图统计）
  const highComplexity = metrics.filter((m) => m.complexityLevel === 'high' || m.complexityLevel === 'extreme').length;

  // ─── 语言焦点过滤（插件联动：切换插件后按该语言展示分析数据）───
  const isLangMatch = (path: string) => {
    if (!focusLanguage) return true;
    const ext = path.toLowerCase().split('.').pop() || '';
    if (focusLanguage === 'typescript') return ['ts', 'tsx', 'js', 'jsx'].includes(ext);
    if (focusLanguage === 'rust') return ext === 'rs';
    if (focusLanguage === 'python') return ext === 'py';
    if (focusLanguage === 'go') return ext === 'go';
    if (focusLanguage === 'java') return ext === 'java';
    return true;
  };
  const fileIdToLangMatch = useMemo(() => {
    const map = new Map<string, boolean>();
    files.forEach((f) => map.set(f.id, isLangMatch(f.relPath)));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, focusLanguage]);
  const visibleFiles = useMemo(
    () => (focusLanguage ? files.filter((f) => fileIdToLangMatch.get(f.id)) : files),
    [files, focusLanguage, fileIdToLangMatch],
  );
  const visibleModules = useMemo(() => {
    if (!focusLanguage) return modules;
    // 修复：旧实现用 `f.metadata.includes(m.id)` 关联模块与文件，
    // 但模块 id 是每次 detect 重新生成的随机 uuid，不会出现在文件 metadata 里，
    // 匹配结果恒为空数组 → 走 `modFiles.length === 0` 短路，过滤形同虚设。
    // 改用项目既定口径：模块名 = 顶层目录名（与画布 ModuleRenderer、
    // syncToCanvas、SVG 报告生成器三处保持一致）。
    return modules.filter((m) => {
      const modFiles = files.filter((f) => !f.isDirectory && f.relPath.split('/')[0] === m.name);
      if (modFiles.length === 0) return false; // 没有文件的模块在语言聚焦下没有展示价值
      return modFiles.some((f) => fileIdToLangMatch.get(f.id));
    });
  }, [modules, focusLanguage, files, fileIdToLangMatch]);
  const visibleSymbols = useMemo(
    () => (focusLanguage ? symbols.filter((s) => isLangMatch(s.filePath)) : symbols),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbols, focusLanguage],
  );
  const visibleFindings = useMemo(
    () => (focusLanguage ? findings.filter((f) => f.targetId && fileIdToLangMatch.get(f.targetId)) : findings),
    [findings, focusLanguage, fileIdToLangMatch],
  );
  const visibleTechDebt = useMemo(
    () => (focusLanguage ? techDebt.filter((d) => isLangMatch(d.filePath)) : techDebt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [techDebt, focusLanguage],
  );
  const visibleDeadSymbols = useMemo(
    () => (focusLanguage ? deadSymbols.filter((d) => isLangMatch(d.filePath)) : deadSymbols),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deadSymbols, focusLanguage],
  );
  // 死符号 ID 集合（用于符号行「未引用」灰标）
  const deadSymbolIds = useMemo(() => new Set(visibleDeadSymbols.map((d) => d.symbolId)), [visibleDeadSymbols]);
  const visibleClones = useMemo(
    () => (focusLanguage ? clones.filter((c) => isLangMatch(c.filePath)) : clones),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clones, focusLanguage],
  );
  // 变更耦合（无静态依赖却总一起改 → 隐藏的跨模块架构耦合）
  const visibleCoupling = useMemo(
    () =>
      focusLanguage
        ? changeCoupling.filter((c) => isLangMatch(c.fileAPath) || isLangMatch(c.fileBPath))
        : changeCoupling,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [changeCoupling, focusLanguage],
  );
  const hiddenCouplingCount = visibleCoupling.filter((c) => c.couplingKind === 'hidden').length;
  const crossModuleCount = visibleCoupling.filter((c) => c.crossModule).length;

  // ══════════════════════════════════════════════════════════════
  // 搜索命中集合（visible* = 语言聚焦后的「总量」，shown* = 再过一遍搜索）
  //
  // 分成两层是为了让组头能显示「命中/总数」：只有一层的话，搜索时用户会
  // 以为数据变少了。字段选择的原则是「用户脑子里会拿来搜的东西」——
  // 名字、路径、消息文本、严重度标签，而不是 uuid 之类的内部字段。
  // ══════════════════════════════════════════════════════════════
  const shownModules = useMemo(
    () => filterByTokens(visibleModules, tokens, (m) => [m.name, m.description]),
    [visibleModules, tokens],
  );
  const shownSymbols = useMemo(
    () => filterByTokens(visibleSymbols, tokens, (s) => [s.name, s.filePath, s.kind, s.signature]),
    [visibleSymbols, tokens],
  );
  const shownFindings = useMemo(
    () =>
      filterByTokens(visibleFindings, tokens, (f) => [
        f.message,
        f.suggestion,
        f.severity,
        SEVERITY_LABELS[f.severity],
        files.find((x) => x.id === f.targetId)?.relPath,
      ]),
    [visibleFindings, tokens, files],
  );
  const shownTechDebt = useMemo(
    () => filterByTokens(visibleTechDebt, tokens, (d) => [d.marker, d.snippet, d.filePath]),
    [visibleTechDebt, tokens],
  );
  const shownDeadSymbols = useMemo(
    () => filterByTokens(visibleDeadSymbols, tokens, (d) => [d.name, d.filePath, d.kind, d.reason]),
    [visibleDeadSymbols, tokens],
  );
  const shownClones = useMemo(
    () => filterByTokens(visibleClones, tokens, (c) => [c.filePath, c.snippet, c.cloneType]),
    [visibleClones, tokens],
  );
  const shownCoupling = useMemo(
    () => filterByTokens(visibleCoupling, tokens, (c) => [c.fileAPath, c.fileBPath, c.couplingKind, c.riskLevel]),
    [visibleCoupling, tokens],
  );

  /**
   * 搜索命中 → 画布批量高亮。
   *
   * 这是「面板不只是列表、画布不只是画像」的兑现点：面板里搜 auth，
   * 画布上所有 auth 相关实体同时点亮并被框进视野，两边共享同一份分析数据。
   */
  const handleHighlightMatches = () => {
    const filePaths = new Set<string>();
    shownSymbols.forEach((s) => filePaths.add(s.filePath));
    shownTechDebt.forEach((d) => filePaths.add(d.filePath));
    shownDeadSymbols.forEach((d) => filePaths.add(d.filePath));
    shownClones.forEach((c) => filePaths.add(c.filePath));
    shownCoupling.forEach((c) => {
      filePaths.add(c.fileAPath);
      filePaths.add(c.fileBPath);
    });
    shownFindings.forEach((f) => {
      const file = files.find((x) => x.id === f.targetId);
      if (file) filePaths.add(file.relPath);
    });
    const moduleNames = shownModules.map((m) => m.name);
    const n = highlightInCanvas({ filePaths: [...filePaths], moduleNames });
    if (n === 0) {
      showToast(t('leftPanel.highlightNotSynced'), 'warning');
    } else {
      showToast(t('leftPanel.highlighted', { n }), 'success');
    }
  };

  // ─── 符号 → 引用点索引（被 import 引用，去重）───
  const refsBySymbol = useMemo(() => groupRefsBySymbol(symbolRefs), [symbolRefs]);

  // 被引用总数（文件级引用也算，用于统计条）
  const totalRefs = symbolRefs.length;

  // ─── 技术债按标记类型分组 ───
  // 分组行是「可展开」结构（不定高），无法直接套定高虚拟列表，
  // 因此保留分组内上限，但上限随搜索放大（搜索过的结果集本身已经很小），
  // 并在组尾显式告诉用户「还有多少条、怎么看到它们」——
  // 悄无声息地截断才是把面板做死的根源。
  const TECH_DEBT_CAP = filtering ? 300 : 30;
  const techDebtGroups = useMemo(() => {
    const groups = new Map<string, { list: typeof techDebt; total: number }>();
    for (const d of shownTechDebt) {
      const g = groups.get(d.marker) || { list: [] as typeof techDebt, total: 0 };
      g.total += 1;
      if (g.list.length < TECH_DEBT_CAP) g.list.push(d);
      groups.set(d.marker, g);
    }
    const order = ['FIXME', 'HACK', 'DEPRECATED', 'OPTIMIZE', 'TODO', 'XXX'];
    return Array.from(groups.entries()).sort(
      (a, b) =>
        (order.indexOf(a[0]) === -1 ? 99 : order.indexOf(a[0])) -
        (order.indexOf(b[0]) === -1 ? 99 : order.indexOf(b[0])),
    );
  }, [shownTechDebt, TECH_DEBT_CAP]);

  // ─── 符号按类型分组 ───
  // 符号行支持「点击展开引用点」，展开后高度可变，同样不套定高虚拟列表。
  const SYMBOL_CAP = filtering ? 300 : 40;
  const symbolGroups = useMemo(() => {
    const groups = new Map<string, { list: typeof symbols; total: number }>();
    for (const s of shownSymbols) {
      const g = groups.get(s.kind) || { list: [] as typeof symbols, total: 0 };
      g.total += 1;
      if (g.list.length < SYMBOL_CAP) g.list.push(s);
      groups.set(s.kind, g);
    }
    const order = ['class', 'function', 'interface', 'struct', 'enum', 'trait', 'type_alias', 'module', 'const'];
    const entries = Array.from(groups.entries()).sort(
      (a, b) =>
        (order.indexOf(a[0]) === -1 ? 99 : order.indexOf(a[0])) -
        (order.indexOf(b[0]) === -1 ? 99 : order.indexOf(b[0])),
    );
    return entries;
  }, [shownSymbols, SYMBOL_CAP]);

  // ─── 重复代码按克隆组聚合（同一段代码的所有副本聚在一起）───
  //
  // 排序用「重复行数 × (实例数-1)」即**可消除的冗余行数**，而不是单看行数或副本数：
  // 一段 40 行代码复制 2 份（浪费 40 行）比一段 10 行代码复制 5 份（浪费 40 行）
  // 严重程度相当，这个口径能把它们排在一起，避免只按行数排时小而多的克隆被埋没。
  const cloneGroups = useMemo(() => {
    const groups = new Map<string, typeof clones>();
    for (const c of shownClones) {
      const arr = groups.get(c.groupId) || [];
      arr.push(c);
      groups.set(c.groupId, arr);
    }
    return Array.from(groups.entries())
      .map(([gid, list]) => {
        const sorted = [...list].sort((a, b) => b.lineCount - a.lineCount);
        const lines = sorted[0]?.lineCount ?? 0;
        return { gid, list: sorted, lines, waste: lines * Math.max(0, sorted.length - 1) };
      })
      .sort((a, b) => b.waste - a.waste || b.list.length - a.list.length)
      .slice(0, filtering ? 200 : 40);
  }, [shownClones, filtering]);

  /** 可消除的冗余行数合计（重复代码的「账单」总额） */
  const totalWaste = useMemo(() => cloneGroups.reduce((acc, g) => acc + g.waste, 0), [cloneGroups]);

  // ══════════════════════════════════════════════════════════════════
  // 点击语义（本次重构）
  //
  // 旧行为：每个 handler 都只做"画布定位"，画布没同步就弹 warning 结束 ——
  // 用户刚扫描完点任何一行都是这句 warning，等同于面板是死的。
  // 新行为：主动作 = 打开源码并跳到那一行；画布上有实体就顺带联动定位。
  // ══════════════════════════════════════════════════════════════════

  // ─── 符号点击：有引用点 → 展开引用列表；无引用 → 打开源码定位到定义行 ───
  const handleSymbolClick = (filePath: string, symbolName: string, symbolId: string) => {
    const refs = refsBySymbol.get(symbolId);
    if (refs && refs.length > 0) {
      toggleSymbolRefs(symbolId);
      return;
    }
    const sym = symbols.find((s) => s.id === symbolId);
    const r = navigateToSourceByPath(
      filePath,
      sym?.lineStart ?? null,
      t('leftPanel.symbolOpen', { kind: symbolKindLabel(sym?.kind ?? 'symbol'), name: symbolName }),
    );
    if (!r.opened) showToast(r.message, 'warning');
  };

  // ─── 引用点点击：打开引用方文件并定位到引用那一行 ───
  const handleRefClick = (r: ProjectSymbolRef) => {
    const res = navigateToSourceByPath(
      r.fromFilePath,
      r.refLine || null,
      t('leftPanel.refOpen', { name: r.symbolName, text: r.refText ? ` · ${r.refText.slice(0, 60)}` : '' }),
    );
    if (!res.opened) showToast(res.message, 'warning');
  };

  // ─── 审查发现点击：打开目标文件并定位到违规行 ───
  const handleFindingClick = (f: (typeof findings)[number]) => {
    const file = files.find((x) => x.id === f.targetId);
    if (file) {
      const res = navigateToSource(file.id, null, t('leftPanel.reviewOpen', { msg: f.message }));
      if (!res.opened) showToast(res.message, 'warning');
      return;
    }
    // 目标可能是模块（规则引擎的 graph 类规则以模块为目标）
    const mod = modules.find((m) => m.id === f.targetId);
    if (mod) {
      const r = navigateToModule(mod.name);
      if (!r.opened && !r.focusedCanvas) showToast(r.message, 'warning');
      else if (!r.opened) showToast(r.message, 'info');
      return;
    }
    showToast(t('leftPanel.reviewNotTarget', { msg: f.message }), 'info');
  };

  // ─── 技术债点击：打开源码并定位到标记行 ───
  const handleTechDebtClick = (d: (typeof techDebt)[number]) => {
    const label = markerLabel(d.marker);
    const res = navigateToSource(d.fileId, d.lineNo, `${label} · ${d.snippet.trim().slice(0, 60)}`);
    if (!res.opened) showToast(res.message, 'warning');
  };

  // ─── 死代码点击：打开源码并定位到符号定义处 ───
  const handleDeadClick = (d: (typeof deadSymbols)[number]) => {
    const res = navigateToSource(d.fileId, d.lineStart, t('leftPanel.deadOpen', { name: d.name, reason: d.reason }));
    if (!res.opened) showToast(res.message, 'warning');
  };

  // ─── 重复代码点击：打开源码定位到片段起始行，沟槽标出同组其它副本位置 ───
  const handleCloneClick = (c: (typeof clones)[number], siblings: typeof clones) => {
    const others = siblings
      .filter((s) => s.id !== c.id)
      .slice(0, 5)
      .map((s) => `${s.filePath.split('/').pop()}:${s.startLine}`)
      .join('、');
    const res = navigateToSource(
      c.fileId,
      c.startLine,
      t('leftPanel.cloneOpen', {
        lines: c.lineCount,
        others: others ? t('leftPanel.cloneOthers', { others }) : '',
      }),
      // 只标本文件内的克隆区间：起止两行都标，方便看清片段边界
      [
        { line: c.startLine, label: t('leftPanel.cloneStart', { lines: c.lineCount }), severity: 'info' as const },
        { line: c.endLine, label: t('leftPanel.cloneEnd'), severity: 'info' as const },
      ],
    );
    if (!res.opened) showToast(res.message, 'warning');
  };

  // ─── 变更耦合点击：双向定位两个文件实体（揭示"无依赖却总一起改"的隐式耦合）───
  const handleCouplingClick = (c: ChangeCoupling) => {
    const editor = useEditorStore.getState();
    const sid = useSceneStore.getState().activeSceneId;
    // v2.18：在变更耦合视图下点击耦合项 → 把 fileA 设为焦点 + 重画焦点子图（与 dep 入口对称）；
    // 其它视图保持原行为（focusComponent + 打开 fileA 源码），不污染画布语义。
    const isCouplingView = (() => {
      const viewName = editor.activeViewId ? (editor.views.find((v) => v.id === editor.activeViewId)?.name ?? '') : '';
      const label = t('editorPage.portrait.changeCoupling.label');
      return viewName === label || viewName.startsWith(`${label} `);
    })();
    if (isCouplingView && sid) {
      void (async () => {
        useEditorStore.getState().setCouplingFocusFileId(c.fileAId);
        const out = await runPortrait('changeCoupling', sid, { focusFileId: c.fileAId });
        useToastStore.getState().showToast(out.message, out.severity);
      })();
      return;
    }
    const fileA = files.find((f) => f.id === c.fileAId);
    const fileB = files.find((f) => f.id === c.fileBId);
    if (fileA) {
      const a = findComponentForFile(fileA);
      if (a) editor.focusComponent(a.id);
    }
    if (fileB) {
      const b = findComponentForFile(fileB);
      if (b) editor.focusComponent(b.id);
    }
    const res = navigateToSource(
      c.fileAId,
      null,
      t('leftPanel.couplingOpen', {
        file: c.fileBPath.split('/').pop() || '',
        n: c.coChanges,
        cross: c.crossModule ? t('leftPanel.couplingCross') : '',
        kind: c.couplingKind === 'hidden' ? t('leftPanel.couplingHidden') : t('leftPanel.couplingStruct'),
      }),
    );
    if (!res.opened) showToast(res.message, 'warning');
  };

  // ─── 项目树（替代原「模块」平铺组）───
  // 目录树按 parent_id 递归构建（与文件 tab 同源，utils/fileTree.ts），任意层级缩进、
  // 可展开/收起。语言焦点过滤沿用 visibleFiles（含祖先目录保留）。
  const treeRoots = useMemo(() => buildFileTree(visibleFiles), [visibleFiles]);
  const treeCount = useMemo(() => countTree(treeRoots), [treeRoots]);

  // ─── 目录树双击定位：完整回退链，树上任何节点双击都有反馈 ───
  //
  // 背景（「文件无法定位」根因）：default 视图的内容取决于最后一条流水线 ——
  //   「同步到画布」(buildTreeLayout) 会把全部文件画成实体；
  //   「目录画像」(rerenderDirectoryTree) 默认 showFiles=false 只画目录实体，
  //   且有 每目录 20 / 全树 600 的文件上限、深目录截断 —— 文件实体根本不在画布上。
  // 此前查不到就静默返回，观感即「目录正常、文件定位不了」。
  const focusDirEntity = (anc: SceneComponent, requestedName: string) => {
    useEditorStore.getState().focusComponent(anc.id);
    showToast(
      t('leftPanel.locateFallbackAncestor', {
        name: requestedName,
        dir: String((anc.config as Record<string, unknown> | undefined)?.dirPath ?? '/'),
      }),
      'info',
    );
  };

  // 目录行双击：精确匹配 dirPath → （default 视图画布为空时重画目录树再试一次）
  // → 回退最近的已渲染父目录（深目录可能被截断）→ 无可定位实体时明确告警。
  const handleTreeDirFocus = async (node: { id: string; relPath: string }) => {
    let comp = useEditorStore.getState().components.find((c) => c.config?.dirPath === node.relPath);
    if (!comp) {
      const est = useEditorStore.getState();
      const sid = useSceneStore.getState().activeSceneId;
      // 画布还是空的（未同步/新建分析）：直接画目录树再定位，双击即「有反应」
      if (est.activeViewId === 'default' && est.components.length === 0 && sid) {
        const out = await rerenderDirectoryTree(sid);
        if (!out.ok) showToast(out.message, out.severity);
        comp = useEditorStore.getState().components.find((c) => c.config?.dirPath === node.relPath);
      }
    }
    if (comp) {
      useEditorStore.getState().focusComponent(comp.id);
      return;
    }
    const anc = findNearestDirComponent(node.relPath);
    if (anc) {
      focusDirEntity(anc, node.relPath);
      return;
    }
    showToast(t('leftPanel.locateMissing', { name: node.relPath }), 'warning');
  };

  // 文件行双击（实体 tab）：只做「画布联动」—— 聚焦对应画布实体，绝不在此打开源码。
  // 与文件 tab（ScannedFilesPanel）分工：那里双击才打开源码；实体视图专注「实体↔画布」联动。
  // 回退链：精确匹配 fileId（=ProjectFile.id=树节点 id，最稳）→ filePath →
  // （default 视图未开文件叶子：自动开启 showFiles + 重画目录树再试）→
  // 回退最近的已渲染父目录（目录画像文件上限：每目录 20 / 全树 600）→ 告警/图片预览。
  const handleTreeFileClick = async (node: { id: string; relPath: string; name: string }) => {
    const est = useEditorStore.getState();
    const sid = useSceneStore.getState().activeSceneId;
    // 双击文件 = 在代码工作台打开源码。此前 handleTreeFileClick 只做画布联动（定位画布实体 /
    // 最近目录），从不打开编辑器，导致 md 等无画布实体的文件「双击啥都不开」。
    // 改用与右键「打开源码」、画布实体双击同源的 navigateToSource：双击即在代码工作台打开；
    // 下方画布联动逻辑原样保留，二者不冲突（navigateToSource 内部也会 tryFocusCanvasFile）。
    const openRes = navigateToSource(node.id);
    if (!openRes.opened && openRes.message) showToast(openRes.message, 'warning');
    // v2.17 依赖画像「保留全图·就地高亮」：点左侧项目树任意文件 → 在当前【完整】依赖图里
    // 选中该文件，点亮它的 1 跳依赖邻居（节点+边）、其余淡化但保留在画布上 —— 绝不重绘 /
    // 清掉其它节点（之前的「焦点子图」整张图重绘成只有该文件+邻居，观感即「其它节点全消失」）。
    // 若当前仍处于焦点子图（画布只有少数节点），先恢复全局总览再就地高亮。
    // 判定用 components 里是否有 portraitMode==="dependency" 的实体，与 SceneEditor 一致，
    // 不依赖 i18n 视图名，语言切换不会失效。
    if (
      sid &&
      est.components.some((c) => (c.config as Record<string, unknown> | undefined)?.portraitMode === 'dependency')
    ) {
      const targetComp = useEditorStore
        .getState()
        .components.find((c) => (c.config as Record<string, unknown> | undefined)?.fileId === node.id);
      if (targetComp) {
        // 已在 top-90 采样画布上 → 就地高亮 + 居中（保留全图，不重绘、不丢图）；
        // 视图保持当前缩放，整张依赖图仍在画布上，仅该节点的 1 跳邻居被强调。
        useEditorStore.getState().focusComponent(targetComp.id);
        useToastStore.getState().showToast(t('leftPanel.locateFocusHighlight', { name: node.name }), 'info');
      } else {
        // 盲区：文件不在 top-90 采样画布上（低度数文件 / 大项目绝大多数文件）。
        // 保留全局图 + 并入该文件的 1 跳邻域并高亮（焦点文件描环），全局依赖关系
        // 永不消失；工具条出现「焦点 / 返回总览」入口可一键复位回纯 top-90。
        // 这与上次否决的「画布节点点击重绘」本质不同：此处点的是左侧树里一个
        // 根本没画出来的文件，没有「其它节点可保留」—— 但本路径依旧保留全局图，
        // 只是把该文件的邻域并入并描环，不会出现「其它节点全消失」的回归。
        const out = await runPortrait('dependency', sid, { focusFileId: node.id });
        useToastStore.getState().showToast(out.message, out.severity);
      }
      return;
    }
    const rel = node.relPath || node.name;
    // 符号实体也带 fileId（符号画像）—— 文件族实体优先命中；
    // 当前画布真没有文件实体时（如符号视图）退到符号实体，双击仍有定位反馈。
    const findComp = () => {
      const comps = useEditorStore.getState().components;
      const isFileFamily = (c: SceneComponent) => c.type === 'file' || c.type === 'image' || c.type === 'asset';
      return (
        comps.find((c) => isFileFamily(c) && (c.config?.fileId === node.id || c.config?.filePath === rel)) ??
        comps.find((c) => c.config?.fileId === node.id || c.config?.filePath === rel)
      );
    };
    let comp = findComp();
    if (!comp) {
      const est = useEditorStore.getState();
      const sid = useSceneStore.getState().activeSceneId;
      // default 视图（目录树画布）没开文件叶子：自动开启「显示文件」并重画目录树，
      // 让目标文件出现在画布上再定位 —— 用户不必先知道工具栏开关在哪。
      if (sid && est.activeViewId === 'default' && !est.directoryShowFiles) {
        est.setDirectoryShowFiles(true);
        const out = await rerenderDirectoryTree(sid);
        if (!out.ok) showToast(out.message, out.severity);
        comp = findComp();
        if (comp) {
          useEditorStore.getState().focusComponent(comp.id);
          showToast(t('leftPanel.locateFileAutoShown', { name: node.name }), 'info');
          return;
        }
      }
    }
    if (comp) {
      useEditorStore.getState().focusComponent(comp.id);
      return;
    }
    // 仍无文件实体（超出目录画像上限 / 非目录视图）：定位最近的已渲染父目录
    const anc = findNearestDirComponent(rel);
    if (anc) {
      focusDirEntity(anc, node.name);
      return;
    }
    // 画布中无对应实体：图片给画像预览（非源码），其余明确告警
    if (isImageFile(rel)) {
      const root = getCachedProjectRoot();
      const data = buildImagePreviewData({ filePath: rel, fileName: node.name }, root);
      useEditorStore.getState().openImagePreview(data);
      return;
    }
    showToast(t('leftPanel.locateMissing', { name: node.name }), 'warning');
  };

  const hasData =
    fileCount > 0 ||
    modules.length > 0 ||
    symbols.length > 0 ||
    findings.length > 0 ||
    techDebt.length > 0 ||
    visibleDeadSymbols.length > 0 ||
    visibleClones.length > 0 ||
    visibleCoupling.length > 0;

  if (!hasData) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          p: 3,
          gap: 1,
          color: 'text.secondary',
          textAlign: 'center',
        }}
      >
        <AccountTreeIcon sx={{ fontSize: 40, opacity: 0.3 }} />
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {t('leftPanel.noInstances')}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.7, lineHeight: 1.5 }}>
          {t('leftPanel.noInstancesHint')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* 统计概览条 */}
      <Box
        sx={{
          px: 1,
          py: 0.5,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          flexWrap: 'wrap',
        }}
      >
        <Chip
          label={t('leftPanel.statModules', { n: modules.length })}
          size="small"
          sx={{ height: 16, fontSize: 9, '& .MuiChip-label': { px: 0.5 } }}
        />
        <Chip
          label={t('leftPanel.statFiles', { n: fileCount })}
          size="small"
          sx={{ height: 16, fontSize: 9, '& .MuiChip-label': { px: 0.5 } }}
        />
        <Chip
          label={t('leftPanel.statSymbols', { n: totalSymbols })}
          size="small"
          sx={{ height: 16, fontSize: 9, '& .MuiChip-label': { px: 0.5 } }}
        />
        <Chip
          label={t('leftPanel.statRefs', { n: totalRefs })}
          size="small"
          sx={{ height: 16, fontSize: 9, '& .MuiChip-label': { px: 0.5 }, bgcolor: 'action.selected' }}
          title={t('leftPanel.statRefsTip')}
        />
        <Chip
          label={t('leftPanel.statHighRisk', { n: highComplexity })}
          size="small"
          color={highComplexity > 0 ? 'warning' : 'default'}
          sx={{ height: 16, fontSize: 9, '& .MuiChip-label': { px: 0.5 } }}
          title={t('leftPanel.statHighRiskTip')}
        />
        <Chip
          label={t('leftPanel.statFindings', { n: findings.length })}
          size="small"
          color={
            findings.some((f) => f.severity === 'critical') ? 'error' : findings.length > 0 ? 'warning' : 'default'
          }
          sx={{ height: 16, fontSize: 9, '& .MuiChip-label': { px: 0.5 } }}
        />
        <Chip
          label={t('leftPanel.statDead', { n: visibleDeadSymbols.length })}
          size="small"
          color={visibleDeadSymbols.length > 0 ? 'warning' : 'default'}
          sx={{ height: 16, fontSize: 9, '& .MuiChip-label': { px: 0.5 } }}
          title={t('leftPanel.statDeadTip')}
        />
        <Chip
          label={t('leftPanel.statClones', { n: cloneGroups.length })}
          size="small"
          color={totalWaste >= 300 ? 'error' : cloneGroups.length > 0 ? 'warning' : 'default'}
          sx={{ height: 16, fontSize: 9, '& .MuiChip-label': { px: 0.5 } }}
          title={t('leftPanel.statClonesTip', { n: totalWaste })}
        />
        <Chip
          label={t('leftPanel.statCoupling', { n: visibleCoupling.length })}
          size="small"
          color={hiddenCouplingCount > 0 ? 'warning' : visibleCoupling.length > 0 ? 'default' : 'default'}
          sx={{ height: 16, fontSize: 9, '& .MuiChip-label': { px: 0.5 } }}
          title={t('leftPanel.statCouplingTip', { hidden: hiddenCouplingCount, cross: crossModuleCount })}
        />
      </Box>

      {/* ─── 全局搜索条（R32）：一个输入框过滤全部分组 ─── */}
      <Box
        sx={{
          px: 1,
          py: 0.5,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
        }}
      >
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: 0.75,
            height: 24,
            borderRadius: 0.75,
            bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
            border: 1,
            borderColor: filtering ? 'primary.main' : 'transparent',
            transition: 'border-color 0.15s',
          }}
        >
          <SearchIcon sx={{ fontSize: 13, color: 'text.disabled' }} />
          <InputBase
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('leftPanel.searchPlaceholder')}
            sx={{ flex: 1, fontSize: 11, '& input': { p: 0 } }}
            inputProps={{ 'aria-label': t('leftPanel.searchAria') }}
          />
          {filtering && (
            <IconButton
              size="small"
              onClick={() => setQuery('')}
              sx={{ p: 0.125 }}
              title={t('leftPanel.clearSearch')}
              aria-label={t('leftPanel.clearSearch')}
            >
              <ClearIcon sx={{ fontSize: 12 }} />
            </IconButton>
          )}
        </Box>
        <Tooltip title={t('leftPanel.highlightTip')} placement="bottom">
          <span>
            <IconButton
              size="small"
              disabled={!filtering}
              onClick={handleHighlightMatches}
              sx={{ p: 0.25, borderRadius: 0.75 }}
              aria-label={t('leftPanel.highlightTip')}
            >
              <HighlightAltIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', py: 0.5, '&::-webkit-scrollbar': { width: 4 } }}>
        {/* ─── 项目树组（替代原「模块」平铺组：任意层级目录树，可展开/收起/定位子目录）─── */}
        <GroupHeader
          icon={<FolderIcon sx={{ fontSize: 13 }} />}
          label={t('leftPanel.groupTree')}
          count={t('leftPanel.treeCount', { dirs: treeCount.dirs, files: treeCount.files })}
          open={!!openGroups.tree}
          onToggle={() => toggleGroup('tree')}
          color="#F59E0B"
        />
        <Collapse in={openGroups.tree} unmountOnExit>
          <Typography
            variant="caption"
            sx={{ display: 'block', px: 1.5, pt: 0.25, fontSize: 9, color: 'text.disabled' }}
          >
            {t('leftPanel.projectTreeHint')}
          </Typography>
          <ProjectTree
            roots={treeRoots}
            search={query}
            onFileClick={handleTreeFileClick}
            onDirFocus={handleTreeDirFocus}
          />
        </Collapse>

        {/* ─── 符号组（按类型） ─── */}
        <GroupHeader
          icon={<CodeIcon sx={{ fontSize: 13 }} />}
          label={t('leftPanel.groupSymbols')}
          count={countLabel(shownSymbols.length, totalSymbols, filtering)}
          open={!!openGroups.symbols}
          onToggle={() => toggleGroup('symbols')}
          color="#06B6D4"
        />
        <Collapse in={openGroups.symbols} unmountOnExit>
          {symbolGroups.length === 0 && (
            <Typography
              variant="caption"
              sx={{ display: 'block', px: 2, py: 0.5, fontSize: 10, color: 'text.disabled' }}
            >
              {filtering ? t('leftPanel.noMatchSymbols') : t('leftPanel.noSymbols')}
            </Typography>
          )}
          {symbolGroups.map(([kind, grp]) => {
            const list = grp.list;
            const meta = SYMBOL_KIND_META[kind] ?? {
              label: kind,
              color: '#94A3B8',
              icon: <DataObjectIcon sx={{ fontSize: 12 }} />,
            };
            return (
              <Box key={kind}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.25 }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: meta.color, flexShrink: 0 }} />
                  <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, color: 'text.secondary' }}>
                    {symbolKindLabel(meta.label)} {grp.total}
                    {grp.total > list.length ? t('leftPanel.showFirst', { n: list.length }) : ''}
                  </Typography>
                </Box>
                {list.map((s) => {
                  const fileBase = s.filePath.split('/').pop() || s.filePath;
                  const refs = refsBySymbol.get(s.id) || [];
                  const refCount = refs.length;
                  const isExpanded = expandedSymbols.has(s.id);
                  return (
                    <Box key={s.id}>
                      <InstanceRow
                        onClick={() => handleSymbolClick(s.filePath, s.name, s.id)}
                        icon={meta.icon}
                        badgeColor={meta.color}
                        title={
                          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                            {s.name}
                            {s.patterns && s.patterns !== '[]' && (
                              <Box
                                component="span"
                                sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#10B981', flexShrink: 0 }}
                              />
                            )}
                          </Box>
                        }
                        subtitle={`${fileBase}:${s.lineStart}${refCount > 0 ? t('leftPanel.symbolRefCount', { n: refCount }) : ''}`}
                        badge={
                          deadSymbolIds.has(s.id) ? (
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.25,
                                px: 0.5,
                                borderRadius: 0.75,
                                bgcolor: (t) =>
                                  t.palette.mode === 'dark' ? 'rgba(148,163,184,0.18)' : 'rgba(100,116,139,0.14)',
                                color: 'text.disabled',
                                flexShrink: 0,
                              }}
                              title={t('leftPanel.unreferencedTip')}
                            >
                              <BlockIcon sx={{ fontSize: 9 }} />
                              <Typography variant="caption" sx={{ fontSize: 9, lineHeight: 1, fontWeight: 600 }}>
                                {t('leftPanel.unreferenced')}
                              </Typography>
                            </Box>
                          ) : refCount > 0 ? (
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.25,
                                px: 0.5,
                                borderRadius: 0.75,
                                bgcolor: (t) =>
                                  t.palette.mode === 'dark' ? 'rgba(80,200,120,0.18)' : 'rgba(16,185,129,0.12)',
                                color: '#10B981',
                                flexShrink: 0,
                              }}
                              title={t('leftPanel.refTip', { n: refCount })}
                            >
                              <CallMadeIcon sx={{ fontSize: 9 }} />
                              <Typography variant="caption" sx={{ fontSize: 9, lineHeight: 1, fontWeight: 600 }}>
                                {refCount}
                              </Typography>
                            </Box>
                          ) : undefined
                        }
                      />
                      {/* 展开的引用点列表 */}
                      {isExpanded && (
                        <Box sx={{ pl: 3, pr: 1, pb: 0.5 }}>
                          {refCount === 0 && (
                            <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled' }}>
                              {t('leftPanel.noRefPoints')}
                            </Typography>
                          )}
                          {refs.slice(0, 20).map((r, idx) => (
                            <InstanceRow
                              key={`${r.fromFileId}-${r.refLine}-${idx}`}
                              onClick={() => handleRefClick(r)}
                              icon={<CallMadeIcon sx={{ fontSize: 11 }} />}
                              badgeColor="#10B981"
                              title={`${r.fromFilePath}:${r.refLine}`}
                              subtitle={
                                r.refText
                                  ? r.refText.length > 44
                                    ? r.refText.slice(0, 43) + '…'
                                    : r.refText
                                  : 'import'
                              }
                            />
                          ))}
                          {refCount > 20 && (
                            <Typography variant="caption" sx={{ fontSize: 9, color: 'text.disabled', pl: 1 }}>
                              {t('leftPanel.moreRefs', { n: refCount - 20 })}
                            </Typography>
                          )}
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Collapse>

        {/* ─── 审查发现组 ─── */}
        <GroupHeader
          icon={<RuleIcon sx={{ fontSize: 13 }} />}
          label={t('leftPanel.groupFindings')}
          count={countLabel(shownFindings.length, visibleFindings.length, filtering)}
          open={!!openGroups.findings}
          onToggle={() => toggleGroup('findings')}
          color="#EF9F27"
        />
        <Collapse in={openGroups.findings} unmountOnExit>
          <VirtualRows
            items={shownFindings}
            rowHeight={INSTANCE_ROW_H}
            keyOf={(f) => f.id}
            empty={
              <Typography
                variant="caption"
                sx={{ display: 'block', px: 2, py: 0.5, fontSize: 10, color: 'text.disabled' }}
              >
                {filtering ? t('leftPanel.noMatchFindings') : t('leftPanel.noFindings')}
              </Typography>
            }
            renderRow={(f) => (
              <InstanceRow
                height={INSTANCE_ROW_H}
                onClick={() => handleFindingClick(f)}
                icon={
                  <Box
                    sx={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      bgcolor: SEVERITY_COLORS[f.severity] ?? '#94A3B8',
                      flexShrink: 0,
                    }}
                  />
                }
                title={f.message.length > 38 ? f.message.slice(0, 37) + '…' : f.message}
                subtitle={severityLabel(f.severity)}
              />
            )}
          />
        </Collapse>

        {/* ─── 技术债组（TODO/FIXME/HACK 等标记）─── */}
        <GroupHeader
          icon={<BuildIcon sx={{ fontSize: 13 }} />}
          label={t('leftPanel.groupTechDebt')}
          count={countLabel(shownTechDebt.length, visibleTechDebt.length, filtering)}
          open={!!openGroups.techDebt}
          onToggle={() => toggleGroup('techDebt')}
          color="#EF9F27"
        />
        <Collapse in={openGroups.techDebt} unmountOnExit>
          {techDebtGroups.length === 0 && (
            <Typography
              variant="caption"
              sx={{ display: 'block', px: 2, py: 0.5, fontSize: 10, color: 'text.disabled' }}
            >
              {filtering ? t('leftPanel.noMatchTechDebt') : t('leftPanel.noTechDebt')}
            </Typography>
          )}
          {techDebtGroups.map(([marker, grp]) => {
            const list = grp.list;
            const label = markerLabel(marker);
            const sev = list[0]?.severity ?? 'info';
            return (
              <Box key={marker}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.25 }}>
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      bgcolor: SEVERITY_COLORS[sev] ?? '#94A3B8',
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, color: 'text.secondary' }}>
                    {label}（{marker}）{grp.total}
                    {grp.total > list.length ? t('leftPanel.showFirst', { n: list.length }) : ''}
                  </Typography>
                </Box>
                <VirtualRows
                  items={list}
                  rowHeight={INSTANCE_ROW_H}
                  keyOf={(d) => d.id}
                  renderRow={(d) => {
                    const fileBase = d.filePath.split('/').pop() || d.filePath;
                    return (
                      <InstanceRow
                        height={INSTANCE_ROW_H}
                        onClick={() => handleTechDebtClick(d)}
                        icon={<BuildIcon sx={{ fontSize: 11 }} />}
                        badgeColor={SEVERITY_COLORS[d.severity] ?? '#94A3B8'}
                        title={`${fileBase}:${d.lineNo}`}
                        subtitle={d.snippet.length > 40 ? d.snippet.slice(0, 39) + '…' : d.snippet}
                      />
                    );
                  }}
                />
              </Box>
            );
          })}
        </Collapse>

        {/* ─── 死代码组（零引用符号，可对照「死代码画像」画布）─── */}
        <GroupHeader
          icon={<BlockIcon sx={{ fontSize: 13 }} />}
          label={t('leftPanel.groupDead')}
          count={countLabel(shownDeadSymbols.length, visibleDeadSymbols.length, filtering)}
          open={!!openGroups.dead}
          onToggle={() => toggleGroup('dead')}
          color="#94A3B8"
        />
        <Collapse in={openGroups.dead} unmountOnExit>
          <VirtualRows
            items={shownDeadSymbols}
            rowHeight={INSTANCE_ROW_H}
            keyOf={(d) => d.symbolId}
            empty={
              <Typography
                variant="caption"
                sx={{ display: 'block', px: 2, py: 0.5, fontSize: 10, color: 'text.disabled' }}
              >
                {filtering ? t('leftPanel.noMatchDead') : t('leftPanel.noDead')}
              </Typography>
            }
            renderRow={(d) => {
              const fileBase = d.filePath.split('/').pop() || d.filePath;
              const confLabel =
                d.confidence === 'high'
                  ? t('leftPanel.confHigh')
                  : d.confidence === 'medium'
                    ? t('leftPanel.confMedium')
                    : t('leftPanel.confLow');
              const confColor = d.confidence === 'high' ? '#E24B4A' : d.confidence === 'medium' ? '#EF9F27' : '#94A3B8';
              return (
                <InstanceRow
                  height={INSTANCE_ROW_H}
                  onClick={() => handleDeadClick(d)}
                  icon={<BlockIcon sx={{ fontSize: 11 }} />}
                  badgeColor={confColor}
                  title={d.name}
                  subtitle={`${fileBase}:${d.lineStart} · ${d.kind} · ${t('leftPanel.deadConfidence', { conf: confLabel })}`}
                />
              );
            }}
          />
        </Collapse>

        {/* ─── 重复代码组（克隆检测，可对照「重复代码画像」画布）─── */}
        <GroupHeader
          icon={<ContentCopyIcon sx={{ fontSize: 13 }} />}
          label={t('leftPanel.groupClones')}
          count={countLabel(shownClones.length, visibleClones.length, filtering)}
          open={!!openGroups.clones}
          onToggle={() => toggleGroup('clones')}
          color="#14B8A6"
        />
        <Collapse in={openGroups.clones} unmountOnExit>
          {visibleClones.length === 0 && (
            <Typography
              variant="caption"
              sx={{ display: 'block', px: 2, py: 0.5, fontSize: 10, color: 'text.disabled' }}
            >
              {t('leftPanel.noClones')}
            </Typography>
          )}
          {cloneGroups.length > 0 && (
            <Typography
              variant="caption"
              sx={{ display: 'block', px: 2, pb: 0.25, fontSize: 9, color: 'text.disabled' }}
            >
              {t('leftPanel.cloneWasteSummary', { n: totalWaste })}
            </Typography>
          )}
          {cloneGroups.map(({ gid, list, lines, waste }) => {
            const sevColor = waste >= 120 ? '#E24B4A' : waste >= 40 ? '#EF9F27' : '#14B8A6';
            // Type-2 参数化克隆：组内实例只要有一条是 type2，组标题标「参数化」，
            // 提示「改过名的复制粘贴」——比逐字复制更隐蔽，值得单独看。
            const type2Count = list.filter((c) => c.cloneType === 'type2').length;
            return (
              <Box key={gid}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.25 }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: 0.3, bgcolor: sevColor, flexShrink: 0 }} />
                  <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, color: 'text.secondary' }}>
                    {t('leftPanel.cloneGroup', { n: list.length, lines, waste })}
                  </Typography>
                  {type2Count > 0 && (
                    <Chip
                      label={t('leftPanel.cloneParametric', { n: type2Count })}
                      size="small"
                      sx={{
                        height: 13,
                        fontSize: 8,
                        ml: 0.5,
                        bgcolor: '#8B5CF6',
                        color: '#fff',
                        '& .MuiChip-label': { px: 0.5 },
                      }}
                      title={t('leftPanel.cloneParametricTip')}
                    />
                  )}
                </Box>
                <VirtualRows
                  items={list}
                  rowHeight={INSTANCE_ROW_H}
                  keyOf={(c) => c.id}
                  maxHeight={Math.min(220, Math.max(INSTANCE_ROW_H, list.length * INSTANCE_ROW_H))}
                  empty={null}
                  renderRow={(c) => {
                    const fileBase = c.filePath.split('/').pop() || c.filePath;
                    const snip = (c.snippet || '').split('\n')[0]?.trim() ?? '';
                    return (
                      <InstanceRow
                        height={INSTANCE_ROW_H}
                        onClick={() => handleCloneClick(c, list)}
                        icon={<ContentCopyIcon sx={{ fontSize: 11 }} />}
                        badgeColor={sevColor}
                        title={
                          c.cloneType === 'type2'
                            ? t('leftPanel.cloneTitle', { file: fileBase, start: c.startLine, end: c.endLine })
                            : `${fileBase}:${c.startLine}-${c.endLine}`
                        }
                        subtitle={
                          (c.cloneType === 'type2' ? t('leftPanel.cloneSubParametric') : '') +
                          (snip.length > 40 ? snip.slice(0, 39) + '…' : snip || c.filePath)
                        }
                      />
                    );
                  }}
                />
              </Box>
            );
          })}
        </Collapse>

        {/* ─── 变更耦合组（无静态依赖却总一起改 → 隐藏的跨模块架构耦合）─── */}
        <GroupHeader
          icon={<LinkIcon sx={{ fontSize: 13 }} />}
          label={t('leftPanel.groupCoupling')}
          count={countLabel(shownCoupling.length, visibleCoupling.length, filtering)}
          open={!!openGroups.coupling}
          onToggle={() => toggleGroup('coupling')}
          color="#F59E0B"
        />
        <Collapse in={openGroups.coupling} unmountOnExit>
          <VirtualRows
            items={shownCoupling}
            rowHeight={INSTANCE_ROW_H}
            keyOf={(c) => c.id}
            empty={
              <Typography
                variant="caption"
                sx={{ display: 'block', px: 2, py: 0.5, fontSize: 10, color: 'text.disabled' }}
              >
                {filtering ? t('leftPanel.noMatchCoupling') : t('leftPanel.noCoupling')}
              </Typography>
            }
            renderRow={(c) => {
              const aBase = c.fileAPath.split('/').pop() || c.fileAPath;
              const bBase = c.fileBPath.split('/').pop() || c.fileBPath;
              const riskColor =
                c.riskLevel === 'extreme'
                  ? '#E24B4A'
                  : c.riskLevel === 'high'
                    ? '#EF9F27'
                    : c.riskLevel === 'medium'
                      ? '#F59E0B'
                      : '#94A3B8';
              const kindLabel =
                c.couplingKind === 'hidden' ? t('leftPanel.couplingHidden') : t('leftPanel.couplingStruct');
              return (
                <InstanceRow
                  height={INSTANCE_ROW_H}
                  key={c.id}
                  onClick={() => handleCouplingClick(c)}
                  icon={<LinkIcon sx={{ fontSize: 11 }} />}
                  badgeColor={riskColor}
                  title={
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
                      {aBase}
                      <Box component="span" sx={{ color: 'text.disabled', fontSize: 10 }}>
                        ⇄
                      </Box>
                      {bBase}
                    </Box>
                  }
                  subtitle={t('leftPanel.couplingSubtitle', {
                    n: c.coChanges,
                    pct: Math.round(c.degree * 100),
                    kind: kindLabel,
                    cross: c.crossModule ? ` · ${t('leftPanel.couplingCross')}` : '',
                  })}
                  badge={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                      {c.crossModule && <span title={t('leftPanel.couplingCrossBadge')}>⌖</span>}
                      {c.couplingKind === 'hidden' && (
                        <Box
                          sx={{
                            width: 14,
                            height: 14,
                            borderRadius: '50%',
                            bgcolor: '#8B5CF6',
                            color: '#fff',
                            fontSize: 8,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                          title={t('leftPanel.couplingHiddenTip')}
                        >
                          !
                        </Box>
                      )}
                      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: riskColor, flexShrink: 0 }} />
                    </Box>
                  }
                />
              );
            }}
          />
        </Collapse>

        {/* ─── 实体类型（拖拽模板，保留原能力，默认折叠） ─── */}
        <GroupHeader
          icon={<ExtensionIcon sx={{ fontSize: 13 }} />}
          label={t('leftPanel.groupTypes')}
          count={componentRegistry.getAll().length}
          open={!!openGroups.types}
          onToggle={() => toggleGroup('types')}
          color="#94A3B8"
        />
        <Collapse in={openGroups.types}>
          {componentRegistry.getAll().map((d) => (
            <EntityItem
              key={d.type}
              type={d.type}
              name={d.name}
              description={d.description ?? ''}
              icon={ICON_MAP[d.icon] ?? <DescriptionIcon sx={{ fontSize: 18 }} />}
            />
          ))}
        </Collapse>
      </Box>
    </Box>
  );
}

/** 画布实体树（需求 §5.2 EntityTree）：按 Layer/Type 分组的画布实体树，点击定位并选中 */
function CanvasEntityTreeTab() {
  const components = useEditorStore((s) => s.components);
  const layers = useEditorStore((s) => s.layers);
  const selectedIds = useEditorStore((s) => s.selection.selectedIds);
  const [collapsedLayers, setCollapsedLayers] = useState<Set<string>>(new Set());

  // 按 layer 分组（保持 layer.order），组内按 type → name 排序
  const groups = useMemo(() => {
    const byLayer = new Map<string, SceneComponent[]>();
    for (const c of components) {
      const arr = byLayer.get(c.layerId) || [];
      arr.push(c);
      byLayer.set(c.layerId, arr);
    }
    const layerById = new Map(layers.map((l) => [l.id, l]));
    const ordered = [...layers]
      .sort((a, b) => a.order - b.order)
      .map((l) => ({
        layer: l,
        items: (byLayer.get(l.id) || [])
          .slice()
          .sort((x, y) => x.type.localeCompare(y.type) || x.name.localeCompare(y.name)),
      }))
      .filter((g) => g.items.length > 0);
    const orphan = components.filter((c) => !layerById.has(c.layerId));
    if (orphan.length > 0) {
      const orphanLayer: LayerNode = {
        id: '__orphan',
        name: t('leftPanel.orphanLayer'),
        type: 'layer',
        visible: true,
        locked: false,
        opacity: 1,
        parentId: null,
        children: [],
        order: 9999,
        expanded: true,
        color: '#94A3B8',
      };
      ordered.push({ layer: orphanLayer, items: orphan.slice().sort((x, y) => x.name.localeCompare(y.name)) });
    }
    return ordered;
  }, [components, layers]);

  // 按 type 二次聚合（组内小标题，满足"按 Layer/Type 分组"）
  const groupByType = (items: SceneComponent[]) => {
    const m = new Map<string, SceneComponent[]>();
    for (const c of items) {
      const arr = m.get(c.type) || [];
      arr.push(c);
      m.set(c.type, arr);
    }
    return Array.from(m.entries());
  };

  const handleEntityClick = (id: string) => {
    const editor = useEditorStore.getState();
    editor.selectComponent(id, false);
    editor.focusComponent(id);
  };

  if (components.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          p: 3,
          gap: 1,
          color: 'text.secondary',
          textAlign: 'center',
        }}
      >
        <LayersIcon sx={{ fontSize: 40, opacity: 0.3 }} />
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {t('leftPanel.treeEmpty')}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.7, lineHeight: 1.5 }}>
          {t('leftPanel.treeEmptyHint')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, overflowY: 'auto', py: 0.5, '&::-webkit-scrollbar': { width: 4 } }}>
      <Box sx={{ px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 0.5 }}>
        <Chip
          label={t('leftPanel.statEntities', { n: components.length })}
          size="small"
          sx={{ height: 16, fontSize: 9, '& .MuiChip-label': { px: 0.5 } }}
        />
        <Chip
          label={t('leftPanel.statLayers', { n: layers.length })}
          size="small"
          sx={{ height: 16, fontSize: 9, '& .MuiChip-label': { px: 0.5 } }}
        />
      </Box>
      {groups.map(({ layer, items }) => {
        const open = !collapsedLayers.has(layer.id);
        return (
          <Box key={layer.id}>
            <Box
              onClick={() =>
                setCollapsedLayers((prev) => {
                  const next = new Set(prev);
                  if (next.has(layer.id)) next.delete(layer.id);
                  else next.add(layer.id);
                  return next;
                })
              }
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 0.75,
                py: 0.4,
                cursor: 'pointer',
                '&:hover': { backgroundColor: 'action.hover' },
              }}
            >
              <Box
                sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: layer.color || '#94A3B8', flexShrink: 0 }}
              />
              <Typography variant="caption" sx={{ flex: 1, fontWeight: 600, fontSize: 11 }}>
                {resolveFragments(layer.name)}
              </Typography>
              <Chip
                label={items.length}
                size="small"
                sx={{ height: 14, fontSize: 8, '& .MuiChip-label': { px: 0.5 } }}
              />
              {open ? (
                <ExpandLessIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
              ) : (
                <ExpandMoreIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
              )}
            </Box>
            {open &&
              groupByType(items).map(([type, list]) => {
                const def = componentRegistry.get(type);
                const iconName = (def?.icon as string) || 'description';
                return (
                  <Box key={type}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 1.5, py: 0.2 }}>
                      <Typography
                        variant="caption"
                        sx={{ fontSize: 9, fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase' }}
                      >
                        {resolveFragments(def?.name ?? type)} {list.length}
                      </Typography>
                    </Box>
                    {list.map((c) => {
                      const isSel = selectedIds.includes(c.id);
                      return (
                        <InstanceRow
                          key={c.id}
                          onClick={() => handleEntityClick(c.id)}
                          icon={ICON_MAP[iconName] ?? <DescriptionIcon sx={{ fontSize: 11 }} />}
                          badgeColor={!c.visible ? '#94A3B8' : isSel ? '#6366F1' : undefined}
                          title={resolveFragments(c.name) || c.type}
                          subtitle={
                            c.config && typeof c.config === 'object' && 'label' in c.config
                              ? String((c.config as Record<string, unknown>).label)
                              : c.type
                          }
                        />
                      );
                    })}
                  </Box>
                );
              })}
          </Box>
        );
      })}
    </Box>
  );
}

const ICON_MAP: Record<string, React.ReactNode> = {
  description: <DescriptionIcon sx={{ fontSize: 18 }} />,
  folder: <FolderIcon sx={{ fontSize: 18 }} />,
  inventory_2: <InventoryIcon sx={{ fontSize: 18 }} />,
  link: <LinkIcon sx={{ fontSize: 18 }} />,
  layers: <LayersIcon sx={{ fontSize: 18 }} />,
  text_fields: <TextFieldsIcon sx={{ fontSize: 18 }} />,
  code: <CodeIcon sx={{ fontSize: 18 }} />,
  // 写作实体图标（writing-analyzer manifest：章节/人物/世界观/大纲）
  menu_book: <MenuBookIcon sx={{ fontSize: 18 }} />,
  person: <PersonIcon sx={{ fontSize: 18 }} />,
  public: <PublicIcon sx={{ fontSize: 18 }} />,
  account_tree: <AccountTreeIcon sx={{ fontSize: 18 }} />,
};

interface EntityItemProps {
  type: string;
  name: string;
  description: string;
  icon: React.ReactNode;
}

function EntityItem({ type, name, description, icon }: EntityItemProps) {
  return (
    <Box
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-project-entity', type);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
        p: 0.75,
        borderRadius: 1,
        cursor: 'grab',
        userSelect: 'none',
        '&:hover': {
          backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'),
        },
        '&:active': {
          cursor: 'grabbing',
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          flexShrink: 0,
          borderRadius: 1,
          color: 'primary.main',
          backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.08)'),
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 500, fontSize: 12, lineHeight: 1.3 }}>
          {resolveFragments(name)}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', fontSize: 10, lineHeight: 1.4, mt: 0.25 }}
        >
          {resolveFragments(description)}
        </Typography>
      </Box>
    </Box>
  );
}

interface ComponentCenterPanelProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

// 左栏 Tab 选中态跨会话记忆（第十四轮）：创作者常停在「目录树」做章节定位，
// 此前每次重开工作室回到「元素」拖拽货架。与右栏宽/折叠态同口径落 localStorage；
// 下方既有「非法 tab 兑回 entities」effect 仍兑住跨场景残留值。
const LEFT_TAB_KEY = 'sight-folio:studio.leftPanelTab';
const LEFT_TAB_VALUES = ['entities', 'files', 'plugins', 'layers', 'tree'] as const;
type LeftPanelTab = (typeof LEFT_TAB_VALUES)[number];
function readSavedLeftPanelTab(): LeftPanelTab {
  try {
    const raw = localStorage.getItem(LEFT_TAB_KEY);
    if (raw && (LEFT_TAB_VALUES as readonly string[]).includes(raw)) return raw as LeftPanelTab;
  } catch {
    // 忽略
  }
  return 'entities';
}

export function ComponentCenterPanel({ collapsed = false, onToggle }: ComponentCenterPanelProps) {
  const [tab, setTab] = useState<LeftPanelTab>(readSavedLeftPanelTab);
  // 切换即落盘（与 setTab 收敛为一个动作，避免两处漏写）
  const selectTab = useCallback((next: LeftPanelTab) => {
    setTab(next);
    try {
      localStorage.setItem(LEFT_TAB_KEY, next);
    } catch {
      // 忽略
    }
  }, []);

  // ─── A 改造：书场景（novel-zh）左栏切写作向 Tab ───
  // 信号口径与 ArchitectureLayersPanel 一致（activeScene.primaryLanguage）。
  // 代码场景 5 Tab 原样，零回归；书场景 2 Tab（v3 IA 收口）：
  //   entities→「元素」= 拖拽货架（空白模板拖到画布即真建档，见 WritingLeftTabs）
  //   tree→「目录树」= 画布实体树，点击定位选中（画布工作区的元素定位入口）
  //   files（章节文件树）撤除：章节定位=目录树+画布卡双击；重扫唯一入口=顶栏「解析全书」
  //   layers/plugins 隐藏（卷部管理在顶栏）
  const isBookScene = useSceneStore(
    (s) => s.scenes.find((sc) => sc.id === s.activeSceneId)?.primaryLanguage === 'novel-zh',
  );
  // 书场景没有 layers/plugins/files Tab：从代码场景切过来时残留的 tab 状态会落空 →
  // 兜底回 entities（联动绝不静默：不能让用户看到一块空白面板）
  useEffect(() => {
    // 走 selectTab（写盘）而非裸 setTab：tab 已跨会话持久化，兑回时若只改 state 不改
    // localStorage，会出现「显示 entities / 落盘 layers」不一致（下次进代码场景读到
    // 脏值 layers，或隐私模式落盘失败也不影响本次一致性）。
    if (isBookScene && (tab === 'layers' || tab === 'plugins' || tab === 'files')) selectTab('entities');
  }, [isBookScene, tab, selectTab]);

  if (collapsed) {
    return (
      <Box
        sx={{
          width: PANEL_COLLAPSED_WIDTH,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          pt: 1,
          borderRight: 1,
          borderColor: 'divider',
          backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(18, 18, 24, 0.6)' : 'rgba(250, 250, 252, 0.8)'),
          transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <Tooltip title={t('leftPanel.expand')} placement="right">
          <IconButton
            size="small"
            onClick={onToggle}
            sx={{
              width: 28,
              height: 28,
              borderRadius: 1,
              '&:hover': {
                backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
              },
            }}
            aria-label={t('leftPanel.expand')}
          >
            <ChevronRightIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: PANEL_WIDTH,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: 1,
        borderColor: 'divider',
        backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(18, 18, 24, 0.6)' : 'rgba(250, 250, 252, 0.8)'),
        minHeight: 0,
        position: 'relative',
        transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <Tabs
        value={tab}
        onChange={(_, v) => selectTab(v as LeftPanelTab)}
        variant="fullWidth"
        sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider' }}
      >
        {/* Tab 文案按场景分流：书场景业务化为「元素」（章节/人物/世界观），
            代码场景保留「实体」（代码实体实例，零回归） */}
        <Tab
          label={t(isBookScene ? 'leftPanel.tabElements' : 'leftPanel.tabEntities')}
          value="entities"
          sx={{ minHeight: 36, fontSize: 12, py: 0.5 }}
        />
        {!isBookScene && (
          <Tab label={t('leftPanel.tabFiles')} value="files" sx={{ minHeight: 36, fontSize: 12, py: 0.5 }} />
        )}
        {/* 目录树：书场景解禁（画布工作区的元素定位入口），代码场景原样 */}
        <Tab
          label={t(isBookScene ? 'leftPanel.tabDirectory' : 'leftPanel.tabTree')}
          value="tree"
          sx={{ minHeight: 36, fontSize: 12, py: 0.5 }}
        />
        {/* plugins Tab 已随代码分析收口整体移除：唯一分析器是 writing-analyzer，
            「多语言插件切换 + 语言聚焦」体系无切换对象，留着只剩误导。 */}
        {!isBookScene && (
          <Tab
            icon={<LayersIcon sx={{ fontSize: 13 }} />}
            iconPosition="start"
            label={t('leftPanel.tabLayers')}
            value="layers"
            sx={{ minHeight: 36, fontSize: 12, py: 0.5 }}
          />
        )}
      </Tabs>

      {tab === 'entities' && (isBookScene ? <WritingEntitiesTab /> : <EntityInstancesTab />)}

      {tab === 'files' && <ScannedFilesPanel />}

      {tab === 'layers' && !isBookScene && <CanvasLayerPanel />}

      {/* 目录树：书场景走「作品目录树」——按 parentId 父子关系缩进的卷/章/节结构树，
          点节点即在工作室里定位（右栏要素/详情联动）。不再复用画布实体树：后者读
          editorStore.components（当前视图的画布卡片），书场景里会漏出「实体 / 图层」等
          代码分析词汇、且永远找不到「第 N 章」。代码场景原样走 CanvasEntityTreeTab（零回归）。 */}
      {tab === 'tree' && (isBookScene ? <WritingStructureTreeTab /> : <CanvasEntityTreeTab />)}

      {/* 收起按钮（悬浮右上角，仿 biosphere） */}
      <Tooltip title={t('leftPanel.collapse')} placement="right">
        <IconButton
          size="small"
          onClick={onToggle}
          sx={{
            position: 'absolute',
            top: 8,
            right: 4,
            width: 20,
            height: 20,
            borderRadius: 0.5,
            zIndex: 10,
            opacity: 0.45,
            transition: 'opacity 0.2s, background-color 0.2s',
            '&:hover': {
              opacity: 1,
              backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'),
            },
          }}
          aria-label={t('leftPanel.collapse')}
        >
          <ChevronLeftIcon sx={{ fontSize: 12 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
