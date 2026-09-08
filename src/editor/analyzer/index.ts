// project-sight: 分析器插件体系（Analyzer 注册表 + 内置插件）
// 对应需求文档 §4 分析器插件体系。核心引擎通用，每种语言一个插件。

export * from "./types";
export * from "./analyzerRegistry";
export * from "./typescriptAnalyzer";
export * from "./rustAnalyzer";
export * from "./pythonAnalyzer";
export * from "./goAnalyzer";
export * from "./javaAnalyzer";
export * from "./cppAnalyzer";
export * from "./javascriptAnalyzer";
export * from "./vueAnalyzer";
export * from "./kotlinAnalyzer";
export * from "./phpAnalyzer";
export * from "./rubyAnalyzer";
export * from "./swiftAnalyzer";
export * from "./csharpAnalyzer";
export * from "./svelteAnalyzer";

import type { ReviewRule } from "../../services/tauri";
import { projectScanApi } from "../../services/tauri";
import { analyzerRegistry } from "./analyzerRegistry";
import type { AnalyzerManifest, RuleRegistration } from "./types";
import { typescriptAnalyzerManifest } from "./typescriptAnalyzer";
import { rustAnalyzerManifest } from "./rustAnalyzer";
import { pythonAnalyzerManifest } from "./pythonAnalyzer";
import { goAnalyzerManifest } from "./goAnalyzer";
import { javaAnalyzerManifest } from "./javaAnalyzer";
import { cppAnalyzerManifest } from "./cppAnalyzer";
import { javascriptAnalyzerManifest } from "./javascriptAnalyzer";
import { vueAnalyzerManifest } from "./vueAnalyzer";
import { kotlinAnalyzerManifest } from "./kotlinAnalyzer";
import { phpAnalyzerManifest } from "./phpAnalyzer";
import { rubyAnalyzerManifest } from "./rubyAnalyzer";
import { swiftAnalyzerManifest } from "./swiftAnalyzer";
import { csharpAnalyzerManifest } from "./csharpAnalyzer";
import { svelteAnalyzerManifest } from "./svelteAnalyzer";

/**
 * 注册全部内置分析器插件。
 * 在 registerBuiltinComponents() 中调用，随应用启动加载。
 * 插件生命周期：加载 → 注册实体/视角/图层/事件/规则 → 就绪
 */
export function registerDefaultAnalyzers(): void {
  // Tier 1：tree-sitter AST 级解析
  analyzerRegistry.register(typescriptAnalyzerManifest);   // TypeScript/JSX
  analyzerRegistry.register(rustAnalyzerManifest);         // Rust
  analyzerRegistry.register(pythonAnalyzerManifest);       // Python
  analyzerRegistry.register(javascriptAnalyzerManifest);   // JavaScript
  analyzerRegistry.register(vueAnalyzerManifest);          // Vue SFC
  // Tier 2：正则符号提取 + import 解析
  analyzerRegistry.register(goAnalyzerManifest);           // Go
  analyzerRegistry.register(javaAnalyzerManifest);         // Java
  analyzerRegistry.register(cppAnalyzerManifest);          // C/C++
  analyzerRegistry.register(kotlinAnalyzerManifest);       // Kotlin
  analyzerRegistry.register(phpAnalyzerManifest);          // PHP
  analyzerRegistry.register(rubyAnalyzerManifest);         // Ruby
  analyzerRegistry.register(swiftAnalyzerManifest);        // Swift
  analyzerRegistry.register(csharpAnalyzerManifest);        // C#
  analyzerRegistry.register(svelteAnalyzerManifest);        // Svelte（识别级支持）
}

/**
 * 别名感知的语言匹配：比较后端返回的小写语言 id 与插件 manifest.language（小写）
 * 或 manifest.languageAliases（小写列表）。例如后端 "cpp"/"c" 可匹配 manifest.language="C/C++"
 * 且 languageAliases=["cpp","c"] 的插件。
 */
function analyzerMatchesLanguage(
  manifest: AnalyzerManifest,
  lang: string
): boolean {
  const l = lang.toLowerCase();
  if (manifest.language.toLowerCase() === l) return true;
  return (manifest.languageAliases ?? []).some((a) => a.toLowerCase() === l);
}

/**
 * 按语言自动识别并激活分析器插件。
 * 语言名不区分大小写（后端 detect_language 返回小写，如 "typescript"；
 * 插件 manifest.language 为首字母大写，如 "TypeScript"，或通过 languageAliases 声明别名）。
 * 找不到对应插件时返回 false，不改变当前激活状态。
 */
export function activateAnalyzerForLanguage(language: string | null | undefined): boolean {
  if (!language) return false;
  const lang = language.toLowerCase();
  const analyzer = analyzerRegistry
    .getAllAnalyzers()
    .find((a) => analyzerMatchesLanguage(a, lang));
  if (!analyzer) {
    console.log(`[Analyzer] 未找到语言 "${language}" 对应的分析器插件，保持当前插件`);
    return false;
  }
  analyzerRegistry.setActiveAnalyzer(analyzer.id);
  console.log(`[Analyzer] 自动识别语言 "${language}" → 激活插件 "${analyzer.id}"`);
  return true;
}

/**
 * 混合项目批量识别：一个项目通常包含多种语言/脚本（TS + Python + Shell + SQL …），
 * 对每种语言自动激活其对应分析器插件（可同时激活多个，不改变主插件）。
 * @returns 已激活的插件语言列表 + 无对应插件的语言列表
 */
