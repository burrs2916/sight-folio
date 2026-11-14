// 删除确认接线的源码锁（2026-11-04 全仓删除账 ③e）。
//
// 为什么用扫描锁而不是组件测：这三处删除都在工作室画布/抽屉深处，挂全量 harness 的代价远大于收益，
// 而真正会被后人改坏的是"接线"这件事本身——把 onClick 换回一行直删，任何行为测都不会红。
// 口径：整行注释与整行块注释先剥掉，避免"注释里提到 window.confirm"被当成活调用（本仓有两处这种历史注释）。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\n)\s*\/\/[^\n]*/g, '\n');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = `${dir}/${name}`;
    if (statSync(abs).isDirectory()) {
      if (name === '__tests__') continue;
      walk(abs, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(abs);
    }
  }
  return out;
}

const SRC = `${process.cwd()}/src`;
const read = (rel: string): string => readFileSync(`${process.cwd()}/${rel}`, 'utf8');

describe('③e 删除确认接线锁', () => {
  it('全仓不许再有活的 window.confirm（原生弹窗样式不受控，也讲不清后果）', () => {
    const offenders = walk(SRC)
      .map((f) => [f, stripComments(readFileSync(f, 'utf8'))] as const)
      .flatMap(([f, code]) =>
        code.includes('window.confirm(') ? [f.replace(`${process.cwd()}/`, '')] : [],
      );
    expect(offenders).toEqual([]);
  });

  it('工作室两处念头/大纲删除必须经全局确认出口，且不许留裸直删', () => {
    for (const rel of ['src/editor/renderers/writingPanes.tsx', 'src/editor/panels/InspirationPanels.tsx']) {
      const src = read(rel);
      expect(src, `${rel} 必须引用 confirmDestructive`).toContain('confirmDestructive');
      const bare = stripComments(src).match(/onClick=\{\(\)\s*=>\s*void deleteOutline\(/);
      expect(bare, `${rel} 不许退回一点即删`).toBeNull();
    }
  });

  it('清封面必须走确认出口并声明"文件从磁盘删除"', () => {
    const src = read('src/editor/panels/BookMetaPanel.tsx');
    expect(src).toContain('confirmDestructive');
    expect(src).toContain('studio.cover.clearConfirmImpactFile');
  });

  it('已拆除的 delete-outline 死弹窗不许复活（有弹窗没人接 = 让审计误判为已保护）', () => {
    expect(read('src/pages/writingPage/useDialogActions.tsx')).not.toContain("'delete-outline'");
  });

  it('新文案键不许只躺在词典里（必须真被引用）', () => {
    const all = [
      'src/editor/renderers/writingPanes.tsx',
      'src/editor/panels/InspirationPanels.tsx',
      'src/editor/panels/BookMetaPanel.tsx',
    ].map(read).join('\n');
    for (const key of [
      'writingDesign.deleteIdeaConfirmTitle',
      'writingDesign.deleteIdeaConfirmImpactBindings',
      'writingDesign.deleteIdeaConfirmImpactUndo',
      'studio.cover.clearConfirmTitle',
      'studio.cover.clearConfirmImpactBook',
    ]) {
      expect(all, `${key} 无人引用`).toContain(key);
    }
  });
});
