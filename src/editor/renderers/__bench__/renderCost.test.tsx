/**
 * 画布实体渲染成本基准（R37 卡顿攻坚的量化依据）
 *
 * 不是功能测试 —— 它回答一个工程问题：**在画布上挂 N 个文件实体，一次挂载
 * 要花多少毫秒**。虚拟化只是少挂几个，单个实体本身有多贵才是天花板。
 *
 * 运行：npx vitest run src/editor/renderers/__bench__/renderCost.test.tsx
 */
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { FileRenderer } from "../FileRenderer";
import { LOD_NODE_BUDGET, lodForScale, type CanvasLod } from "../../utils/lod";

const N = 200;

function makeConfig(i: number) {
  return {
    fileName: `module-${i}.ts`,
    language: "typescript",
    lineCount: 120 + i,
    symbolCount: 6,
    refCount: 3,
    complexity: 12,
    complexityLevel: "high" as const,
    techDebtCount: 2,
    callOut: 4,
    callIn: 9,
    churnScore: 30,
    churnLevel: "medium",
    deadCount: 1,
    cloneCount: 2,
    cloneType2Count: 1,
    duplicatedLines: 40,
    duplicationRatio: 0.22,
    quadrant: "refactorFirst",
  };
}

function mountHost() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return { container, root: createRoot(container) };
}

