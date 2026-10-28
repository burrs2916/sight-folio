/**
 * 源码扫描画像
 *
 * 安全/API 面/错误处理/日志/注释比 5 个扫描型画像与全部 RE 常量。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { PORTRAIT_THRESHOLDS, CODE_LANGS } from './constants';
import { metricInsight, renderMetricPortrait, type MetricRow } from './metrics';
import { currentInsights, readLines, mapLimit } from './shared';
import { type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { type ProjectFile } from '../../../services/tauri';
import { useProjectStore } from '../../../store/projectStore';


const SECRET_RE = [
  /password\s*[:=]\s*["'][^"'\n]{4,}/i,
  /passwd\s*[:=]\s*["'][^"'\n]{4,}/i,
  /api[_-]?key\s*[:=]\s*["'][A-Za-z0-9_-]{12,}/i,
  /secret\s*[:=]\s*["'][^"'\n]{8,}/i,
  /token\s*[:=]\s*["'][A-Za-z0-9._-]{16,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  /sk-[A-Za-z0-9]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /AKIA[0-9A-Z]{16}/,
];
// 测试 / 示例 / 占位假密钥（sk-test-xxx、apiKey: "example"、your-key 等），不计入硬编码告警
const FAKE_SECRET_RE =
  /(?:test|example|dummy|mock|sample|fake|demo|xxxx|placeholder|your[-_]?key|your[-_]?secret|your[-_]?token)/i;
const UNSAFE_RE = [
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
  /\.dangerouslySetInnerHTML/,
  /innerHTML\s*=/,
  /child_process/,
  /vm\.runInThisContext/,
  /\.execSync\s*\(/,
  /require\(\s*['"]child_process['"]\s*\)/,
];

/** 安全画像：密钥硬编码 + 不安全 API 调用 */
export async function runSecurityPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const insights = currentInsights();
  const src = pst.files.filter(
    (f) => !f.isDirectory && CODE_LANGS.has((f.language || '').toLowerCase()) && f.lineCount > 0 && f.lineCount <= 6000,
  );
  const scanned = await mapLimit(src, 16, async (f) => {
    const lines = await readLines(f);
    if (!lines) return null;
    const hits: string[] = [];
    let secretCount = 0;
    lines.forEach((ln, idx) => {
      let secretHit = false;
      for (const re of SECRET_RE)
        if (re.test(ln)) {
          secretHit = true;
          break;
        }
      // 测试 / 示例 / 占位假密钥不计入硬编码告警
      if (secretHit && !FAKE_SECRET_RE.test(ln)) {
        hits.push(t('portrait.security.secretHit', { line: idx + 1 }));
        secretCount += 1;
      }
      for (const re of UNSAFE_RE)
        if (re.test(ln)) {
          hits.push(t('portrait.security.unsafeHit', { line: idx + 1 }));
          break;
        }
    });
    if (hits.length === 0) return null;
    const secrets = secretCount;
    const unsafe = hits.length - secrets;
    const score = secrets * 3 + unsafe;
    return { f, hits, score };
  });
  const valid = scanned.filter((x): x is { f: ProjectFile; hits: string[]; score: number } => x !== null);
  const rows: MetricRow[] = valid
    .sort((a, b) => b.score - a.score)
    .map(({ f, hits, score }) => {
      const color =
        score >= PORTRAIT_THRESHOLDS.security.red
          ? '#ef4444'
          : score >= PORTRAIT_THRESHOLDS.security.orange
            ? '#f59e0b'
            : '#22c55e';
      return {
        file: f,
        ins: metricInsight(f, insights),
        accentColor: color,
        metricBadge: `⚠${score}`,
        metricTitle: t('portrait.metric.security', {
          n: score,
          sample: hits.slice(0, 4).join('；'),
          more: hits.length > 4 ? '…' : '',
        }),
      };
    });
  return renderMetricPortrait('security', analysisId, rows, {
    cols: 8,
    colW: 200,
    rowH: 78,
    emptyHint: t('portrait.spec.security.empty'),
    summarize: (rs) => t('portrait.spec.security.done', { n: src.length, m: rs.length }),
  });
}

