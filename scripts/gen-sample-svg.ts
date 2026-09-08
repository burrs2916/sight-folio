/* 一次性脚本：用样例数据生成 SVG 报告到 /tmp，供人工视觉验证 */
import { writeFileSync } from "node:fs";
import { generateReportSvg } from "../src/utils/reportGenerator";

const analysis = { id: "a1", name: "示例项目分析", projectRoot: "/Users/dev/example-service" } as any;

const file = (id: string, relPath: string, lang: string): any => ({
  id, analysisId: "a1", path: `/proj/${relPath}`, relPath,
  name: relPath.split("/").pop(), extension: "ts", language: lang,
  size: 100, lineCount: 30, contentHash: null, parentId: null, isDirectory: false,
  layerId: id.startsWith("f1") ? "l1" : id.startsWith("f2") ? "l2" : "l3",
  x: 0, y: 0, width: 0, height: 0, metadata: "{}", scannedAt: 1,
});

const layer = (id: string, name: string, color: string, sortOrder: number): any => ({
  id, analysisId: "a1", name, color, sortOrder, yPosition: 0, description: null,
  rulePattern: null, metadata: "{}", createdAt: 1, updatedAt: 1,
});

const module = (id: string, name: string, layerId: string | null): any => ({
  id, analysisId: "a1", name, description: null, layerId,
  fileCount: 2, depCount: 3, beDepCount: 1, x: 0, y: 0, width: 100, height: 60,
  color: "#3b82f6", metadata: "{}", createdAt: 1, updatedAt: 1,
});

const metric = (fileId: string, cc: number): any => ({
  id: `m_${fileId}`, analysisId: "a1", fileId, filePath: "",
  totalLines: 30, codeLines: 22, commentLines: 4, blankLines: 4,
  cyclomaticComplexity: cc,
  complexityLevel: cc <= 5 ? "low" : cc <= 10 ? "medium" : cc <= 20 ? "high" : "extreme",
  metadata: "{}", createdAt: 1,
});

const clone = (
  id: string,
  fileId: string,
  filePath: string,
  groupId: string,
  startLine: number,
  lineCount: number,
  groupSize: number
): any => ({
  id, analysisId: "a1", groupId, fileId, filePath,
  startLine, endLine: startLine + lineCount - 1, lineCount, groupSize,
  snippet: "if (!token) return null;", language: "typescript", createdAt: 1,
});

const files = [
  file("f1a", "src/auth/login.ts", "typescript"), file("f1b", "src/auth/token.ts", "typescript"),
  file("f2a", "domain/user.ts", "typescript"), file("f2b", "domain/role.ts", "typescript"),
  file("f3a", "infra/db/pool.ts", "rust"), file("f3b", "infra/http/server.ts", "rust"),
];
const deps: any[] = [];
for (const [from, to] of [["f1a","f2a"],["f1b","f2b"],["f2a","f3a"],["f3b","f2a"],["f3a","f1a"]]) {
  deps.push({ id: `d_${from}_${to}`, analysisId: "a1", fromId: from, fromType: "file", toId: to, toType: "file", kind: "import", lineNo: 1, isCircular: from === "f3a" && to === "f1a", weight: 1, metadata: "{}", detectedAt: 1 });
}

const svg = generateReportSvg({
  analysis,
  files,
  modules: [module("m1", "src", "l1"), module("m2", "domain", "l2"), module("m3", "infra", "l3")],
  dependencies: deps,
  layers: [layer("l1", "表现层", "#3b82f6", 0), layer("l2", "领域层", "#8b5cf6", 1), layer("l3", "基础设施层", "#10b981", 2)],
  findings: [
    { id: "x1", analysisId: "a1", severity: "critical", message: "未授权访问路径", suggestion: "增加鉴权中间件", targetId: "f1a", targetType: "file", status: "open", ruleId: "r1", ruleName: "auth", lineNo: 12, createdAt: 1 },
    { id: "x2", analysisId: "a1", severity: "warning", message: "循环依赖", suggestion: "抽取共享模块", targetId: "f3a", targetType: "file", status: "open", ruleId: "r2", ruleName: "cycle", lineNo: 3, createdAt: 1 },
    { id: "x3", analysisId: "a1", severity: "info", message: "魔法数字", suggestion: "提取常量", targetId: "f2a", targetType: "file", status: "open", ruleId: "r3", ruleName: "magic", lineNo: 8, createdAt: 1 },
  ],
  metrics: [metric("f1a", 3), metric("f1b", 8), metric("f2a", 16), metric("f2b", 2), metric("f3a", 25), metric("f3b", 11)],
  techDebt: [
    { id: "t1", analysisId: "a1", fileId: "f1a", filePath: "src/auth/login.ts", lineNo: 5, marker: "FIXME", severity: "critical", snippet: "// FIXME: 过期 token 未清理", createdAt: 1 },
    { id: "t2", analysisId: "a1", fileId: "f2a", filePath: "domain/user.ts", lineNo: 21, marker: "TODO", severity: "info", snippet: "// TODO: 支持软删除", createdAt: 1 },
    { id: "t3", analysisId: "a1", fileId: "f3a", filePath: "infra/db/pool.ts", lineNo: 44, marker: "HACK", severity: "warning", snippet: "// HACK: 连接池扩容临时方案", createdAt: 1 },
    { id: "t4", analysisId: "a1", fileId: "f3b", filePath: "infra/http/server.ts", lineNo: 9, marker: "DEPRECATED", severity: "warning", snippet: "// DEPRECATED: 使用 v2 接口", createdAt: 1 },
  ],
  patternHits: [
    { pattern: "singleton", name: "singleton", symbolName: "TokenStore", filePath: "src/auth/token.ts", line: 3, evidence: "static instance" },
    { pattern: "repository", name: "repository", symbolName: "UserRepo", filePath: "domain/user.ts", line: 10, evidence: "Repository pattern" },
    { pattern: "service", name: "service", symbolName: "AuthService", filePath: "src/auth/login.ts", line: 15, evidence: "service layer" },
  ],
  clones: [
    // g1：登录与令牌刷新里两段 46 行的重复校验逻辑
    clone("c1", "f1a", "src/auth/login.ts", "g1", 32, 46, 2),
    clone("c2", "f1b", "src/auth/token.ts", "g1", 88, 46, 2),
    // g2：三个仓储里同一段 18 行的 UPDATE 拼装
    clone("c3", "f2a", "domain/user.ts", "g2", 51, 18, 3),
    clone("c4", "f2b", "domain/role.ts", "g2", 24, 18, 3),
    clone("c5", "f3a", "infra/db/pool.ts", "g2", 120, 18, 3),
    // g3：两处 9 行的错误映射
    clone("c6", "f3a", "infra/db/pool.ts", "g3", 9, 9, 2),
    clone("c7", "f3b", "infra/http/server.ts", "g3", 63, 9, 2),
  ],
});

writeFileSync("/tmp/project-sight-sample-report.svg", svg, "utf-8");
console.log("SVG written:", svg.length, "chars, height:", svg.match(/height="(\d+)"/)?.[1]);
