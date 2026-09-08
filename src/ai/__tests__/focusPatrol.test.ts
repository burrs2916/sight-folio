/**
 * focusPatrol —— 把「自动轮转补维度」扩到「补文件」的纯函数回归测试。
 *
 * 这套判定的唯一职责是「会不会重复烧 token」：派单即销账（点名一次就记一笔，
 * 同一份数据不再重派），但从未派单的高共振目标必须迟早被点名一次。任何漂移
 * 都会让自动化要么漏看头号重构目标、要么对干净代码无限重派，两类错误都很贵。
 */
import { describe, it, expect } from "vitest";
import {
  planFocusPatrol,
  createFocusDispatcher,
  describePatrolReason,
  summarizeFocusPatrol,
  type FocusPatrolRow,
} from "../focusPatrol";
import { buildInsightFeedback } from "../insightFeedback";
import type { AiFocusTarget, AiFocusDimensionHit } from "../contextTypes";
import type { AiFocusAssignmentDto, AiInsightDto } from "../../services/tauri";

const NOW = 1_700_000_000;

/** 造一个高位维度命中（供 describePatrolReason 取 label / rank） */
function hit(key: string, label: string, rank: number): AiFocusDimensionHit {
  return { key, label, value: 100, pct: 95, rank, unit: "", hot: true };
}

/** 造一个多维共振焦点目标 */
function target(
  filePath: string,
  resonance: number,
  over: Partial<AiFocusTarget> = {},
): AiFocusTarget {
  const keys = Array.from({ length: resonance }, (_, i) => `dim${i}`);
  const dims: Record<string, AiFocusDimensionHit> = {};
  keys.forEach((k, i) => {
    dims[k] = hit(k, `维度${i}`, resonance * 10 + i);
  });
  return {
    filePath,
    codeLines: 100,
    score: resonance * 10,
    resonance,
    resonantKeys: keys,
    dims,
    ...over,
  };
}

/** 造一条派单记录 */
function assignment(
  filePath: string,
  over: Partial<AiFocusAssignmentDto> = {},
): AiFocusAssignmentDto {
  return {
    moduleId: "project-scan",
    scopeId: "analysis1",
    filePath,
    runId: "arun_x",
    presetKey: "holistic-optimization",
    contextDigest: "digest-A",
    resonance: 2,
    note: "",
    assignCount: 1,
    assignedAt: NOW - 3600,
    ...over,
  };
}

describe("planFocusPatrol · 共振门槛与台账全景", () => {
  it("共振 < 2 维的目标被门槛过滤掉，不进台账", () => {
    const targets = [target("a.ts", 3), target("b.ts", 1), target("c.ts", 2)];
    const plan = planFocusPatrol(targets, [], { nowSec: NOW });
    const paths = plan.rows.map((r) => r.filePath).sort();
    expect(paths).toEqual(["a.ts", "c.ts"]);
  });

  it("从未派单的目标判为 never，且撑起 hasUnpatrolled", () => {
    const targets = [target("a.ts", 2), target("b.ts", 3)];
    const plan = planFocusPatrol(targets, [], { nowSec: NOW });
    const row = plan.rows.find((r) => r.filePath === "a.ts") as FocusPatrolRow;
    expect(row.state).toBe("never");
    expect(row.detail).toContain("从未");
    expect(plan.hasUnpatrolled).toBe(true);
  });

  it("派单过且指纹一致判为 patrolled，且不算 hasUnpatrolled", () => {
    const targets = [target("a.ts", 2)];
    const plan = planFocusPatrol(targets, [assignment("a.ts")], {
      currentDigest: "digest-A",
      nowSec: NOW,
    });
    const row = plan.rows[0];
    expect(row.state).toBe("patrolled");
    expect(row.detail).toContain("一致");
    expect(plan.hasUnpatrolled).toBe(false);
  });

  it("派单过但之后数据已变判为 stale-data，不撑 hasUnpatrolled（指纹变了正常闸门会放行）", () => {
    const targets = [target("a.ts", 2)];
    const plan = planFocusPatrol(targets, [assignment("a.ts")], {
      currentDigest: "digest-B", // 与派单当时的 digest-A 不同
      nowSec: NOW,
    });
    const row = plan.rows[0];
    expect(row.state).toBe("stale-data");
    expect(row.detail).toContain("更新");
    expect(plan.hasUnpatrolled).toBe(false);
  });

  it("历史记录缺指纹时不误报 stale（与覆盖台账同口径，避免一上线全标红）", () => {
    const targets = [target("a.ts", 2)];
    const plan = planFocusPatrol(
      targets,
      [assignment("a.ts", { contextDigest: "" })],
      { currentDigest: "digest-B", nowSec: NOW },
    );
    expect(plan.rows[0].state).toBe("patrolled");
  });

  it("累计派单次数被如数带上，供面板提示「点名多次仍无结论」", () => {
    const targets = [target("a.ts", 2)];
    const plan = planFocusPatrol(targets, [assignment("a.ts", { assignCount: 3 })], {
      currentDigest: "digest-A",
      nowSec: NOW,
    });
    expect(plan.rows[0].assignCount).toBe(3);
  });
});