export function activateAnalyzersForLanguages(
  languages: (string | null | undefined)[]
): { activated: string[]; missing: string[] } {
  const seen = new Set<string>();
  const activated: string[] = [];
  const missing: string[] = [];
  for (const lang of languages) {
    if (!lang) continue;
    const l = lang.toLowerCase();
    if (seen.has(l)) continue;
    seen.add(l);
    const analyzer = analyzerRegistry
      .getAllAnalyzers()
      .find((a) => analyzerMatchesLanguage(a, l));
    if (analyzer) {
      analyzerRegistry.activateAdditionalAnalyzer(analyzer.id);
      activated.push(analyzer.language);
    } else {
      missing.push(lang);
    }
  }
  return { activated, missing };
}

// ─── 插件规则 ↔ 后端规则引擎（§4.2 RuleRegistry ↔ 引擎 深度联动）───

/**
 * 把插件的规则声明（RuleRegistration：id/name/severity/category）映射为
 * 后端规则引擎可执行的 ReviewRule（rule_type/target_type/rule_body/scope）。
 *
 * 映射约定（与后端 migration.rs 语言专属种子规则同 id 对齐）：
 * - id 含 "unsafe"  → unsafe / file（Rust unsafe 块检测）
 * - id 含 "cycle"   → graph / module（循环依赖检测）
 * - id 含 "unused"  → graph / file（入度为零的死代码检测）
 * - category layering → metadata / file（layer_id 必填检查）
 * - 其余（复杂度/嵌套/超长/参数/耦合/魔法数字）→ 返回 null **不同步后端**：
 *   后端 metric 执行器（review.rs apply_metric_rule_on_files）只认 line_count/size，
 *   且 review 阶段（第3）先于 metrics 阶段（第8）执行，拿不到 AST 度量。
 *   同步这些规则只会造出「已同步=已生效」的错觉（实际永不触发）。
 *   它们由前端 ruleEngine 读取 FileMetric 真实执行（PluginSelector 面板展示）。
 *
 * 后端已有同 id 种子规则时 `sync_analyzer_rules` 会跳过（保留可执行种子版本），
 * 因此本映射只对缺失规则生效，不会覆盖内置规则。
 */
export function buildEngineRulesFromPlugin(
  analyzerId: string,
  language: string
): ReviewRule[] {
  const manifest = analyzerRegistry.getAnalyzer(analyzerId);
  if (!manifest) return [];
  const now = Date.now();
  // 后端 scope 使用小写语言（javascript 保持 javascript——后端按 analysis.primary_language
  // 匹配，把 js 归入 typescript 会让 JS 项目的 js-* 规则一条都不触发）
  const scope = language.toLowerCase();
  return manifest.rules.flatMap((r) => {
    const mapped = mapPluginRuleToEngine(r);
    if (!mapped) return [];
    return [{
      id: r.id,
      name: r.name,
      description: r.description,
      ruleType: mapped.ruleType,
      targetType: mapped.targetType,
      ruleBody: mapped.ruleBody,
      severity: r.severity,
      enabled: true,
      scope,
      builtin: false,
      createdAt: now,
      updatedAt: now,
    }];
  });
}

function mapPluginRuleToEngine(
  r: RuleRegistration
): { ruleType: string; targetType: string; ruleBody: string } | null {
  const id = r.id.toLowerCase();
  const category = r.category;

  // ── 精确匹配：按规则 id 语义映射（后端可真实执行的四类）──
  if (id.includes("unsafe")) {
    return { ruleType: "unsafe", targetType: "file", ruleBody: '{"keywords":["unsafe"],"min_hits":1}' };
  }
  if (id.includes("cycle")) {
    return { ruleType: "graph", targetType: "module", ruleBody: '{"algorithm":"circular","min_cycle_length":2}' };
  }
  if (id.includes("unused") || id.includes("dead")) {
    return { ruleType: "graph", targetType: "file", ruleBody: '{"algorithm":"in_degree_zero","min_lines":10}' };
  }
  if (id.includes("layering")) {
    return { ruleType: "metadata", targetType: "file", ruleBody: '{"required_field":"layer_id","error_if_null":true}' };
  }
  // 错误处理类（go-error-handling 等）：本质是关键词扫描 panic/throw/error 未处理，
  // 后端 unsafe 执行器（行级关键词）能真实执行，保留同步
  if (id.includes("error") || id.includes("risk")) {
    return { ruleType: "unsafe", targetType: "file", ruleBody: '{"keywords":["error","unsafe","panic","throw"],"min_hits":1}' };
  }

  // ── 其余（复杂度/嵌套/超长/参数/耦合/魔法数字）→ 前端 ruleEngine 执行，不同步后端 ──
  // 原因见 buildEngineRulesFromPlugin 注释：后端 metric 执行器只支持 line_count/size，
  // 同步过去是死规则（永不触发），只会造成「规则已生效」的错觉。
  return null;
}

/**
 * 按项目主语言把对应分析器插件的规则声明同步到后端规则引擎。
 * 幂等：后端已存在同 id 规则时跳过；返回实际新增的规则数量。
 * 找不到匹配插件或同步失败时返回 0。
 */
export async function syncPluginRulesToBackend(language: string | null | undefined): Promise<number> {
  if (!language) return 0;
  const lang = language.toLowerCase();
  const analyzer = analyzerRegistry
    .getAllAnalyzers()
    .find((a) => a.language.toLowerCase() === lang);
  if (!analyzer) return 0;
  const rules = buildEngineRulesFromPlugin(analyzer.id, lang);
  if (rules.length === 0) return 0;
  try {
    const added = await projectScanApi.syncAnalyzerRules(rules);
    if (added > 0) {
      console.log(
        `[Analyzer] 已同步插件 "${analyzer.id}" 的 ${added} 条规则到后端规则引擎`
      );
    }
    return added;
  } catch (err) {
    console.error("[Analyzer] 同步插件规则到后端失败", err);
    return 0;
  }
}