// 基准测试用大超时：200 实体的多轮挂载在慢机 / 全量并行负载下会逼近 vitest 默认 5s
// 上限（本机单跑 1.3s，CI 慢机约 3–4s），而这里只做「是否可用」的相对比较，
// 不应因机器快慢判失败。
describe("画布实体渲染成本基准", { timeout: 60_000 }, () => {
  it(`对照组：${N} 个裸 div（jsdom 地板价）`, async () => {
    const { container, root } = mountHost();
    const t0 = performance.now();
    await act(async () => {
      root.render(
        <>
          {Array.from({ length: N }, (_, i) => (
            <div key={i} style={{ width: 160, height: 40 }}>
              <span>x{i}</span>
            </div>
          ))}
        </>
      );
    });
    const ms = performance.now() - t0;
    await act(async () => root.unmount());
    container.remove();
    // eslint-disable-next-line no-console
    console.log(`[bench] 对照组裸 div × ${N}: ${ms.toFixed(1)}ms`);
    expect(ms).toBeGreaterThan(0);
  });

  it(`DOM 规模：单个文件实体产生多少 DOM 节点`, async () => {
    const { container, root } = mountHost();
    await act(async () => {
      root.render(<FileRenderer config={makeConfig(0)} />);
    });
    const nodes = container.querySelectorAll("*").length;
    const styleTags = document.querySelectorAll("style").length;
    await act(async () => root.unmount());
    container.remove();
    // eslint-disable-next-line no-console
    console.log(`[bench] 单实体 DOM 节点数: ${nodes}，文档内 <style> 标签数: ${styleTags}`);
    expect(nodes).toBeGreaterThan(0);
  });

  it(`挂载 ${N} 个文件实体的耗时（打印用，不设硬阈值）`, async () => {
    const configs = Array.from({ length: N }, (_, i) => makeConfig(i));
    const { container, root } = mountHost();

    const t0 = performance.now();
    await act(async () => {
      root.render(
        <>
          {configs.map((c, i) => (
            <FileRenderer key={i} config={c} />
          ))}
        </>
      );
    });
    const mountMs = performance.now() - t0;

    const t1 = performance.now();
    await act(async () => root.unmount());
    const unmountMs = performance.now() - t1;
    container.remove();

    // eslint-disable-next-line no-console
    console.log(
      `[bench] FileRenderer × ${N}: mount ${mountMs.toFixed(1)}ms (${(mountMs / N).toFixed(3)}ms/个), unmount ${unmountMs.toFixed(1)}ms`
    );
    expect(mountMs).toBeGreaterThan(0);
  });

  it(`平移场景：${N} 个实体反复重挂载 5 轮（虚拟化真实代价）`, async () => {
    const configs = Array.from({ length: N }, (_, i) => makeConfig(i));
    const { container, root } = mountHost();

    const t0 = performance.now();
    for (let round = 0; round < 5; round++) {
      const slice = configs.slice(round % 2 === 0 ? 0 : 20);
      await act(async () => {
        root.render(
          <>
            {slice.map((c, i) => (
              <FileRenderer key={`${round % 2}-${i}`} config={c} />
            ))}
          </>
        );
      });
    }
    const ms = performance.now() - t0;
    await act(async () => root.unmount());
    container.remove();

    // eslint-disable-next-line no-console
    console.log(`[bench] 平移 5 轮重挂载（${N} 实体）: ${ms.toFixed(1)}ms → 单轮 ${(ms / 5).toFixed(1)}ms`);
    expect(ms).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LOD 收益量化
//
// 「全览时虚拟化剪不掉任何东西」是本轮攻坚的核心症结（见 utils/lod.ts）。
// 这组用例把 LOD 的收益钉死成数字：同样 200 个实体，三个档位各要多少 DOM
// 节点、多少毫秒。有了它，以后任何人往渲染器里加一行 <span>，回归就看得见。
// ─────────────────────────────────────────────────────────────────────────────
describe("LOD 分级渲染收益", { timeout: 60_000 }, () => {
  const TIERS: CanvasLod[] = ["full", "compact", "block"];

  it("单实体 DOM 节点数随档位下降，且不超过预算", async () => {
    const counts: Record<string, number> = {};
    for (const lod of TIERS) {
      const { container, root } = mountHost();
      await act(async () => {
        root.render(<FileRenderer config={makeConfig(0)} lod={lod} />);
      });
      counts[lod] = container.querySelectorAll("*").length;
      await act(async () => root.unmount());
      container.remove();
    }
    // eslint-disable-next-line no-console
    console.log(
      `[bench] 单实体 DOM 节点数 —— full ${counts.full} / compact ${counts.compact} / block ${counts.block}`
    );

    // 预算是契约：渲染器加东西可以，但加到撑破档位预算就说明该档位失去意义了
    for (const lod of TIERS) {
      expect(counts[lod], `${lod} 档节点数超预算`).toBeLessThanOrEqual(LOD_NODE_BUDGET[lod]);
    }
    expect(counts.block).toBeLessThan(counts.compact);
    expect(counts.compact).toBeLessThan(counts.full);
  });

  it(`挂载 ${N} 个实体：三档耗时对比`, async () => {
    const configs = Array.from({ length: N }, (_, i) => makeConfig(i));
    const timings: Record<string, number> = {};
    for (const lod of TIERS) {
      const { container, root } = mountHost();
      const t0 = performance.now();
      await act(async () => {
        root.render(
          <>
            {configs.map((c, i) => (
              <FileRenderer key={i} config={c} lod={lod} />
            ))}
          </>
        );
      });
      timings[lod] = performance.now() - t0;
      await act(async () => root.unmount());
      container.remove();
    }
    // eslint-disable-next-line no-console
    console.log(
      `[bench] ${N} 实体挂载耗时 —— full ${timings.full.toFixed(1)}ms / compact ${timings.compact.toFixed(
        1
      )}ms / block ${timings.block.toFixed(1)}ms`
    );
    expect(timings.block).toBeGreaterThan(0);
  });

  it("档位切换带迟滞，边界抖动不会来回换档", () => {
    // R39：阈值整体下移（full 0.60 / compact 0.30，与 fit 全览的真实 scale 对齐）。
    // full 降档线 0.60，升档需要 0.60×1.08≈0.648；
    // compact 降档线 0.30，升档需要 0.30×1.08≈0.324。
    // 用户在边界附近来回滚滚轮时，档位必须稳定停在低档，
    // 否则每次横跳都是一次全画布重挂载 —— 比不做 LOD 还卡。
    let lod = lodForScale(0.9); // full
    expect(lod).toBe("full");
    lod = lodForScale(0.55, lod); // 跌破 0.60 → 降档
    expect(lod).toBe("compact");
    lod = lodForScale(0.62, lod); // 回到 0.62 但没到 0.648 → 保持
    expect(lod).toBe("compact");
    lod = lodForScale(0.68, lod); // 越过迟滞线 → 升档
    expect(lod).toBe("full");
    // block 侧：跌破 0.30 → block；回升到 0.31 但没到 0.324 → 保持
    lod = lodForScale(0.25, lod);
    expect(lod).toBe("block");
    lod = lodForScale(0.31, lod);
    expect(lod).toBe("block");
    lod = lodForScale(0.36, lod); // 越过 0.324 → compact
    expect(lod).toBe("compact");
  });
});