describe("planFocusPatrol · 本轮点名清单", () => {
  it("点名数不超过 limit，且 never 优先于 stale-data，再按共振数/综合分排序", () => {
    // 1 个 stale-data（已派单+数据变）+ 4 个 never，limit=2 → 取 2 个 never，按共振降序
    const targets = [
      target("stale.ts", 2),
      target("n-low.ts", 2),
      target("n-mid.ts", 3),
      target("n-high.ts", 4),
      target("n-low2.ts", 2),
    ];
    const assigns = [assignment("stale.ts", { contextDigest: "digest-OLD" })];
    const plan = planFocusPatrol(targets, assigns, {
      currentDigest: "digest-B",
      limit: 2,
      nowSec: NOW,
    });
    expect(plan.picks).toHaveLength(2);
    // never 全部排在 stale 之前
    expect(plan.picks.every((p) => p.filePath.startsWith("n-"))).toBe(true);
    // 共振最高的 never 优先
    expect(plan.picks[0].filePath).toBe("n-high.ts");
    expect(plan.picks[1].filePath).toBe("n-mid.ts");
  });

  it("limit 默认为 3（够 Agent 认真看完，又不把一轮摊薄成走过场）", () => {
    const targets = Array.from({ length: 6 }, (_, i) => target(`f${i}.ts`, 2 + (i % 2)));
    const plan = planFocusPatrol(targets, [], { nowSec: NOW });
    expect(plan.picks).toHaveLength(3);
  });

  it("点名清单只含 filePath / resonance / note / state + 两本账的指纹，可直接交给 Agent 与台账", () => {
    const targets = [target("a.ts", 2)];
    const plan = planFocusPatrol(targets, [], { nowSec: NOW });
    expect(plan.picks[0]).toEqual({
      filePath: "a.ts",
      resonance: 2,
      note: expect.any(String),
      state: "never",
      // 无历史结论时为空串：这个文件本来就没有「证据现状」可记账
      evidenceDigest: "",
      // 本轮没有变坏（或还没有可比历史）时同样为空串。两本账各记各的，
      // 合并成一列会让「既欠复核又刚变坏」的文件只被看一半 —— 见 migration 30d。
      regressionDigest: "",
    });
  });
});

/**
 * 分发器：同一轮编排里可能触发多条规则，队列必须在它们之间**顺序消费**。
 *
 * 给每条规则同一批 picks 会同时犯两个错：同一个文件被连点 N 次（派单次数虚增、
 * N 份 token 换回同一个结论），队列后面同样从未巡查的目标却一个都轮不到。
 * 更隐蔽的是第二条规则会看到「仍有未巡查目标」而在数据没变时被唤醒，
 * 却领到一个空清单——白跑一轮，正是指纹去重本来要拦住的事。
 */
