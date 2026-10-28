/**
 * 目录结构画像
 *
 * runDirectoryPortrait/openDirectorySubtree/rerenderDirectoryTree（冰柱目录树）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist, clearCanvas, resetPending } from './canvas';
import { currentInsights, fileConfig, findNode, buildTreeGuide } from './shared';
import { type PortraitMode, type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { useEditorStore, type BulkComponentInput } from '../../../store/editorStore';
import { useProjectStore } from '../../../store/projectStore';
import { buildDirectoryTree, flattenDirectoryTree } from '.././directoryTree';
import { emptyFileInsight } from '.././fileInsights';
import { entityTypeForFile } from '.././fileKind';


export async function runDirectoryPortrait(
  analysisId: string,
  scopeDir?: string,
  opts?: { includeFiles?: boolean; search?: string; sort?: 'size' | 'name' | 'path' },
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const root = buildDirectoryTree({
    files: pst.files,
    metrics: pst.metrics,
    techDebt: pst.techDebt,
    findings: pst.findings,
    clones: pst.clones,
  });

  if (!root) {
    return { ok: false, message: t('portrait.msg.dirNoScan'), severity: 'info', placed: 0 };
  }

  const target = scopeDir ? findNode(root, scopeDir) : root;
  if (!target) {
    return { ok: false, message: t('portrait.msg.dirMissing', { dir: scopeDir ?? '' }), severity: 'info', placed: 0 };
  }
  const baseDepth = scopeDir ? scopeDir.split('/').length : 0;

  // 文件叶子：双击下钻的子树视图始终显示（范围小、可用）；主目录树跟随 store.directoryShowFiles 开关
  const includeFiles = opts?.includeFiles ?? (scopeDir ? true : useEditorStore.getState().directoryShowFiles);

  // 目录画像文件叶也走统一 fileConfig 契约，保证画布渲染与属性面板共享同一份度量
  // （refCount / symbolCount / churn …）。否则画布显示 0 依赖 / 无复杂度，而面板按
  // fileId 从 store 算出真实依赖数，二者不一致（与 image/asset 类型 bug 同类根因：
  // 实体 config 没有单一事实源）。复杂度维度在目录树里不强调（保留 R38 语言色身份条），
  // 故在 extra 里置 0 避免低复杂度文件被刷成绿色热力底；其余度量照常带出。
  const insights = currentInsights();

  const q = opts?.search?.trim().toLowerCase() || '';
  const flat = flattenDirectoryTree(target, {
    maxDepth: 4,
    maxNodes: 160,
    minFiles: 1,
    search: q || undefined,
    sort: opts?.sort ?? 'size',
  });
  const nodes = flat.nodes;
  // 搜索命中集合：渲染层高亮命中目录，其余命中路径上的祖先节点淡化
  const matched = new Set<string>();
  if (q) for (const n of nodes) if (n.path.toLowerCase().includes(q)) matched.add(n.path);
  if (nodes.length <= 1) {
    if (q) {
      return {
        ok: false,
        message: t('portrait.msg.dirNoMatch', { q: opts!.search ?? '' }),
        severity: 'info',
        placed: 0,
      };
    }
    return {
      ok: false,
      message: scopeDir ? t('portrait.msg.dirLeaf', { dir: scopeDir }) : t('portrait.msg.dirNoDepth'),
      severity: 'info',
      placed: 0,
    };
  }

  clearCanvas();

  const LEFT = 60;
  const TOP = 60;
  const INDENT = 34;
  // 行高与节点高：目录行要塞下「名称 + 语言条 + 条目数 + 复杂度 + 徽标」两行信息，
  // 文件行要塞下 FileRenderer full 档三行（文件名 16.8 + 路径 13.35 + 徽标 13 +
  // padding 6 ≈ 49px）。2026-08-19 修裁切：FILE_H 曾 32px（单行时代的遗留），
  // full 档 49px / compact 档 36px 都放不下，路径行+徽标行被 overflow:hidden 吃掉，
  // 观感即「xml 等文件实体高度不够」。DIR_H 52→56 同理给目录行留出 AI 药丸换行余量。
  // 行距按内容需要给足，宁可多滚一屏。buildTreeGuide 完全基于 rows 几何，自动适配。
  const DIR_H = 56;
  const FILE_H = 52;
  // 图片叶子行：代码文件行只有 52px，缩略图挤不出来。给图片一档更方的尺寸，
  // 目录树画像里图片资源直接以图示人（口径与画布同步的 fileKind.IMAGE_NODE_* 同源）。
  const IMG_ROW_H = 112;
  const IMG_ROW_W = 168;
  const ROW_GAP = 8;
  const MIN_W = 190;
  const MAX_W = 470;
  // 文件叶子保护：主目录树开文件时全树文件数可能上千，必须封顶防止画布爆炸
  const MAX_FILE_LEAVES = 600;
  const MAX_FILES_PER_DIR = 20;

  const maxLines = Math.max(...nodes.map((n) => n.totalLines), 1);

  // 取某目录直属文件（与 directoryTree.dirOf 同源）
  const dirOf = (relPath: string) => {
    const i = relPath.lastIndexOf('/');
    return i < 0 ? '' : relPath.slice(0, i);
  };
  const filesByDir = new Map<string, typeof pst.files>();
  if (includeFiles) {
    for (const f of pst.files) {
      if (f.isDirectory) continue;
      const d = dirOf(f.relPath);
      const arr = filesByDir.get(d);
      if (arr) arr.push(f);
      else filesByDir.set(d, [f]);
    }
  }

  // ─── 第一趟：只算布局，不碰 store ───
  //
  // 原实现对每个节点调 place() → addComponent()，而 addComponent 每次都要
  // structuredClone 整个 components 数组做历史快照。目录树开文件时节点数可达
  // 760，累计克隆量 O(N²)（约 29 万个对象），主线程一冻就是十几秒 —— 这正是
  // 「点排序之后目录树再也画不出来」的真身：不是没渲染，是卡在克隆里回不来。
  // 现在改成先纯计算布局，再 addComponentsBulk 一次性入库、只记一条历史。
  interface LaidOutRow {
    x: number;
    y: number;
    w: number;
    h: number;
    /** 父目录路径，用于连线；根节点为 null */
    parentPath: string | null;
    /** 自身路径（目录行才有，文件行用所属目录路径 + 文件名保证唯一） */
    path: string;
  }
  const items: BulkComponentInput[] = [];
  const rows: LaidOutRow[] = [];
  /** path → 该行在 rows 中的下标（连线时按父路径回查几何） */
  const rowIndexByPath = new Map<string, number>();

  let fileLeaves = 0;
  let hiddenFilesTotal = 0;
  let cursorY = TOP;

  // 父目录路径：nodes 是先序遍历结果，靠 path 前缀即可定位父节点
  const parentPathOf = (p: string): string | null => {
    if (!p) return null;
    const i = p.lastIndexOf('/');
    return i < 0 ? '' : p.slice(0, i);
  };

  for (const n of nodes) {
    const effDepth = Math.max(0, n.depth - baseDepth);
    const x = LEFT + effDepth * INDENT;
    const y = cursorY;
    cursorY += DIR_H + ROW_GAP;
    // 宽度按行数占比开方压缩：线性映射会让 src/ 独占全宽、其余全部贴下限
    const ratio = Math.sqrt(n.totalLines / maxLines);
    const w = Math.round(MIN_W + (MAX_W - MIN_W) * ratio);

    rowIndexByPath.set(n.path, rows.length);
    rows.push({
      x,
      y,
      w,
      h: DIR_H,
      parentPath: n === target ? null : parentPathOf(n.path),
      path: n.path,
    });
    items.push({
      type: 'folder',
      name: n.name,
      x,
      y,
      width: w,
      height: DIR_H,
      locked: true,
      config: {
        name: n.name,
        dirPath: n.path,
        depth: n.depth,
        // childCount 沿用旧字段名（FolderRenderer 既有契约）：直属条目数
        childCount: n.directFiles + n.childDirCount,
        directFiles: n.directFiles,
        childDirCount: n.childDirCount,
        fileCount: n.fileCount,
        totalLines: n.totalLines,
        avgComplexity: n.avgComplexity,
        maxComplexity: n.maxComplexity,
        complexityLevel: n.complexityLevel,
        techDebtCount: n.techDebtCount,
        findingCount: n.findingCount,
        cloneCount: n.cloneCount,
        dominantLanguage: n.dominantLanguage,
        languageShare: n.languages.slice(0, 4),
        portraitMode: 'directory' as PortraitMode,
        searchMatched: q ? matched.has(n.path) : undefined,
      },
    });

    // 文件叶子：紧贴各自目录下方、缩进再深一级；带全树/每目录上限保护
    if (includeFiles && fileLeaves < MAX_FILE_LEAVES) {
      const dirFiles = filesByDir.get(n.path);
      if (dirFiles && dirFiles.length > 0) {
        let list = dirFiles.slice(0, MAX_FILES_PER_DIR);
        // 搜索模式：文件叶子按文件名过滤，与目录搜索口径一致
        if (q) list = list.filter((f) => f.name.toLowerCase().includes(q));
        const more = dirFiles.length - list.length;
        hiddenFilesTotal += more;
        for (const f of list) {
          if (fileLeaves >= MAX_FILE_LEAVES) break;
          // 图片资源另走 image 实体：52px 的代码文件行放不下缩略图，给它 IMG_ROW_H 一档，
          // 目录树画像里 icon/png/svg 才是「看得见的图」而不是又一行文字。
          const entityType = entityTypeForFile(f);
          const isImg = entityType === 'image';
          const rowH = isImg ? IMG_ROW_H : FILE_H;
          const rowW = Math.max(160, w - INDENT);
          const fx = LEFT + (effDepth + 1) * INDENT;
          const fy = cursorY;
          cursorY += rowH + ROW_GAP;
          fileLeaves += 1;
          rows.push({
            x: fx,
            y: fy,
            w: rowW,
            h: rowH,
            parentPath: n.path,
            path: `${n.path}\u0000${f.relPath}`,
          });
          const ins = insights.get(f.id) ?? emptyFileInsight();
          items.push({
            type: entityType,
            name: f.name,
            x: fx,
            y: fy,
            width: isImg ? Math.min(rowW, IMG_ROW_W) : rowW,
            height: rowH,
            locked: true,
            config: fileConfig(f, ins, 'directory', {
              fromDirectory: true,
              // 目录树是结构视图：保留 R38 语言色身份条，不把低复杂度文件刷成绿色热力底
              complexity: 0,
              complexityLevel: 'low',
              complexityEngine: undefined,
              lineCount: f.lineCount ?? 0,
            } as Record<string, unknown>),
          });
        }
      }
    }
  }

  // ─── 树形连线：把「缩进」升级成看得见的父子归属 ───
  //
  // 只用缩进表达层级，列一多就得靠数像素猜谁是谁的孩子。这里补上文件浏览器
  // 式的直角引导线：父节点下方一条竖干，每个子节点一条横枝。
  // 全部段落塞进 **一个** 实体（一张 SVG），而不是每条线一个实体 ——
  // 后者会让实体数翻倍，把刚省下来的性能又还回去。
  const guide = buildTreeGuide(rows, rowIndexByPath, INDENT);
  if (guide) {
    guide.locked = true; // 引导线是背景装饰，禁用拖动
    items.unshift(guide); // 放最前 = DOM 最先渲染 = 压在实体底下
  }

  const ids = useEditorStore.getState().addComponentsBulk(items);
  const placed = ids.length;

  await persist(analysisId, 'directory');

  const deepest = nodes.reduce((a, b) => (b.depth > a.depth ? b : a), nodes[0]);
  const hottest = [...nodes].filter((n) => n.depth > 0).sort((a, b) => b.avgComplexity - a.avgComplexity)[0];

  const scopeFileCount = scopeDir ? target.fileCount : root.fileCount;
  const scopeLines = scopeDir ? target.totalLines : root.totalLines;
  const scopeNote = scopeDir ? t('portrait.msg.dirScope', { dir: scopeDir }) : '';
  const sortLabel = {
    size: t('portrait.msg.sortSize'),
    name: t('portrait.msg.sortName'),
    path: t('portrait.msg.sortPath'),
  }[opts?.sort ?? 'size'];
  const searchNote = q ? t('portrait.msg.dirSearch', { q: opts!.search ?? '' }) : '';
  const sortNote = t('portrait.msg.sortNote', { s: sortLabel });
  const fileNote = includeFiles
    ? t('portrait.msg.dirFileLeaves', {
        n: fileLeaves,
        hidden: hiddenFilesTotal > 0 ? t('portrait.msg.dirHidden', { n: hiddenFilesTotal }) : '',
      })
    : '';
  const truncNote = flat.truncated ? t('portrait.msg.dirTrunc', { a: flat.shownDirs, b: flat.totalDirs }) : '';
  return {
    ok: true,
    message:
      t('portrait.msg.dirDone', {
        n: nodes.length,
        search: searchNote,
        sort: sortNote,
        files: fileNote,
        scope: scopeNote,
        fc: scopeFileCount,
        lines: scopeLines.toLocaleString(),
      }) +
      truncNote +
      t('portrait.msg.dirDeep', { depth: deepest.depth }) +
      (hottest && hottest.avgComplexity > 0
        ? t('portrait.msg.dirHottest', { path: hottest.path, avg: hottest.avgComplexity })
        : '') +
      (flat.truncated ? t('portrait.msg.dirDrill') : '') +
      '）',
    severity: 'success',
    placed,
  };
}

