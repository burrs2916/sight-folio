// §9-13 结构回归锁（B6a）：旧「完结作品登记表」依赖在**新代码**中必须保持零引用。
//
// 需求 §9-13：「旧 completed_works 在新代码中零引用（grep 断言 + 结构回归锁）」。
// B6a 已把退役面全部摘除：前端登记 API（completedWorksApi/CompletedWork/newCompletedWorkId）、
// Rust 旧命令（save/list/delete/move/import_completed_works）与仓储方法、CompletedWork 模型。
// 本锁盯的是「不许回流」：任何一处重新出现（哪怕只是被重新 import），CI 立刻红。
//
// 口径说明：
// - 只扫**非注释行**——退役墓碑注释（writing.rs 顶部、service 注释等）允许叙述历史，
//   但可执行代码里出现即违规；`__tests__` 目录整体豁免（本锁与被点名测试会字面提及）。
// - 命令名 `query_completed_work_count` 是 §6 明文**保留**的（实现改按 export_artifacts），
//   单数 completed_work_count 不含禁串 `completed_works`，天然不冲突。
// - `legacy_completed_works` 表名只允许出现在 migration.rs（B0 授权的改名留守处），
//   业务代码即便提到 legacy 前缀也一并拦（新代码不该再读写它）。
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

function collect(dir: string, exts: RegExp, skipTests: boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === 'node_modules') continue;
      if (skipTests && entry === '__tests__') continue;
      collect(p, exts, skipTests, out);
    } else if (exts.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

/** 去掉整行注释（//、///、//!、# 开头），保留可执行代码语义行。 */
function codeLines(src: string): string[] {
  return src.split('\n').filter((line) => {
    const t = line.trimStart();
    return !(t.startsWith('//') || t.startsWith('///') || t.startsWith('//!') || t.startsWith('/*') || t.startsWith('*'));
  });
}

const frontendFiles = collect(join(ROOT, 'src'), /\.tsx?$/, true);
const backendFiles = collect(join(ROOT, 'src-tauri', 'src'), /\.rs$/, false);

describe('§9-13：旧 completed_works 登记面在新代码中零引用', () => {
  const FE_FORBIDDEN = [
    'completedWorksApi',
    'CompletedWork',
    'newCompletedWorkId',
    'save_completed_work',
    'list_completed_works',
    'delete_completed_work',
    'move_completed_work',
    'import_completed_works',
    'completed_works',
    'FinishedPendingBand',
  ];

  const BE_FORBIDDEN = [
    'CompletedWork',
    'save_completed_work',
    'list_completed_works',
    'delete_completed_work',
    'move_completed_work',
    'import_completed_works',
    'count_completed_works',
    'set_completed_work_missing',
    'find_completed_work_by_path',
    'update_completed_work_path',
    'COMPLETED_WORK_COLS',
    'row_to_completed_work',
  ];

  it('前端源文件扫描面非空（防止扫描路径写错导致的假绿）', () => {
    expect(frontendFiles.length).toBeGreaterThan(100);
    expect(backendFiles.length).toBeGreaterThan(30);
  });

  for (const file of frontendFiles) {
    it(`前端无旧登记引用：${relative(ROOT, file)}`, () => {
      const lines = codeLines(readFileSync(file, 'utf8'));
      for (const bad of FE_FORBIDDEN) {
        for (const line of lines) {
          expect(line, `${relative(ROOT, file)} 出现禁串 ${bad}`).not.toContain(bad);
        }
      }
    });
  }

  for (const file of backendFiles) {
    it(`Rust 无旧登记引用：${relative(ROOT, file)}`, () => {
      const lines = codeLines(readFileSync(file, 'utf8'));
      for (const bad of BE_FORBIDDEN) {
        for (const line of lines) {
          expect(line, `${relative(ROOT, file)} 出现禁串 ${bad}`).not.toContain(bad);
        }
      }
      // legacy 表名只许住在 migration.rs（B0 授权的改名/留守逻辑）
      if (!relative(ROOT, file).endsWith('migration.rs')) {
        for (const line of lines) {
          expect(line, `${relative(ROOT, file)} 不该再碰 legacy_completed_works`).not.toContain(
            'legacy_completed_works',
          );
        }
      }
    });
  }

  it('正向锁：徽标计数命令仍在命令面上（§6 保留名单，不许连坐删错）', () => {
    const lib = readFileSync(join(ROOT, 'src-tauri/src/lib.rs'), 'utf8');
    expect(codeLines(lib).some((l) => l.includes('commands::query_completed_work_count'))).toBe(true);
    const cmd = readFileSync(join(ROOT, 'src-tauri/src/commands/work_version.rs'), 'utf8');
    expect(codeLines(cmd).some((l) => l.includes('pub fn query_completed_work_count'))).toBe(true);
    // 实现必须走 export_artifacts 计数（而不是回读 legacy 表）
    expect(codeLines(cmd).some((l) => l.includes('count_ready_artifacts'))).toBe(true);
  });

  it('backup 不在作品导出白名单（§9-11：成品页无整库备份形态）', () => {
    const jobs = readFileSync(
      join(ROOT, 'src-tauri/src/application/work_version/export_jobs.rs'),
      'utf8',
    );
    const fmtLine = codeLines(jobs).find((l) => l.includes('EXPORT_FORMATS')) ?? '';
    expect(fmtLine, 'EXPORT_FORMATS 常量必须存在').not.toBe('');
    expect(fmtLine).not.toContain('backup');
  });
});
