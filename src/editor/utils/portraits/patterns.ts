/**
 * 设计模式画像
 *
 * patternsRedetectedThisSession + runPatternsPortrait（GoF 分类分区栅格）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist, clearCanvas, place } from './canvas';
import { type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { projectScanApi } from '../../../services/tauri';
import { useProjectStore } from '../../../store/projectStore';
import { useToastStore } from '../../../store/toastStore';
import { PATTERN_CATEGORY_LABEL_KEY, PATTERN_CATEGORY_COLORS, PATTERN_CATEGORY_ORDER, patternCategoryOf, patternColorOf, patternLabel } from '.././fileInsights';


// v2.27 会话级去重：同一分析在一次会话内只自动重检测一次，避免每次打开画像都重读源码；
// 用户手动「设计模式（重新检测）」走 force，不受此标记限制，始终强制刷新。
const patternsRedetectedThisSession = new Set<string>();

// v2.27 修正「自愈门禁误判」：
// 旧引擎（v2.24 之前）其实已经能识别 store/provider/service/repository/controller/middleware/
// plugin/factory 这类「命名即模式」的类级符号——所以旧快照里往往残留一两个 factory/service 命中。
// 若把这些都算作「已重检」判据，一个残留的 `factory` 单点命中就会让 needsRefresh 永远为 false，
// 自愈重检被跳过，画像卡在「1 个节点」——这正是反复报「设计模式画像不能用」的真根因。
// 真正只有 v2.24+ 证据引擎才产出的、旧引擎绝不出现的模式只有三个：hook / hoc / factory_fn。
// 用它们做「新版引擎已跑过」的判据，残缺快照（缺这三个）才能被正确识别并重检补全。
const NEW_ENGINE_CANARY_IDS = new Set(['hook', 'hoc', 'factory_fn']);

export async function runPatternsPortrait(
  analysisId: string,
  projectRoot?: string | null,
  force = false,
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  let hits = pst.patternHits;
  // v2.20.1 自愈：画像运行时若 store 未持有模式数据（例如存量会话未重新 loadAll、
  // 或刚切到新分析），先尝试拉取一次再判定，避免「点开设计模式什么都没有」被误判为功能失效。
  if (hits.length === 0) {
    try {
      await pst.loadPatterns(analysisId);
      hits = useProjectStore.getState().patternHits;
    } catch {
      /* 拉取失败则走下方空态提示 */
    }
  }
  // v2.21 自愈增强：存量分析多为旧保守引擎扫描，patterns 列几乎全空 → 画像「无数据」。
  // 此时若已知项目根目录，直接对源码重新检测设计模式（仅回写 patterns/metadata 两列，
  // 不动符号稳定 id 与引用边），让画像无需整库重扫即可出数据——这正是「不能用」的根因修复。
  // v2.22 鲁棒化：重检测的错误与「缺根目录」不再被静默吞掉——把真实原因带出去，
  // 让「点开设计模式什么都没有」变成「为什么 + 怎么修」，而不是被误判为功能失效。
  let redetected = false;
  let redetectError: string | null = null;
  // v2.26 后端陈旧自检：若运行的是旧构建，redetect_design_patterns 命令不存在，
  // invoke 会抛「command not found / unknown command」类错误。此时不能把它当成
  // 「源码读取失败」误导用户去查路径，而应明确指向「请重启应用加载最新后端」——
  // 这正是「不能用」反复出现的真因，给一条可执行指引比静默/误报更有用（renderable≠useful）。
  let backendStale = false;
  // v2.27 自愈强化：旧引擎扫描产物往往「只有类级模式、缺函数式/架构角色模式」。
  // 此前 redetect 仅在 hits 全空时才触发 —— 一旦旧扫描里残存了几个类级模式（singleton/
  // factory 等），hits 非空就永远跳过重检，用户每次打开都只看到残缺快照，持续误判为
  // 「设计模式画像不能用」。现在：只要命中里没有任何 v2.24 后的函数式/架构角色模式，
  // 即视为残缺快照，自动对源码重检补全（一次会话内只跑一次，手动「重新检测」走 force 强刷）。
  // 仅在命中里包含「新版引擎独有」的模式（hook/hoc/factory_fn）时，才认为这份快照已由新版引擎产出；
  // 旧引擎只会产生 factory/service/repository 等类级命中，不会产出上述三种，从而触发重检。
  const hasNewEngineMark = hits.some((h) => NEW_ENGINE_CANARY_IDS.has(h.pattern));
  // v2.27 额外兜底：即便命中非空，若模式数量相对项目规模过少（例如只有 1~2 个），
  // 也视为旧引擎的残缺快照，强制重检，避免「打开一次就被残缺数据钉死」。
  const tooThin = hits.length > 0 && hits.length <= 2;
  const needsRefresh = force || hits.length === 0 || !hasNewEngineMark || tooThin;
  const alreadyRedetected = patternsRedetectedThisSession.has(analysisId);
  // v2.25 手动重新检测：菜单「设计模式（重新检测）」走 force=true，绕过「空数据才重检」门禁，
  // 强制对源码重跑引擎并刷新画像——解决存量项目被旧引擎误判后、用户无入口刷新的「不能用」死局。
  if (needsRefresh && projectRoot && projectRoot.trim() && (force || !alreadyRedetected)) {
    try {
      // 重检测要读全部源码、逐符号跑引擎，可能耗时数秒。先给一条「检测中」提示，
      // 否则用户点击后画布毫无反应，会误以为功能失效（即「不能用」的典型体感）。
      if (!force) useToastStore.getState().showToast(t('portrait.msg.patternRedetecting'), 'info');
      await projectScanApi.redetectDesignPatterns(analysisId, projectRoot.trim());
      redetected = true;
      patternsRedetectedThisSession.add(analysisId);
      await pst.loadPatterns(analysisId);
      hits = useProjectStore.getState().patternHits;
    } catch (e) {
      // 不再静默：记下真实原因，下方空态直接呈现，用户才知道问题出在源码读取/DB 而非功能缺失。
      redetectError = e instanceof Error ? e.message : String(e);
      // 后端陈旧特征：命令未注册 / invoke 失败（旧二进制没有 redetect_design_patterns）。
      if (/not found|unknown command|invoke error|does not exist|no handler/i.test(redetectError)) {
        backendStale = true;
      }
      console.error('[runPatternsPortrait] 重新检测设计模式失败', e);
    }
  }
  if (hits.length === 0) {
    // 后端陈旧：命令不可用 → 明确指引重启应用，而非误导去查源码路径。
    if (backendStale) {
      return {
        ok: false,
        message: t('portrait.msg.patternBackendStale'),
        severity: 'warning',
        placed: 0,
      };
    }
    // 缺项目根目录：重检测无从读取源码，明确指引用户先打开项目文件夹（设置 projectRoot）。
    if (!projectRoot || !projectRoot.trim()) {
      return {
        ok: false,
        message: t('portrait.msg.patternNoRoot'),
        severity: 'warning',
        placed: 0,
      };
    }
    // 有根目录但仍是空：区分「重检测报错」与「确实无模式」，分别给可执行的下一步。
    return {
      ok: false,
      message: redetectError
        ? t('portrait.msg.patternRedetectError', { err: redetectError })
        : redetected
          ? t('portrait.msg.patternNoDataAfterRedetect')
          : t('portrait.msg.patternNoData'),
      severity: redetectError ? 'warning' : 'info',
      placed: 0,
    };
  }

  const MAX_HITS = 120;
  const sorted = [...hits].sort((a, b) => b.confidence - a.confidence).slice(0, MAX_HITS);

  clearCanvas();

  // 解析 fileId / symbolId：让模式节点与画布文件 / 符号实体同源联动
  // （双击跳源码、选中高亮所属文件、AI 诊断都走 fileId，与 symbols/dependency 一致）。
  // 设计模式识别是启发式推断，命中的符号在 symbols 表里必有对应条目（同一 filePath + 同名）。
  const fileIdByPath = new Map<string, string>();
  for (const f of pst.files) if (!f.isDirectory) fileIdByPath.set(f.relPath, f.id);
  const symIdByFileSym = new Map<string, string>();
  for (const s of pst.symbols) symIdByFileSym.set(`${s.filePath}\u0000${s.name}`, s.id);

  const COL_W = 250;
  const ROW_H = 62;
  const LEFT = 40;
  const TOP = 104; // 顶部留给总览横幅（24..70），避免与分类分区头重叠
  const SUB_H = 24;
  let placed = 0;

  // ── 总览横幅：直接回答「我的项目用了哪些设计模式」──
  // 这是该画像的「灵魂」：此前只是一屏扁平节点，用户看不到聚合结论。
  const catCounts: Record<string, number> = { creational: 0, structural: 0, behavioral: 0, architectural: 0 };
  for (const h of sorted) catCounts[patternCategoryOf(h)] = (catCounts[patternCategoryOf(h)] ?? 0) + 1;
  const byPatternAgg = new Map<string, number>();
  for (const h of sorted) byPatternAgg.set(h.pattern, (byPatternAgg.get(h.pattern) || 0) + 1);
  const topPattern = Array.from(byPatternAgg.entries()).sort((a, b) => b[1] - a[1])[0];
  const distinctKinds = byPatternAgg.size;
  const breakdown = PATTERN_CATEGORY_ORDER.map(
    (cat) => `${t(PATTERN_CATEGORY_LABEL_KEY[cat] ?? cat)} ${catCounts[cat] ?? 0}`,
  ).join(' · ');
  // 健康提示（v2.25）：低置信命中占比高说明引擎靠命名推断、可能误报，提示用户人工核对，
  // 让画像从「列清单」升级为「可行动的分析」——契合「renderable ≠ useful」验收标尺。
  const lowConf = sorted.filter((h) => h.confidence < 0.7).length;
  const healthNote = lowConf > 0 ? t('portrait.msg.patternLowConf', { n: lowConf }) : '';
  const overviewName = t('portrait.msg.patternOverviewTitle', { kinds: distinctKinds, n: sorted.length });
  const overviewSub = `${breakdown}${topPattern ? t('portrait.msg.patternOverviewTop', { name: patternLabel(topPattern[0]), n: topPattern[1] }) : ''}${healthNote}`;
  place(
    'layer-marker',
    { x: LEFT, y: 24 },
    overviewName,
    {
      layerName: overviewName,
      subtitle: overviewSub,
      layerColor: '#38bdf8',
      fullPath: overviewSub,
    },
    { w: COL_W * PATTERN_CATEGORY_ORDER.length - 10, h: 46 },
  );

  // ── 四分类列：每列内按「模式」聚簇（同类色块下，同模式一组、共享配色）──
  PATTERN_CATEGORY_ORDER.forEach((cat, col) => {
    const catHits = sorted.filter((h) => patternCategoryOf(h) === cat);
    if (catHits.length === 0) return;
    const x = LEFT + col * COL_W;
    const color = PATTERN_CATEGORY_COLORS[cat] ?? '#94a3b8';
    // 分类分区头
    place('layer-marker', { x, y: TOP - 30 }, t(PATTERN_CATEGORY_LABEL_KEY[cat] ?? cat), {
      layerName: t(PATTERN_CATEGORY_LABEL_KEY[cat] ?? cat),
      layerColor: color,
      layerOrder: col,
      fileCount: catHits.length,
    });
    // 按模式聚簇：同模式命中归一组，组头显示「模式名 (n)」并染该模式配色
    const groups = new Map<string, typeof catHits>();
    for (const h of catHits) {
      const arr = groups.get(h.pattern);
      if (arr) arr.push(h);
      else groups.set(h.pattern, [h]);
    }
    const orderedGroups = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
    let y = TOP;
    for (const [pid, group] of orderedGroups) {
      const pcolor = patternColorOf(pid);
      // 模式子头（带该模式配色，扫一眼即知这一簇是什么模式）
      place(
        'layer-marker',
        { x: x + 4, y },
        `${patternLabel(pid)} (${group.length})`,
        {
          layerName: `${patternLabel(pid)} (${group.length})`,
          layerColor: pcolor,
        },
        { w: COL_W - 12, h: SUB_H },
      );
      y += SUB_H + 2;
      for (const h of group) {
        const fileId = fileIdByPath.get(h.filePath);
        const symbolId = symIdByFileSym.get(`${h.filePath}\u0000${h.symbolName}`);
        if (
          place(
            'pattern-node',
            { x, y },
            `${patternLabel(h.pattern)} · ${h.symbolName}`,
            {
              patternId: h.pattern,
              patternName: patternLabel(h.pattern),
              patternCategory: cat,
              symbolName: h.symbolName,
              filePath: h.filePath,
              fileId,
              symbolId,
              line: h.line,
              confidence: h.confidence,
              evidence: h.evidence,
              signals: h.signals,
              // v2.20 设计模式节点从「死节点」改为可行动实体：带 portraitMode 让双击/选中/AI
              // 诊断能精确识别，fileId 打通与文件实体的同源联动（与 symbols/dependency 同口径）。
              portraitMode: 'patterns',
            },
            // v2.28 修复「实体渲染不全/相邻重叠」：此前节点漏传尺寸，画布外壳 width/height 为
            // undefined → 节点塌缩成内容宽度溢出 250px 列宽，跨列互相覆盖。这里显式给定列内盒，
            // 宽度略小于列距(250)留 12px 间隙，高度留出 6px 行距，确保实体互不重叠且完整渲染。
            { w: COL_W - 12, h: ROW_H - 6 },
          )
        ) {
          placed += 1;
        }
        y += ROW_H;
      }
      y += 8; // 模式簇间留白
    }
  });

  if (placed === 0) {
    return { ok: false, message: t('portrait.msg.patternNoNode'), severity: 'warning', placed: 0 };
  }

  await persist(analysisId, 'patterns');

  return {
    ok: true,
    message: t('portrait.msg.patternOverview', {
      kinds: distinctKinds,
      n: placed,
      breakdown,
      trunc: hits.length > MAX_HITS ? t('portrait.msg.patternTrunc', { keep: MAX_HITS, total: hits.length }) : '',
      redetect: redetected ? t('portrait.msg.patternRedetected') : '',
      top: topPattern ? t('portrait.msg.patternTop', { name: patternLabel(topPattern[0]), n: topPattern[1] }) : '',
    }),
    severity: 'success',
    placed,
  };
}