/**
 * 目录树下钻：双击画布上的目录实体 → 在【旁边新开一个独立可关视图】渲染该目录的子树。
 * 复用 handlePortrait 同款的「addView + 渲染 + 失败自动清理空标签」逻辑，
 * 与 §「每个画像独立视图」体验一致。目录树（id=default）永远保留，不受影响。
 */
export async function openDirectorySubtree(dirPath: string, analysisId: string): Promise<PortraitOutcome> {
  const editor = useEditorStore.getState();
  editor.beginBatch();
  resetPending();
  try {
    const baseName = dirPath === '' ? t('portrait.msg.rootDir') : dirPath.split('/').pop() || dirPath;
    const taken = new Set(editor.views.map((v) => v.name));
    let name = t('portrait.msg.dirView', { name: baseName });
    for (let i = 2; taken.has(name); i++) name = t('portrait.msg.dirViewN', { name: baseName, n: i });
    const newViewId = editor.addView(name);
    const outcome = await runDirectoryPortrait(analysisId, dirPath || undefined, {
      includeFiles: true,
      // 下钻子树继承当前排序维度，与主目录树保持一致（不再永远按 size 排）
      sort: useEditorStore.getState().directorySort,
    });
    if (!outcome.ok) {
      const st = useEditorStore.getState();
      if (st.views.length > 1) st.removeView(newViewId);
    }
    return outcome;
  } finally {
    editor.endBatch();
  }
}

/**
 * 重新渲染目录树视图：应用 store.directoryShowFiles 当前开关值。
 * 供画布工具栏「显示文件」开关调用 —— 切换后即时重画当前目录树（主目录树）。
 */
export async function rerenderDirectoryTree(analysisId: string): Promise<PortraitOutcome> {
  const st = useEditorStore.getState();
  st.beginBatch();
  resetPending();
  try {
    return runDirectoryPortrait(analysisId, undefined, {
      includeFiles: st.directoryShowFiles,
      search: st.directorySearch || undefined,
      sort: st.directorySort,
    });
  } finally {
    st.endBatch();
  }
}