describe("createFocusDispatcher · 同一轮多规则顺序领单", () => {
  it("第二条规则领到的是队列后半段，不与第一条重复", () => {
    const targets = [
      target("n1.ts", 5),
      target("n2.ts", 4),
      target("n3.ts", 3),
      target("n4.ts", 3),
      target("n5.ts", 2),
    ];
    const plan = planFocusPatrol(targets, [], { nowSec: NOW });
    const d = createFocusDispatcher(plan, 2);

    const first = d.take().map((p) => p.filePath);
    const second = d.take().map((p) => p.filePath);
    expect(first).toEqual(["n1.ts", "n2.ts"]);
    expect(second).toEqual(["n3.ts", "n4.ts"]);
    expect(first.some((p) => second.includes(p))).toBe(false);
    expect(d.dispatched()).toBe(4);
  });

  it("队列耗尽后返回空清单，不再点名（不会把同一批文件回头再点一次）", () => {
    const plan = planFocusPatrol([target("a.ts", 2)], [], { nowSec: NOW });
    const d = createFocusDispatcher(plan, 3);
    expect(d.take()).toHaveLength(1);
    expect(d.take()).toEqual([]);
    expect(d.take()).toEqual([]);
  });

  it("never 目标被领完后 hasUnpatrolled 立刻转 false —— 否则后续规则会被空清单唤醒", () => {
    // 1 个 never + 1 个 stale-data：领走 never 之后队列虽未空，但已经没有
    // 「压过指纹去重」的理由了（stale-data 意味着指纹已变，正常闸门本来就放行）。
    const targets = [target("never.ts", 3), target("stale.ts", 2)];
    const assigns = [assignment("stale.ts", { contextDigest: "digest-OLD" })];
    const plan = planFocusPatrol(targets, assigns, { currentDigest: "digest-B", nowSec: NOW });
    const d = createFocusDispatcher(plan, 1);

    expect(d.hasUnpatrolled()).toBe(true);
    expect(d.take()[0].filePath).toBe("never.ts");
    expect(d.hasUnpatrolled()).toBe(false);
  });

  it("没有任何待巡查目标时全程为空，绝不制造点名", () => {
    const plan = planFocusPatrol([target("a.ts", 2)], [assignment("a.ts")], {
      currentDigest: "digest-A",
      nowSec: NOW,
    });
    const d = createFocusDispatcher(plan);
    expect(d.hasUnpatrolled()).toBe(false);
    expect(d.take()).toEqual([]);
  });
});

/**
 * 洞察回流：让 AI 自己上几轮的结论参与「先看谁」。
 *
 * 这一组守两条相反的失败：
 *   · **不收敛**——Agent 复核后判定「结论仍成立」于是什么都没写。若用「洞察有没有更新」
 *     销账，这个文件会被每一轮重新点名，永不停止地烧钱，而账面上一切正常；
 *   · **静默降级**——读库失败时把「没读到结论」当成「没有结论」，待复核的文件被判成
 *     「从未分析过」，反而排到更后面，那条过期结论从此永远挂着误导人和模型。
 */