// verb-call style: Express / Koa / Fastify / Hapi / Gin / Axum(.route) ...
const API_RE =
  /(?:\b(?:app|router|server|api|res|req|fastify|koa|hapi|engine|http|client|db|conn|pool|srv|web|bp|blueprint|r|e)\.(?:get|post|put|delete|patch|head|options|all|route)\s*\(\s*['"`][^'"`]+['"`])/i;
// decorator style: Spring / Nest / FastAPI(@app.route) / Flask(@router.get) ...
const API_DECORATOR =
  /@(?:Get|Post|Put|Delete|Patch|Head|Options|RequestMapping|app\.route|router\.(?:get|post|put|delete|patch)|\w+\.(?:get|post|put|delete|patch))\b[^)]*\(/;
// Next.js / Remix route handlers: `export async function GET(req)`
const API_NEXT =
  /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const)\s+(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/;
// GraphQL / tRPC: type Query|Mutation, createResolver, createRouter().query((
const API_GQL_TRPC =
  /\b(?:type\s+(?:Query|Mutation)|createResolver|defineResolver|createRouter|\.query\(\s*\(|\.mutation\(\s*\()/;
// Laravel / Rails / Symfony: Route::get, resources :x, $router->get
const API_PHP_RB =
  /\b(?:Route::(?:get|post|put|delete|patch)|resources\s+:\w+|\$(?:router|app)->(?:get|post|put|delete|patch))/;

/** 接口暴露面画像：路由/handler 中的 URL 端点 */
export async function runApiSurfacePortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const insights = currentInsights();
  const src = pst.files.filter(
    (f) => !f.isDirectory && CODE_LANGS.has((f.language || '').toLowerCase()) && f.lineCount > 0 && f.lineCount <= 6000,
  );
  const scanned = await mapLimit(src, 16, async (f) => {
    const lines = await readLines(f);
    if (!lines) return null;
    let count = 0;
    const sample: string[] = [];
    for (const ln of lines) {
      const m =
        ln.match(API_RE) ||
        ln.match(API_DECORATOR) ||
        ln.match(API_NEXT) ||
        ln.match(API_GQL_TRPC) ||
        ln.match(API_PHP_RB);
      if (m) {
        count += 1;
        if (sample.length < 3) sample.push(m[0].slice(0, 40));
      }
    }
    if (count === 0) return null;
    return { f, count, sample };
  });
  const valid = scanned.filter((x): x is { f: ProjectFile; count: number; sample: string[] } => x !== null);
  const rows: MetricRow[] = valid
    .sort((a, b) => b.count - a.count)
    .map(({ f, count, sample }) => {
      const color =
        count >= PORTRAIT_THRESHOLDS.apiSurface.red
          ? '#ef4444'
          : count >= PORTRAIT_THRESHOLDS.apiSurface.orange
            ? '#f59e0b'
            : '#22c55e';
      return {
        file: f,
        ins: metricInsight(f, insights),
        accentColor: color,
        metricBadge: `API${count}`,
        metricTitle: t('portrait.metric.apiSurface', {
          n: count,
          sample: sample.length ? t('portrait.metric.apiSample', { s: sample.join('；') }) : '',
        }),
      };
    });
  return renderMetricPortrait('apiSurface', analysisId, rows, {
    cols: 8,
    colW: 200,
    rowH: 78,
    emptyHint: t('portrait.spec.apiSurface.empty'),
    summarize: (rs) => {
      const total = valid.reduce((a, b) => a + b.count, 0);
      return t('portrait.spec.apiSurface.done', { n: rs.length, total });
    },
  });
}

// 多行匹配：catch(...) { 块内仅空白/注释 = 空 catch（覆盖单行与多行块）
const EMPTY_CATCH_RE =
  /catch\s*\([^)]*\)\s*\{[ \t]*?(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/|\n[ \t]*?)*?\}\s*(?=catch|finally|;|\)|\n[^\s]|$)/g;
// 多行匹配：catch 块内只做 return null/undefined / continue / console.log|debug / logger.info|debug / pass = 吞异常
const SWALLOW_RE =
  /catch\s*\([^)]*\)\s*\{[\s\S]*?\b(?:return\s+(?:null|undefined)|;\s*pass\b|continue\b|logger\.(?:debug|info)\b|console\.(?:log|debug)\b)[\s\S]*?\}\s*(?=catch|finally|;|\)|\n[^\s]|$)/g;

/**
 * 去掉源码里的注释与字符串字面量，让 catch/console/logger 等关键词只在「真实代码」上匹配，
 * 消除它们出现在注释、JSDoc、字符串字面量里造成的误报。仅用于「是否存在某模式」的计数，
 * 不改行号/结构。保护 `://`（URL 协议分隔）不被当行注释误删。
 */
function stripCommentsAndStrings(code: string): string {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    const c2 = code[i + 1];
    if (c === '/' && c2 === '/' && (i === 0 || code[i - 1] !== ':')) {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        if (code[i] === '\\') {
          i += 2;
          continue;
        }
        if (code[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 错误处理画像：空 catch / 吞异常 */
export async function runErrorHandlingPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const insights = currentInsights();
  const src = pst.files.filter(
    (f) => !f.isDirectory && CODE_LANGS.has((f.language || '').toLowerCase()) && f.lineCount > 0 && f.lineCount <= 6000,
  );
  const scanned = await mapLimit(src, 16, async (f) => {
    const lines = await readLines(f);
    if (!lines) return null;
    const text = stripCommentsAndStrings(lines.join('\n'));
    const empty = (text.match(EMPTY_CATCH_RE) || []).length;
    const swallow = (text.match(SWALLOW_RE) || []).length;
    const total = empty + swallow;
    if (total === 0) return null;
    return { f, empty, swallow };
  });
  const valid = scanned.filter((x): x is { f: ProjectFile; empty: number; swallow: number } => x !== null);
  const rows: MetricRow[] = valid
    .sort((a, b) => b.empty + b.swallow - (a.empty + a.swallow))
    .map(({ f, empty, swallow }) => {
      const total = empty + swallow;
      const color =
        total >= PORTRAIT_THRESHOLDS.errorHandling.red
          ? '#ef4444'
          : total >= PORTRAIT_THRESHOLDS.errorHandling.orange
            ? '#f59e0b'
            : '#22c55e';
      return {
        file: f,
        ins: metricInsight(f, insights),
        accentColor: color,
        metricBadge: `∅${total}`,
        metricTitle: t('portrait.metric.errorHandling', { e: empty, s: swallow }),
      };
    });
  return renderMetricPortrait('errorHandling', analysisId, rows, {
    cols: 8,
    colW: 200,
    rowH: 78,
    emptyHint: t('portrait.spec.errorHandling.empty'),
    summarize: (rs) => {
      const total = valid.reduce((a, b) => a + b.empty + b.swallow, 0);
      return t('portrait.spec.errorHandling.done', { n: rs.length, total });
    },
  });
}

/* ─── 日志卫生画像（R42）：console.* 泄漏 / logger.* 吞掉 / 裸 console 调试输出 ─── */

// 生产代码里不应出现的裸 console 调试输出（保留 console.error 与注释中的示例）
export const LEAK_CONSOLE_RE = /\bconsole\.(?:log|debug|info|warn|trace)\s*\([^)]*\)/g;

/**
 * 统计「logger.error/fatal 被吞掉」的行数（行级启发式，比纯正则可靠）。
 * 规则：某行调用了 logger.error(...)，其后 3 行内（或到当前块结束）没有
 * throw / return / process.exit / panic! 等处理动作 → 判为吞掉错误。
 */
export function countSwallowedLoggerErrors(lines: string[]): number {
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/logger\.(?:error|fatal)\s*\(/.test(lines[i])) continue;
    const lookahead = lines.slice(i + 1, i + 4).join('\n');
    const handled = /\b(?:throw|return|process\.exit|panic!|std::process::exit|os\.exit|abort)\b/.test(lookahead);
    if (!handled) count += 1;
  }
  return count;
}

/**
 * 日志卫生画像：console.log/debug 泄漏到生产 + logger.error 吞掉不处理。
 * 区分「日志规范性」与 errorHandling 画像 —— 后者只关注 catch 块内吞异常，
 * 这里关注**正常代码路径**里把调试输出留在生产、以及打了 error 日志却无后续动作。
 */
export async function runLoggingPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const insights = currentInsights();
  const src = pst.files.filter(
    (f) => !f.isDirectory && CODE_LANGS.has((f.language || '').toLowerCase()) && f.lineCount > 0 && f.lineCount <= 6000,
  );
  const scanned = await mapLimit(src, 16, async (f) => {
    const lines = await readLines(f);
    if (!lines) return null;
    // 先剥掉注释（//、块注释、JSDoc）与字符串字面量，消除它们内部出现的
    // console/logger 误报；再按行还原并跳过 # 行注释（Python/Ruby/shell）。
    // 仅用于「是否存在某模式」的计数，不改动检测语义。
    const stripped = stripCommentsAndStrings(lines.join('\n'));
    const codeLines = stripped.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
    const code = codeLines.join('\n');
    const leaks = (code.match(LEAK_CONSOLE_RE) || []).length;
    const swallowed = countSwallowedLoggerErrors(codeLines);
    const total = leaks + swallowed;
    if (total === 0) return null;
    return { f, leaks, swallowed };
  });
  const valid = scanned.filter((x): x is { f: ProjectFile; leaks: number; swallowed: number } => x !== null);
  const rows: MetricRow[] = valid
    .sort((a, b) => b.leaks + b.swallowed - (a.leaks + a.swallowed))
    .map(({ f, leaks, swallowed }) => {
      const total = leaks + swallowed;
      const color =
        total >= PORTRAIT_THRESHOLDS.logging.red
          ? '#ef4444'
          : total >= PORTRAIT_THRESHOLDS.logging.orange
            ? '#f59e0b'
            : '#22c55e';
      return {
        file: f,
        ins: metricInsight(f, insights),
        accentColor: color,
        metricBadge: `◉${total}`,
        metricTitle: t('portrait.metric.logging', { l: leaks, s: swallowed }),
      };
    });
  return renderMetricPortrait('logging', analysisId, rows, {
    cols: 8,
    colW: 200,
    rowH: 78,
    emptyHint: t('portrait.spec.logging.empty'),
    summarize: (rs) => {
      const total = valid.reduce((a, b) => a + b.leaks + b.swallowed, 0);
      return t('portrait.spec.logging.done', { n: rs.length, total });
    },
  });
}

/**
 * 注释占比画像：注释率（基于 metrics.commentLines/codeLines，数据已就绪）
 * + 注释掉的死代码（扫描源码：// 与块注释里像代码的行）。
 *
 * 注释掉的死代码是「不敢删的历史遗留」信号——比缺注释更糟：
 * 它既占阅读负担，又暗示作者对删除没有把握。阈值：≥5 行红 / ≥2 行橙。
 */

/** 注释块里的代码特征行（去掉注释前缀后仍像可执行代码） */
const COMMENTED_CODE_RE =
  /^\s*\/\/\s*(?:\b(?:if|for|while|switch|return|throw|const|let|var|function|async|await|try|catch|new|import|export|case|break|continue)\b|.*[;{}]\s*$)/;

export function countCommentedCode(lines: string[]): number {
  let count = 0;
  for (const raw of lines) {
    const t = raw.trim();
    if (!t.startsWith('//')) continue;
    const body = t.replace(/^\/\/\s*/, '');
    // 忽略文档型注释（todo/fixme 说明、中文说明、纯符号分隔）
    if (/^(todo|fixme|hack|note|see|example|deprecated|@\w+)/i.test(body)) continue;
    if (/[\u4e00-\u9fff]/.test(body) && !/[;{}]/.test(body)) continue;
    if (COMMENTED_CODE_RE.test(t)) count += 1;
  }
  return count;
}

/** 注释掉的死代码（导出供测试） */

export async function runCommentRatioPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const insights = currentInsights();
  const metrics = pst.metrics.filter((m) => {
    const f = pst.files.find((x) => x.id === m.fileId);
    return f && !f.isDirectory && m.codeLines + m.commentLines > 0;
  });
  // 需要读源码的文件（可能有注释掉的代码）：全部 code 文件，受并发上限保护
  const src = pst.files.filter(
    (f) => !f.isDirectory && CODE_LANGS.has((f.language || '').toLowerCase()) && f.lineCount > 0 && f.lineCount <= 6000,
  );
  const commentedByFile = new Map<string, number>();
  const scanned = await mapLimit(src, 16, async (f) => {
    const lines = await readLines(f);
    if (!lines) return null;
    const n = countCommentedCode(lines);
    if (n === 0) return null;
    commentedByFile.set(f.id, n);
    return null;
  });
  void scanned;

  const rows: MetricRow[] = metrics
    .map((m) => {
      const f = pst.files.find((x) => x.id === m.fileId)!;
      const total = m.codeLines + m.commentLines;
      const ratio = total > 0 ? Math.round((m.commentLines / total) * 100) : 0;
      const commented = commentedByFile.get(f.id) ?? 0;
      // 双信号：注释率 <5% 或注释掉的代码 ≥2 行即需关注
      const red = ratio < 5 || commented >= 5;
      const orange = !red && (ratio < 15 || commented >= 2);
      const color = red ? '#ef4444' : orange ? '#f59e0b' : '#22c55e';
      return {
        file: f,
        ins: metricInsight(f, insights),
        accentColor: color,
        metricBadge: ratio + '%' + (commented > 0 ? t('trend.metric.blockedSuffix', { n: commented }) : ''),
        metricTitle:
          commented > 0
            ? t('portrait.metric.commentRatioWithBlocked', { pct: ratio, c: m.commentLines, t: total, n: commented })
            : t('portrait.metric.commentRatio', { pct: ratio, c: m.commentLines, t: total }),
      };
    })
    .filter((r) => r.accentColor !== '#22c55e') // 只列出需要关注的文件
    .sort((a, b) => {
      const ra = (a.file as ProjectFile).lineCount;
      const rb = (b.file as ProjectFile).lineCount;
      return rb - ra;
    });
  return renderMetricPortrait('commentRatio', analysisId, rows, {
    cols: 8,
    colW: 200,
    rowH: 78,
    emptyHint: t('portrait.spec.commentRatio.empty'),
    summarize: (rs) => {
      const bad = rs.filter((r) => r.accentColor === '#ef4444').length;
      const blocked = rs.filter((r) => (r.metricBadge || '').includes('块')).length;
      return t('portrait.spec.commentRatio.done2', { n: rs.length, bad, blocked });
    },
  });
}
