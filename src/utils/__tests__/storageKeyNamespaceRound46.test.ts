// 回归锁（2026-11-04 全仓删除账 N1）：**任何往 web storage 写值的键，都必须落在受保护命名空间里**。
//
// 病灶复盘：`cleanupDisallowedKeys()` 由 authStore 每次启动调用，按白名单遍历删除
// 整个 localStorage + sessionStorage。11-03 补保护前缀时只登记了冒号家族 `sight-folio:`，
// 漏了点号家族 `sight-folio.` → AI 风格一致性开关每次启动被删；
// 完结作品页的裸键 `published-search-query` 同理（观感是「搜索框记不住上次打的字」）。
// 这类 bug 肉眼看不见：冒号与点号只差一个字符，审查时极易放过。
//
// 口径：**判定直接用真的 isCacheKeyAllowed**，绝不在测里复制一份规则——
// 复制规则等于再造一个真源分身，改一边漏一边，锁就成了摆设。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import { isCacheKeyAllowed, cleanupDisallowedKeys } from '../cacheWhitelist';

/** 走 helper 写入、静态扫不出键名的落点：逐条登记「文件 → 理由」。新增必须写清理由，否则锁红。 */
const HELPER_WRITE_SITES: Record<string, string> = {
  'src/pages/writingPage/WritingDrawer.tsx': 'writePref(key, …) 的调用点都传 sight-folio:writing.* 常量',
  'src/store/authStore.ts': '认证域自己的 tokenKey / refreshKey —— 清扫对象本就是它自己的键',
  'src/utils/writingCrashRecovery.ts': 'draftKey(bookId) → sight-folio:writing-draft:*',
  'src/store/codeWorkbenchStore.ts': 'layoutKey(aid) → workbench.layout.*',
  'src/pages/writingPage/AiCorpusPanel.tsx': 'DRAFT_KEY_PREFIX / GEN_KEY_PREFIX → sight-folio:…',
  'src/editor/panels/workbenchPanelHooks.ts':
    'composerSkipKey(convId) → ps.workbench.composerSkip:*（11-04 从不受保护的 ps- 前缀搬进来）',
};

const root = `${process.cwd()}/src`;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = `${dir}/${name}`;
    if (statSync(abs).isDirectory()) {
      if (name === '__tests__') continue;
      walk(abs, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(abs);
    }
  }
  return out;
}

const files = walk(root);
const sourceOf = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

/** 全仓 KEY/PREFIX 常量表，用于把 setItem(k, …) 里的标识符解析成字面量。 */
function buildConstTable(): Map<string, string> {
  const table = new Map<string, string>();
  // 只需要源码本身，不解构文件名（留着未用变量会被 lint 挑）
  for (const source of sourceOf.values()) {
    for (const m of source.matchAll(
      /(?:const|export const)\s+([A-Za-z0-9_]*(?:KEY|PREFIX)[A-Za-z0-9_]*)\s*(?::\s*string)?\s*=\s*['"`]([^'"`\n$]+)['"`]/g,
    )) {
      if (!table.has(m[1])) table.set(m[1], m[2]);
    }
  }
  return table;
}

interface Site {
  where: string;
  file: string;
  key: string | null;
}

function collectWriteSites(consts: Map<string, string>): Site[] {
  const sites: Site[] = [];
  for (const [f, s] of sourceOf) {
    for (const m of s.matchAll(/(?:localStorage|sessionStorage)\.setItem\(\s*([^,]+?)\s*,/g)) {
      const expr = m[1].trim();
      const line = s.slice(0, m.index).split('\n').length;
      let key: string | null;
      if (/^['"][A-Za-z0-9._:-]+['"]$/.test(expr)) {
        key = expr.slice(1, -1);
      } else if (expr.startsWith('`')) {
        // 模板串：取 ${ 之前的静态段（前缀写在静态段里就算解析成功）
        const head = expr.replace(/^`/, '').split('${')[0];
        key = head.length > 0 ? head : null;
      } else if (/^[A-Za-z0-9_]+$/.test(expr) && consts.has(expr)) {
        key = consts.get(expr) ?? null;
      } else {
        key = null; // 走 helper / 变量，静态无解 → 必须在 HELPER_WRITE_SITES 登记
      }
      sites.push({
        where: `${f.replace(`${process.cwd()}/`, '')}:${line}`,
        file: f.replace(`${process.cwd()}/`, ''),
        key,
      });
    }
  }
  return sites;
}

const consts = buildConstTable();
const sites = collectWriteSites(consts);

describe('源码扫描锁：写进 web storage 的键必须受保护（N1 回归）', () => {
  it('静态可解析的键全部落在保护命名空间 / 白名单内', () => {
    const offenders = sites.filter((s) => s.key !== null && !isCacheKeyAllowed(s.key));
    expect(offenders.map((o) => `${o.where} → ${o.key}`)).toEqual([]);
  });

  it('静态解析不出的写入点必须逐条登记理由，登记不许失效', () => {
    const unregistered = sites.filter((s) => s.key === null && !(s.file in HELPER_WRITE_SITES));
    expect(unregistered.map((o) => o.where)).toEqual([]);
    const stale = Object.keys(HELPER_WRITE_SITES).filter((f) => !sites.some((s) => s.file === f && s.key === null));
    expect(stale).toEqual([]);
  });

  it('锁本身要吃得到东西（防止扫描器空转给出假绿）', () => {
    expect(sites.length).toBeGreaterThan(15);
    expect(sites.filter((s) => s.key !== null).length).toBeGreaterThan(10);
  });
});

describe('行为锁：点号家族键扛得住启动清扫，杂键照样被清', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('sight-folio. 点号家族的键在清扫后仍存活', () => {
    const key = 'sight-folio.writing.styleConsistency';
    window.localStorage.setItem(key, '0');
    cleanupDisallowedKeys();
    expect(window.localStorage.getItem(key)).toBe('0');
  });

  it('完结作品页搜索键搬进命名空间后存活，旧裸键不再被本模块当作正当键', () => {
    const moved = 'sight-folio:published.searchQuery';
    window.localStorage.setItem(moved, '长夜');
    cleanupDisallowedKeys();
    expect(window.localStorage.getItem(moved)).toBe('长夜');
    // 旧裸键属于「非白名单」：认证清扫依旧会清它（迁移由页面自己完成，不靠清扫放行）
    expect(isCacheKeyAllowed('published-search-query')).toBe(false);
  });

  it('清扫本身的职责没被削弱：杂键仍然被删', () => {
    window.localStorage.setItem('zz-stray-key', 'x');
    cleanupDisallowedKeys();
    expect(window.localStorage.getItem('zz-stray-key')).toBeNull();
  });
});