describe("planFocusPatrol · 洞察回流与待复核", () => {
  const stale = (filePath: string, over: Partial<AiInsightDto> = {}): AiInsightDto => ({
    id: `ins_${filePath}`,
    packId: null,
    analysisId: "analysis1",
    agentId: null,
    kind: "risk",
    title: "循环依赖",
    body: "…",
    severity: "high",
    refs: [`${filePath}:10`],
    status: "open",
    lastSeen: 1000,
    changedRefs: [`${filePath}:10`],
    missingRefs: [],
    evidenceDigest: "E1",
    ...over,
  });

  it("欠复核的文件排在「从未巡查」之前：已知问题 + 已知变化，单位 token 的信息量最高", () => {
    // hot.ts 静态分更高却只是 never，stale.ts 静态分低但欠一次复核
    const targets = [target("hot.ts", 5), target("stale.ts", 2)];
    const plan = planFocusPatrol(targets, [], {
      nowSec: NOW,
      feedback: buildInsightFeedback([stale("stale.ts")]),
    });
    expect(plan.picks.map((p) => p.filePath)).toEqual(["stale.ts", "hot.ts"]);
    expect(plan.rows.find((r) => r.filePath === "stale.ts")!.state).toBe("recheck");
  });

  it("失败重派仍排在复核之前——那一档带着重试封顶，是 Agent 配置坏掉时唯一的刹车", () => {
    const targets = [target("fail.ts", 2), target("stale.ts", 2)];
    const assigns = [assignment("fail.ts", { outcome: "error" })];
    const plan = planFocusPatrol(targets, assigns, {
      nowSec: NOW,
      feedback: buildInsightFeedback([stale("stale.ts"), stale("fail.ts")]),
    });
    expect(plan.picks[0].filePath).toBe("fail.ts");
    expect(plan.rows.find((r) => r.filePath === "fail.ts")!.state).toBe("failed");
  });

  it("已为这次证据变化派过单就不再重派 —— 哪怕 Agent 一个字都没写回来", () => {
    // 台账里记的是「派单当时的**聚合**证据指纹」，不是某一条结论的原始 digest：
    // 一个文件可以挂多条结论，逐条比对会让任意一条的变动都触发全文件重派。
    const feedback = buildInsightFeedback([stale("stale.ts")]);
    const dispatched = feedback.byFile.get("stale.ts")!.evidenceDigest;
    const assigns = [assignment("stale.ts", { evidenceDigest: dispatched, contextDigest: "digest-A" })];
    const plan = planFocusPatrol([target("stale.ts", 2)], assigns, {
      currentDigest: "digest-A",
      nowSec: NOW,
      feedback,
    });
    expect(plan.rows[0].state).toBe("patrolled");
    expect(plan.picks).toEqual([]);
    expect(plan.hasPendingRecheck).toBe(false);
  });

  it("派单之后证据又变了 → 重新排队（一次派单不等于终身免检）", () => {
    const before = buildInsightFeedback([stale("stale.ts", { evidenceDigest: "E_OLD" })]);
    const assigns = [
      assignment("stale.ts", {
        evidenceDigest: before.byFile.get("stale.ts")!.evidenceDigest,
        contextDigest: "digest-A",
      }),
    ];
    const plan = planFocusPatrol([target("stale.ts", 2)], assigns, {
      currentDigest: "digest-A",
      nowSec: NOW,
      feedback: buildInsightFeedback([stale("stale.ts", { evidenceDigest: "E_NEW" })]),
    });
    expect(plan.rows[0].state).toBe("recheck");
    expect(plan.hasPendingRecheck).toBe(true);
  });

  it("派单时记下的是**当下**的证据指纹，回写台账才能收敛", () => {
    const plan = planFocusPatrol([target("stale.ts", 2)], [], {
      nowSec: NOW,
      feedback: buildInsightFeedback([stale("stale.ts", { evidenceDigest: "E_NOW" })]),
    });
    // 指纹由 buildInsightFeedback 聚合而成，这里只断言它非空且被带进了点名清单
    expect(plan.picks[0].evidenceDigest).toBeTruthy();
    expect(plan.picks[0].evidenceDigest).toBe(plan.rows[0].insight!.evidenceDigest);
  });

  it("共振只有 1 维但欠复核 → 破格进榜：明细表看不出「这条结论已经作废了」", () => {
    const plan = planFocusPatrol([target("lonely.ts", 1)], [], {
      nowSec: NOW,
      feedback: buildInsightFeedback([stale("lonely.ts", { severity: "critical" })]),
    });
    expect(plan.rows.map((r) => r.filePath)).toEqual(["lonely.ts"]);
    expect(plan.rows[0].state).toBe("recheck");
  });

  it("共振 1 维且没有待复核结论 → 仍被门槛挡住（破格只对复核档开口子）", () => {
    const plan = planFocusPatrol([target("lonely.ts", 1)], [], {
      nowSec: NOW,
      feedback: buildInsightFeedback([stale("lonely.ts", { changedRefs: [] })]),
    });
    expect(plan.rows).toEqual([]);
  });

  it("同为复核时按已知严重度排，但严重度绝不外溢到 resonance / score", () => {
    const targets = [target("low.ts", 3), target("crit.ts", 2)];
    const plan = planFocusPatrol(targets, [], {
      nowSec: NOW,
      feedback: buildInsightFeedback([
        stale("low.ts", { severity: "low" }),
        stale("crit.ts", { severity: "critical" }),
      ]),
    });
    expect(plan.picks.map((p) => p.filePath)).toEqual(["crit.ts", "low.ts"]);
    // 打分保持纯静态：低严重度的那个共振维度仍然更多、分数仍然更高
    const low = plan.rows.find((r) => r.filePath === "low.ts")!;
    const crit = plan.rows.find((r) => r.filePath === "crit.ts")!;
    expect(low.resonance).toBeGreaterThan(crit.resonance);
    expect(low.score).toBeGreaterThan(crit.score);
  });

  it("点名理由把「静态为什么可疑」与「已知结论是什么」都写给 Agent", () => {
    const plan = planFocusPatrol([target("stale.ts", 2)], [], {
      nowSec: NOW,
      feedback: buildInsightFeedback([stale("stale.ts")]),
    });
    expect(plan.picks[0].note).toContain("维度0第");
    expect(plan.picks[0].note).toContain("需复核");
  });

  it("读库失败（available=false）时整条复核链路静默关闭，判定与本特性上线前一致", () => {
    const targets = [target("hot.ts", 5), target("stale.ts", 2)];
    const insights = [stale("stale.ts")];
    const withoutFeedback = planFocusPatrol(targets, [], { nowSec: NOW });
    const broken = planFocusPatrol(targets, [], {
      nowSec: NOW,
      // available=false 表示「没读到」，绝不能被当成「没有结论」
      feedback: buildInsightFeedback(insights, { available: false }),
    });
    expect(broken.picks.map((p) => p.filePath)).toEqual(
      withoutFeedback.picks.map((p) => p.filePath),
    );
    expect(broken.hasPendingRecheck).toBe(false);
  });

  it("hasPendingRecheck 与 hasUnpatrolled 分开记：一个是补空白，一个是还旧账", () => {
    const assigns = [assignment("stale.ts", { contextDigest: "digest-A" })];
    const plan = planFocusPatrol([target("stale.ts", 2)], assigns, {
      currentDigest: "digest-A",
      nowSec: NOW,
      feedback: buildInsightFeedback([stale("stale.ts")]),
    });
    expect(plan.hasPendingRecheck).toBe(true);
    // 这个文件派过单、也跑成了，不算「从未巡查」
    expect(plan.hasUnpatrolled).toBe(false);
  });

  it("复核目标被领完后 dispatcher.hasPendingRecheck 立刻转 false", () => {
    const targets = [target("s1.ts", 2), target("s2.ts", 2)];
    const plan = planFocusPatrol(targets, [], {
      nowSec: NOW,
      feedback: buildInsightFeedback([stale("s1.ts"), stale("s2.ts")]),
    });
    const d = createFocusDispatcher(plan, 2);
    expect(d.hasPendingRecheck()).toBe(true);
    d.take();
    expect(d.hasPendingRecheck()).toBe(false);
  });

  it("汇总里 recheck 单列，stale 的减法必须把它扣掉（否则面板两个数字对不上账）", () => {
    const targets = [target("s.ts", 2), target("n.ts", 2)];
    const plan = planFocusPatrol(targets, [], {
      nowSec: NOW,
      feedback: buildInsightFeedback([stale("s.ts")]),
    });
    const sum = summarizeFocusPatrol(plan.rows);
    expect(sum.recheck).toBe(1);
    expect(sum.never).toBe(1);
    expect(sum.stale).toBe(0);
    expect(sum.total).toBe(2);
  });
});

