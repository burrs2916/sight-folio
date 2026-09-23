import { t } from "../i18n";
import type { AnalysisDSL } from "../types/scene";
import type { ProjectFile } from "../services/tauri";
import { parseWritingChapters, type ChapterRow } from "./bookOverview";
import { buildRelationBoard } from "./writingBoards";

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface Agg {
  id: string;
  name: string;
  kind: "character" | "worldbuilding";
  total: number;
  chapters: number;
  topName: string;
}

function aggregate(files: ProjectFile[], kindFilter: Agg["kind"] | null): Agg[] {
  const rows = parseWritingChapters(files);
  const map = new Map<string, Agg>();
  const topCount = new Map<string, number>();
  for (const ch of rows) {
    for (const a of ch.appearances) {
      const kind: Agg["kind"] = a.kind === "worldbuilding" ? "worldbuilding" : "character";
      if (kindFilter && kind !== kindFilter) continue;
      let acc = map.get(a.id);
      if (!acc) {
        acc = { id: a.id, name: a.name, kind, total: 0, chapters: 0, topName: "" };
        map.set(a.id, acc);
        topCount.set(a.id, 0);
      }
      acc.total += a.count;
      acc.chapters += 1;
      if (a.count > (topCount.get(a.id) ?? 0)) {
        topCount.set(a.id, a.count);
        acc.topName = ch.file.name;
      }
    }
  }
  return [...map.values()].sort((x, y) => y.total - x.total || x.name.localeCompare(y.name));
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const STYLE = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; background: #0f1117; color: #e1e4e8; line-height: 1.6; padding: 32px; }
  .wrap { max-width: 920px; margin: 0 auto; }
  .header { border-bottom: 2px solid #21262d; padding-bottom: 16px; margin-bottom: 24px; }
  .title { font-size: 24px; font-weight: 700; color: #f0f6fc; }
  .subtitle { color: #8b949e; font-size: 13px; margin-top: 6px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 28px; }
  .stat { background: #161b22; border: 1px solid #21262d; border-radius: 10px; padding: 16px; }
  .stat .n { font-size: 26px; font-weight: 700; color: #8b5cf6; }
  .stat .l { font-size: 12px; color: #8b949e; margin-top: 4px; }
  .section { margin-bottom: 28px; }
  .section-title { font-size: 16px; font-weight: 600; color: #f0f6fc; border-left: 3px solid #8b5cf6; padding-left: 10px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #21262d; }
  th { color: #8b949e; font-weight: 600; }
  .vol { font-weight: 600; color: #c9d1d9; margin: 14px 0 6px; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; background: #21262d; color: #8b949e; }
  .draft { color: #d29922; } .finished { color: #3fb950; }
  .empty { color: #8b949e; font-size: 13px; padding: 8px 0; }
`;

export function generateBookReportHtml(analysis: AnalysisDSL, files: ProjectFile[]): string {
  const chapters = parseWritingChapters(files);
  const characters = aggregate(files, "character");
  const world = aggregate(files, "worldbuilding");
  const volumes = new Map<string, ChapterRow[]>();
  for (const r of chapters) {
    const k = r.volume || t("report.book.noVolume");
    if (!volumes.has(k)) volumes.set(k, []);
    volumes.get(k)!.push(r);
  }
  const relations = buildRelationBoard(files).edges.slice(0, 30);

  const stat = (n: number, l: string) => `<div class="stat"><div class="n">${n}</div><div class="l">${escapeHtml(l)}</div></div>`;

  const chapterRows = chapters
    .map(
      (c) => `<tr><td>${escapeHtml(c.file.name)}</td><td>${escapeHtml(c.volume || t("report.book.noVolume"))}</td><td>${
        c.status === "finished" ? '<span class="finished">✓</span>' : '<span class="draft">…</span>'
      }</td></tr>`
    )
    .join("");

  const charRows = characters
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.name)}</td><td>${c.total}</td><td>${c.chapters}</td><td>${escapeHtml(c.topName)}</td></tr>`
    )
    .join("");

  const worldRows = world
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.name)}</td><td>${c.total}</td><td>${c.chapters}</td><td>${escapeHtml(c.topName)}</td></tr>`
    )
    .join("");

  const relRows = relations.length
    ? relations
        .map(
          (e) =>
            `<tr><td>${escapeHtml(e.aName)} ⇄ ${escapeHtml(e.bName)}</td><td>${t("report.book.togetherChapters", { n: e.co })}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="2" class="empty">${t("report.book.empty")}</td></tr>`;

  const volBlocks = [...volumes.entries()]
    .map(
      ([v, rows]) =>
        `<div class="vol">${escapeHtml(v)} <span class="badge">${t("report.book.statsChapters")} ${rows.length}</span></div>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="${document.documentElement.lang || "zh-CN"}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(analysis.name)} — ${t("report.book.title")}</title>
<style>${STYLE}</style></head>
<body><div class="wrap">
  <div class="header">
    <div class="title">${escapeHtml(analysis.name)}</div>
    <div class="subtitle">${t("report.book.title")} · ${t("report.generatedAt", { time: formatDate(Math.floor(Date.now() / 1000)) })} · ${t("report.generatedBy")}</div>
  </div>
  <div class="stats">
    ${stat(chapters.length, t("report.book.statsChapters"))}
    ${stat(characters.length, t("report.book.statsCharacters"))}
    ${stat(world.length, t("report.book.statsSettings"))}
    ${stat(volumes.size, t("report.book.statsVolumes"))}
  </div>
  <div class="section"><div class="section-title">${t("report.book.sectionChapters")}</div>
    ${chapterRows ? `<table><thead><tr><th>${t("report.book.sectionChapters")}</th><th>${t("report.book.noVolume")}</th><th>✓</th></tr></thead><tbody>${chapterRows}</tbody></table>` : `<div class="empty">${t("report.book.empty")}</div>`}
  </div>
  <div class="section"><div class="section-title">${t("report.book.sectionCharacters")}</div>
    ${charRows ? `<table><thead><tr><th>${t("report.book.sectionCharacters")}</th><th>${t("report.book.colMentions")}</th><th>${t("report.book.colChapters")}</th><th>${t("report.book.colMain")}</th></tr></thead><tbody>${charRows}</tbody></table>` : `<div class="empty">${t("report.book.empty")}</div>`}
  </div>
  <div class="section"><div class="section-title">${t("report.book.sectionSettings")}</div>
    ${worldRows ? `<table><thead><tr><th>${t("report.book.sectionSettings")}</th><th>${t("report.book.colMentions")}</th><th>${t("report.book.colChapters")}</th><th>${t("report.book.colMain")}</th></tr></thead><tbody>${worldRows}</tbody></table>` : `<div class="empty">${t("report.book.empty")}</div>`}
  </div>
  <div class="section"><div class="section-title">${t("report.book.sectionRelations")}</div>
    <table><thead><tr><th>${t("report.book.sectionRelations")}</th><th></th></tr></thead><tbody>${relRows}</tbody></table>
  </div>
  <div class="section"><div class="section-title">${t("report.book.sectionVolumes")}</div>
    ${volBlocks || `<div class="empty">${t("report.book.empty")}</div>`}
  </div>
</div></body></html>`;
}

export function generateBookReportSvg(analysis: AnalysisDSL, files: ProjectFile[]): string {
  const chapters = parseWritingChapters(files);
  const characters = aggregate(files, "character").length;
  const world = aggregate(files, "worldbuilding").length;
  const volumes = new Set(chapters.map((c) => c.volume || t("report.book.noVolume"))).size;
  const W = 760;
  const H = 360;
  const box = (x: number, n: number, label: string) =>
    `<g transform="translate(${x},120)"><rect width="160" height="90" rx="10" fill="#161b22" stroke="#21262d"/><text x="80" y="44" fill="#8b5cf6" font-size="30" font-weight="700" text-anchor="middle">${n}</text><text x="80" y="70" fill="#8b949e" font-size="13" text-anchor="middle">${escapeHtml(label)}</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0f1117"/>
  <text x="32" y="56" fill="#f0f6fc" font-size="20" font-weight="700">${escapeHtml(analysis.name)}</text>
  <text x="32" y="80" fill="#8b949e" font-size="13">${escapeHtml(t("report.book.title"))}</text>
  ${box(32, chapters.length, t("report.book.statsChapters"))}
  ${box(212, characters, t("report.book.statsCharacters"))}
  ${box(392, world, t("report.book.statsSettings"))}
  ${box(572, volumes, t("report.book.statsVolumes"))}
  <text x="32" y="${H - 20}" fill="#8b949e" font-size="12">${escapeHtml(t("report.generatedAt", { time: formatDate(Math.floor(Date.now() / 1000)) }))}</text>
</svg>`;
}

export function generateBookReportJson(analysis: AnalysisDSL, files: ProjectFile[]): string {
  const chapters = parseWritingChapters(files);
  const characters = aggregate(files, "character");
  const world = aggregate(files, "worldbuilding");
  const volumes = new Map<string, number>();
  for (const r of chapters) {
    const k = r.volume || t("report.book.noVolume");
    volumes.set(k, (volumes.get(k) ?? 0) + 1);
  }
  const relations = buildRelationBoard(files).edges.slice(0, 30);
  const payload = {
    analysis: { id: analysis.id, name: analysis.name, primaryLanguage: analysis.primaryLanguage },
    stats: {
      chapters: chapters.length,
      characters: characters.length,
      worldSettings: world.length,
      volumes: volumes.size,
    },
    volumes: [...volumes.entries()].map(([name, count]) => ({ name, chapters: count })),
    characters: characters.map((c) => ({ name: c.name, mentions: c.total, chapters: c.chapters, mainChapter: c.topName })),
    worldSettings: world.map((c) => ({ name: c.name, mentions: c.total, chapters: c.chapters, mainChapter: c.topName })),
    relations: relations.map((e) => ({ a: e.aName, b: e.bName, togetherChapters: e.co })),
  };
  return JSON.stringify(payload, null, 2);
}
