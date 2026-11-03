// published 命名空间文案卫生锁 —— B6b（需求 §6/§12 收尾清污）。
//
// 背景：成品页经历「旧登记表可视化 → FinishedPendingBand 止血 → B5a 两级结构」三段历史，
// 上一代页面的文案键（import/move/bulk/group/pending 时代）随组件删除全部悬空。
// packIntegrity 只锁「引用 ⇒ 存在」，堵不住反方向的腐烂：死键堆在包里无人发现，
// 双语占位符漂移（en 改了插值名、zh 没跟上）也无人值守。
// 本锁对 published 命名空间立四个可证伪断言：
//   ① 双语键位集合完全一致；
//   ② 死键零化：每个键都被生产代码以完整字面量引用（新增键不接线即红）；
//   ②b 已退役旧代文案键不得回流；
//   ③ 每个键的中英占位符集合一致。
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zhCN from "../../i18n/zh-CN.json";
import enUS from "../../i18n/en-US.json";

/** src 根目录（相对本文件定位，不依赖 vitest 的工作目录） */
const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 递归收集生产源码（跳过测试与语言包自身，与 packIntegrity 同口径） */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "i18n") continue;
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** 剥注释：注释里的示例 key 不是生产引用（packIntegrity 同款口径） */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const zhPack = (zhCN as { published: Record<string, string> }).published;
const enPack = (enUS as { published: Record<string, string> }).published;
const KEYS = Object.keys(zhPack);

const SOURCE_FILES = collectSourceFiles(SRC_DIR);
const REFERENCED = new Set<string>();
for (const file of SOURCE_FILES) {
  const text = stripComments(readFileSync(file, "utf8"));
  for (const m of text.matchAll(/["'](published\.[A-Za-z0-9_-]+)["']/g)) {
    REFERENCED.add(m[1]);
  }
}

const placeholders = (v: string) => (v.match(/\{\w+\}/g) ?? []).sort().join(",");

describe("published 文案包卫生（B6b 收尾清污）", () => {
  it("扫描面非空：源文件、键数、引用命中数都在合理下限之上（防扫描器失灵假绿）", () => {
    expect(SOURCE_FILES.length, `没扫到源码文件，SRC_DIR=${SRC_DIR} 可能指错了`).toBeGreaterThan(50);
    expect(KEYS.length).toBeGreaterThan(60);
    const hit = KEYS.filter((k) => REFERENCED.has(`published.${k}`)).length;
    expect(hit).toBeGreaterThanOrEqual(60);
  });

  it("① 中英键位集合完全一致（切语言不允许出现空洞）", () => {
    expect(Object.keys(enPack).sort()).toEqual([...KEYS].sort());
  });

  it("② 死键零化：published 每个键都必须被生产代码字面量引用", () => {
    const dead = KEYS.filter((k) => !REFERENCED.has(`published.${k}`));
    expect(dead, `悬空文案键（旧页面残骸或忘接线的键）：\n${dead.map((k) => `published.${k}`).join("\n")}`).toEqual([]);
  });

  it("②b 旧代登记页文案键不得回流（import/move/bulk/group/pending 时代，B6a 退役语义）", () => {
    const RETIRED = [
      "import", "importDialogTitle", "importDialogDesc", "importSelectBook", "importNoBooks",
      "importPickFiles", "importPickLabel", "importPickFailed", "importPickedCount", "importNonePicked",
      "importNeedBook", "importNeedFiles", "importDone", "importFailed", "importing",
      "move", "moveDialogTitle", "moved", "moveFailed",
      "bulkRemove", "confirmBulkRemove", "confirmBulkRemoveDesc", "bulkRevoked", "bulkRemoveFailed",
      "selectedCount", "cancelSelection", "confirmRemove", "confirmRemoveDesc", "removeFailed",
      "pendingTitle", "pendingHint", "revoke", "revoked", "downloading", "reDownload",
      "groupByBook", "groupCount", "groupTotal", "groupSelected", "groupSelectedTotal",
      "expandAll", "collapseAll", "listView", "gridView", "reportSuffix", "exportedOn",
      "fileMissing", "fileMissingHint", "noResults", "noResultsHint", "noneTitle", "noneHint",
      "count", "chip", "allBooks", "allFormats", "sortSize",
    ];
    const revived = RETIRED.filter((k) => k in zhPack || k in enPack);
    expect(revived, `退役文案键回流：${revived.join(", ")}`).toEqual([]);
  });

  it("③ 双语占位符集合逐键一致（插值名漂移 = 对端语言渲染残缺句）", () => {
    for (const key of KEYS) {
      expect(placeholders(enPack[key]), `published.${key} 占位符中英不一致`).toBe(placeholders(zhPack[key]));
    }
  });

  it("正控：已知在用键必须被引用提取器认定（证明提取器本身在工作）", () => {
    expect(REFERENCED.has("published.exportBtn")).toBe(true);
    expect(REFERENCED.has("published.noVersionYet")).toBe(true);
  });
});