describe("describePatrolReason · 点名理由必须带名次", () => {
  it("拼出「维度label第 N 名 · ...」，让 Agent 明白「为什么别处没见过这文件却要先看它」", () => {
    const t = target("quiet.ts", 2, {
      dims: { complexity: hit("complexity", "复杂度", 18), churn: hit("churn", "变更", 21) },
      resonantKeys: ["complexity", "churn"],
    });
    const note = describePatrolReason(t);
    expect(note).toContain("复杂度");
    expect(note).toContain("第 18 名");
    expect(note).toContain("变更");
    expect(note).toContain("第 21 名");
    expect(note).toContain(" · ");
  });
});

describe("summarizeFocusPatrol · 面板标题栏汇总", () => {
  it("算出从未/已巡查/比例", () => {
    const targets = [target("a.ts", 2), target("b.ts", 3), target("c.ts", 2)];
    const assigns = [
      assignment("a.ts", { contextDigest: "digest-A" }),
      assignment("b.ts", { contextDigest: "digest-A" }),
    ];
    const plan = planFocusPatrol(targets, assigns, { currentDigest: "digest-A", nowSec: NOW });
    const s = summarizeFocusPatrol(plan.rows);
    expect(s.total).toBe(3);
    expect(s.never).toBe(1); // c.ts 从未派单
    expect(s.patrolled).toBe(2);
    expect(s.patrolledRatio).toBeCloseTo(66.7, 1);
  });

  it("空台账不除零", () => {
    const s = summarizeFocusPatrol([]);
    expect(s.total).toBe(0);
    expect(s.patrolledRatio).toBe(0);
  });
});

