#!/usr/bin/env node
/**
 * 无主代码可达性扫描器 v2（清理轮专用，只读）
 *
 * v1 用正则抽 import，实测有两个假阴性（src/editor/registerWritingWorkbench.ts、
 * src/utils/techDebtScore.ts 明明被 import 却报不可达）——懒匹配会跨语句吞边。
 * v2 改用 TypeScript 编译器本体的 ts.preProcessFile，import / export-from /
 * 动态 import / require / 副作用 import 全部由官方解析，不再自造正则。
 *
 * 判据（任务书红线 2/3）：
 *   应用图根 = index.html <script> + tauri.conf.json 窗口 url + *.d.ts 环境声明
 *   测试图根 = vitest include 命中的测试文件 + setupFiles
 *   不做时间判据。
 *
 * 用法: node docs/archive/reachability-scan.mjs
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(ROOT, "src");
const OUT_TXT = path.join(ROOT, "docs/archive/reachability-report.txt");
const OUT_JSON = path.join(ROOT, "docs/archive/reachability-unreached.json");

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const allSrc = walk(SRC);
const isSource = (p) => /\.(tsx?|jsx?|mjs|cjs|json|css|scss|svg|png|jpg|jpeg|webp|gif|woff2?|ttf|otf|txt|md)$/.test(p);

/** 用 TS 解析器抽出一个文件引用的所有模块说明符 */
function importedSpecs(file) {
  const code = fs.readFileSync(file, "utf8");
  const info = ts.preProcessFile(code, true, true);
  return info.importedFiles.map((i) => i.fileName);
}

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null; // 裸包 / 别名（本项目无别名）
  const base = spec.startsWith("/") ? path.join(ROOT, spec) : path.resolve(path.dirname(fromFile), spec);
  const cands = [base];
  for (const e of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".svg", ".png"]) cands.push(base + e);
  for (const e of [".ts", ".tsx", ".js", ".jsx"]) cands.push(path.join(base, "index" + e));
  for (const c of cands) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {}
  }
  return null;
}

/** BFS，返回 Map<absPath, 来源说明> */
function traverse(roots) {
  const seen = new Map();
  const q = [];
  for (const { file, why } of roots) {
    const abs = path.resolve(file);
    if (!seen.has(abs)) {
      seen.set(abs, why);
      q.push(abs);
    }
  }
  const unresolved = [];
  const opaque = [];
  while (q.length) {
    const f = q.shift();
    if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(f)) continue; // 二进制/样式/json 不继续解析
    let specs;
    try {
      specs = importedSpecs(f);
    } catch {
      continue;
    }
    for (const spec of specs) {
      if (spec.includes("${")) {
        opaque.push({ from: rel(f), spec });
        continue;
      }
      const r = resolveSpec(f, spec);
      if (!r) {
        if (spec.startsWith(".")) unresolved.push({ from: rel(f), spec });
        continue;
      }
      const abs = path.resolve(r);
      if (!seen.has(abs)) {
        seen.set(abs, `import in ${rel(f)}`);
        q.push(abs);
      }
    }
  }
  return { seen, unresolved, opaque };
}

// ---------- 根 ----------
const appRoots = [];
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
  const r = resolveSpec(path.join(ROOT, "index.html"), m[1]);
  if (r) appRoots.push({ file: r, why: "index.html <script>" });
}
const tauriConf = path.join(ROOT, "src-tauri/tauri.conf.json");
if (fs.existsSync(tauriConf)) {
  for (const m of fs.readFileSync(tauriConf, "utf8").matchAll(/"(?:url|devUrl|frontendDist)":\s*"([^"]+)"/g)) {
    let u = m[1];
    if (/^https?:/.test(u)) continue;
    if (!u.startsWith("/")) u = "/" + u;
    const r = resolveSpec(path.join(ROOT, "x"), u);
    if (r) appRoots.push({ file: r, why: "tauri.conf.json" });
  }
}
// 环境声明文件（tsconfig include，不靠 import 生效）
for (const f of allSrc) {
  if (/\.d\.ts$/.test(f)) appRoots.push({ file: f, why: "ambient d.ts (tsconfig include)" });
}

// 测试图根：vitest include = src/**/*.{test,spec}.{ts,tsx}
const testRoots = [];
for (const f of allSrc) {
  if (/\.(test|spec)\.(ts|tsx)$/.test(f)) testRoots.push({ file: f, why: "vitest include" });
}
const vitestConf = path.join(ROOT, "vitest.config.ts");
if (fs.existsSync(vitestConf)) {
  for (const m of fs.readFileSync(vitestConf, "utf8").matchAll(/setupFiles:\s*\[([^\]]*)\]/g)) {
    for (const s of m[1].matchAll(/["']([^"']+)["']/g)) {
      const r = resolveSpec(vitestConf, s[1]);
      if (r) testRoots.push({ file: r, why: "vitest setupFiles" });
    }
  }
}

const app = traverse(appRoots);
const test = traverse(testRoots);

// 测试图里"额外"可达的（应用图不可达、但测试图可达）
const appReached = app.seen;
const extraByTest = new Map();
for (const [f, why] of test.seen) if (!appReached.has(f)) extraByTest.set(f, why);

const allAbs = allSrc.map((f) => path.resolve(f));
const dead = allAbs.filter((f) => !appReached.has(f) && !test.seen.has(f));
const testOnly = allAbs.filter((f) => !appReached.has(f) && test.seen.has(f));

const lines = [];
const L = (s = "") => lines.push(s);
L("# 无主代码可达性扫描报告 v2（TS 官方解析器）");
L(`生成: ${new Date().toISOString()}  commit: ${fs.existsSync(path.join(ROOT, ".git")) ? "见 git log" : "-"}`);
L(`应用图根: ${appRoots.map((r) => `${rel(r.file)}(${r.why})`).slice(0, 6).join(", ")} …共 ${appRoots.length}`);
L(`测试图根: ${testRoots.length} 个`);
L(`src 文件 ${allSrc.length} | 应用可达 ${appReached.size} | 测试额外 ${extraByTest.size} | 两图皆不可达 ${dead.length}`);
L();
L("## A. 两图皆不可达（真无主候选）");
for (const f of dead) L(`  ${rel(f)}  ${fs.readFileSync(f, "utf8").split("\n").length} 行`);
L();
L("## B. 仅测试可达（应用不可达，测试可能随之消亡）");
for (const f of testOnly) L(`  ${rel(f)}  ${fs.readFileSync(f, "utf8").split("\n").length} 行  ← ${test.seen.get(path.resolve(f))}`);
L();
L("## C. 模板串动态 import（静态不可判定）");
for (const o of [...app.opaque, ...test.opaque]) L(`  ${o.from} -> \`${o.spec}\``);
L();
L("## D. 仓库内解析失败");
for (const u of [...app.unresolved, ...test.unresolved]) L(`  ${u.from} -> ${u.spec}`);

fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");
fs.writeFileSync(
  OUT_JSON,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      dead: dead.map((f) => ({ path: rel(f), lines: fs.readFileSync(f, "utf8").split("\n").length })),
      testOnly: testOnly.map((f) => ({ path: rel(f), lines: fs.readFileSync(f, "utf8").split("\n").length })),
      opaque: [...app.opaque, ...test.opaque],
      unresolved: [...app.unresolved, ...test.unresolved],
    },
    null,
    2
  ) + "\n"
);

console.log(lines.join("\n"));