describe("planFocusPatrol · 复巡队列的公平性（本特性最容易自我作废的地方）", () => {
  it("stale-data 档按「最久没巡查」排队，不按共振分排——否则活跃开发期会退化回「同一批文件打转」", () => {
    // 场景：活跃开发期。每次扫描都让指纹变化，于是整张共振榜同时翻成 stale-data。
    // 若此时仍按共振分排序，每一轮领走的永远是分数最高的那几个，
    // 它们巡查完又立刻被下一次扫描重新标脏，第 4 名往后一次都轮不到。
    const targets = [
      target("hot.ts", 4), // 共振分最高，但刚刚巡查过
      target("mid.ts", 3), // 分数居中，很久没巡查
      target("low.ts", 2), // 分数最低，最久没巡查
    ];
    const assigns = [
      assignment("hot.ts", { contextDigest: "old", assignedAt: NOW - 60 }),
      assignment("mid.ts", { contextDigest: "old", assignedAt: NOW - 7200 }),
      assignment("low.ts", { contextDigest: "old", assignedAt: NOW - 86400 }),
    ];
    const plan = planFocusPatrol(targets, assigns, { currentDigest: "new", nowSec: NOW });

    expect(plan.rows.every((r) => r.state === "stale-data")).toBe(true);
    expect(plan.queue.map((p) => p.filePath)).toEqual(["low.ts", "mid.ts", "hot.ts"]);
  });

  it("never 档仍按共振分排——它们谁都没被派过单，此时共振分才是对的优先级", () => {
    const targets = [target("low.ts", 2), target("hot.ts", 4), target("mid.ts", 3)];
    const plan = planFocusPatrol(targets, [], { currentDigest: "d1", nowSec: NOW });
    expect(plan.queue.map((p) => p.filePath)).toEqual(["hot.ts", "mid.ts", "low.ts"]);
  });

  it("never 永远排在 stale-data 之前，哪怕后者已经很久没巡查", () => {
    const targets = [target("stale.ts", 4), target("fresh-target.ts", 2)];
    const assigns = [assignment("stale.ts", { contextDigest: "old", assignedAt: NOW - 999999 })];
    const plan = planFocusPatrol(targets, assigns, { currentDigest: "new", nowSec: NOW });
    expect(plan.queue.map((p) => p.filePath)).toEqual(["fresh-target.ts", "stale.ts"]);
  });
});

describe("planFocusPatrol · 派单核销（「派单即销账」的反向漏洞）", () => {
  it("对话失败的那一轮不算巡查过，目标退回队列并撑起 hasUnpatrolled", () => {
    // 这是「派单即销账」留下的反向洞：账销了、事没办。
    // 若按已巡查处理，一次网络抖动就能让共振榜第一名永久沉默——
    // 补跑调度重排的是规则，而台账读到的是「已巡查」，此后再也不点它。
    const targets = [target("a.ts", 3)];
    const assigns = [assignment("a.ts", { outcome: "error" })];
    const plan = planFocusPatrol(targets, assigns, { currentDigest: "digest-A", nowSec: NOW });

    expect(plan.rows[0].state).toBe("failed");
    expect(plan.rows[0].exhausted).toBe(false);
    expect(plan.queue.map((p) => p.filePath)).toEqual(["a.ts"]);
    expect(plan.hasUnpatrolled).toBe(true);
  });

  it("应用被关掉而中断的那一轮同样不算巡查过——死法不同，但账销事没办的结局一样", () => {
    // 回执写在 sendMessage 的回调里，进程还活着才写得成。应用被关掉时那一轮
    // 既没 completed 也没 error，被清算器落定为 interrupted。对用户而言与对话失败
    // 是同一件事：这个文件实际上没有被看过，必须退回队列重排。
    const targets = [target("a.ts", 3)];
    const assigns = [assignment("a.ts", { outcome: "interrupted" })];
    const plan = planFocusPatrol(targets, assigns, { currentDigest: "digest-A", nowSec: NOW });

    expect(plan.rows[0].state).toBe("failed");
    expect(plan.rows[0].exhausted).toBe(false);
    expect(plan.queue.map((p) => p.filePath)).toEqual(["a.ts"]);
    expect(plan.hasUnpatrolled).toBe(true);
  });

  it("中断与对话失败给人的下一步动作不同：文案说「分析中断」而非「对话失败」，免得白排查密钥", () => {
    const targets = [target("a.ts", 3)];
    const assigns = [assignment("a.ts", { outcome: "interrupted" })];
    const plan = planFocusPatrol(targets, assigns, { currentDigest: "digest-A", nowSec: NOW });
    expect(plan.rows[0].state).toBe("failed");
    expect(plan.rows[0].detail).toContain("分析中断");
    expect(plan.rows[0].detail).not.toContain("对话失败");
  });

  it("no-output 不算失败：Agent 没被授权洞察工具时本来就不会有结论沉淀", () => {
    // 若把「跑完没产出」也当未落实，就会换来另一个不收敛的循环：
    // 用户没给 Agent 勾洞察工具，于是每一轮都 no-output、每一轮都重派。
    const targets = [target("a.ts", 3)];
    const assigns = [assignment("a.ts", { outcome: "no-output" })];
    const plan = planFocusPatrol(targets, assigns, { currentDigest: "digest-A", nowSec: NOW });

    expect(plan.rows[0].state).toBe("patrolled");
    expect(plan.hasUnpatrolled).toBe(false);
  });

  it("失败目标排在 never 之前：它已经占用过一次点名名额，再漏一次代价最大", () => {
    const targets = [target("failed.ts", 2), target("new.ts", 4)];
    const assigns = [assignment("failed.ts", { outcome: "error" })];
    const plan = planFocusPatrol(targets, assigns, { currentDigest: "digest-A", nowSec: NOW });
    expect(plan.queue.map((p) => p.filePath)).toEqual(["failed.ts", "new.ts"]);
  });

  it("重试到上限后不再自动排队，也不再撑起 hasUnpatrolled——否则 Agent 配置坏掉时会稳定烧钱", () => {
    // 模型下线 / 密钥过期时每一轮都失败，而失败又让目标重新排队。
    // 没有封顶，自动化会每小时对同一批文件发起一次注定失败的对话，直到有人发现。
    const targets = [target("a.ts", 3)];
    const assigns = [assignment("a.ts", { outcome: "error", assignCount: 3 })];
    const plan = planFocusPatrol(targets, assigns, { currentDigest: "digest-A", nowSec: NOW });

    expect(plan.rows[0].state).toBe("failed");
    expect(plan.rows[0].exhausted).toBe(true);
    expect(plan.rows[0].detail).toContain("重试上限");
    expect(plan.queue).toHaveLength(0);
    expect(plan.hasUnpatrolled).toBe(false);
    // 状态不伪装成「已巡查」：台账上仍标红，交给人处理
    expect(summarizeFocusPatrol(plan.rows).exhausted).toBe(1);
  });

  it("失败判定优先于指纹：数据变了也不能把「没跑成」说成「待复巡」", () => {
    const targets = [target("a.ts", 3)];
    const assigns = [assignment("a.ts", { outcome: "error", contextDigest: "old" })];
    const plan = planFocusPatrol(targets, assigns, { currentDigest: "new", nowSec: NOW });
    expect(plan.rows[0].state).toBe("failed");
  });

  it("历史行没有 outcome 字段时按已巡查处理，台账不会一上线就全部标红", () => {
    const targets = [target("a.ts", 3)];
    const assigns = [assignment("a.ts")]; // outcome 未定义
    const plan = planFocusPatrol(targets, assigns, { currentDigest: "digest-A", nowSec: NOW });
    expect(plan.rows[0].state).toBe("patrolled");
  });

  it("分发器把失败目标也视为未巡查——队列领完才停止 focus-gap", () => {
    const targets = [target("a.ts", 3), target("b.ts", 2)];
    const assigns = [
      assignment("a.ts", { outcome: "error" }),
      assignment("b.ts", { outcome: "error" }),
    ];
    const plan = planFocusPatrol(targets, assigns, { currentDigest: "digest-A", nowSec: NOW });
    const d = createFocusDispatcher(plan, 1);
    expect(d.hasUnpatrolled()).toBe(true);
    d.take();
    expect(d.hasUnpatrolled()).toBe(true); // 还剩一个
    d.take();
    expect(d.hasUnpatrolled()).toBe(false); // 领完了，第二条规则不该再以 focus-gap 空跑
  });
});
