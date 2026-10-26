/**
 * `health` —— 一个库的「最近用得怎么样」体检。
 *
 * 为什么不是又一个 dashboard：使用证据现在散在 `runs/*.jsonl` 里（插件写召回审计、
 * 用量、反馈），只有开发时才会去翻。这个模块把它们聚合成一张可复制的表，
 * 让「要不要调参 / 哪条路在浪费」用数字回答，而不是靠感觉。
 *
 * 口径：
 *   - 只读：不写任何文件；缺日志就说缺，不编 0。
 *   - 最近 N 天窗口（默认 7），所有比率都以窗口内为准。
 *   - 召回审计由宿主插件写入；没有插件的库只有规模/候选/反馈，其余整块缺席。
 *   - token 是估算：审计只记注入块字符数，按中文约 2 字/token 折算。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { scanStore } from './store/vault.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const INJECTED_MODES = new Set(['context', 'notice']);

function readJsonl(path) {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 读窗口内的召回审计（插件写；没有就返回空数组）。 */
export function readAudit(storePath, { days = 7, now = Date.now() } = {}) {
  const dir = join(storePath, 'runs');
  if (!existsSync(dir)) return { rows: [], files: [] };
  let names = [];
  try {
    names = readdirSync(dir).filter((name) => /^recall-audit-\d{4}-\d{2}\.jsonl$/.test(name)).sort();
  } catch {
    return { rows: [], files: [] };
  }
  const since = now - days * DAY_MS;
  const rows = [];
  for (const name of names) {
    for (const row of readJsonl(join(dir, name))) {
      if (Number(row.at) >= since && Number(row.at) <= now) rows.push(row);
    }
  }
  rows.sort((a, b) => Number(a.at) - Number(b.at));
  return { rows, files: names };
}

/** 窗口内的用量日志：judge 调用次数/耗时、语义命中次数。 */
function readUsage(storePath, { days, now }) {
  const since = now - days * DAY_MS;
  const rows = readJsonl(join(storePath, 'runs', 'usage.jsonl')).filter(
    (row) => Number(row.at) >= since && Number(row.at) <= now,
  );
  const judgeMs = rows.filter((row) => Number(row.judge) > 0 && Number(row.judgeMs) > 0).map((row) => Number(row.judgeMs));
  return {
    rows: rows.length,
    judgeCalls: rows.filter((row) => Number(row.judge) > 0).length,
    judgeMs,
    semanticTurns: rows.filter((row) => Number(row.semantic) > 0).length,
  };
}

/** 窗口内的反馈：纠正 / useful / wrong / stale。 */
function readFeedback(storePath, { days, now }) {
  const since = now - days * DAY_MS;
  const rows = readJsonl(join(storePath, 'runs', 'feedback.jsonl')).filter(
    (row) => Number(row.at) >= since && Number(row.at) <= now,
  );
  const bySignal = {};
  for (const row of rows) {
    const signal = String(row.signal ?? 'unknown');
    bySignal[signal] = (bySignal[signal] ?? 0) + 1;
  }
  return { total: rows.length, bySignal };
}

/**
 * 汇总一个库的窗口健康度。
 *
 * @param {string} storePath 库目录
 * @param {{days?: number, now?: number}} [options]
 */
export function buildHealthReport(storePath, { days = 7, now = Date.now() } = {}) {
  const windowDays = Math.max(1, Math.min(365, Math.round(Number(days) || 7)));
  const since = now - windowDays * DAY_MS;
  const scan = scanStore(storePath, { includeCandidates: true });
  const notes = scan.notes.filter((entry) => entry.ok !== false);
  const added = notes.filter((entry) => Number(entry.mtime) >= since || Date.parse(entry.note?.valid_from ?? '') >= since);

  const { rows, files } = readAudit(storePath, { days: windowDays, now });
  const usage = readUsage(storePath, { days: windowDays, now });
  const feedback = readFeedback(storePath, { days: windowDays, now });

  const modes = {};
  for (const row of rows) modes[String(row.mode ?? 'unknown')] = (modes[String(row.mode ?? 'unknown')] ?? 0) + 1;

  const injected = rows.filter((row) => INJECTED_MODES.has(String(row.mode)) && Number(row.count) > 0);
  const chars = injected.map((row) => Number(row.chars) || 0).filter((value) => value > 0);
  // 延迟只统计真正注入了记忆的轮次：被意图闸/拒答挡掉的轮次本来就快，混在一起
  // 会把「用户等记忆的时间」稀释成一个好看但没用的中位数。
  const latency = injected.map((row) => Number(row.elapsedMs) || 0).filter((value) => value > 0);
  const slow = latency.filter((value) => value >= 1500);
  const cold = latency.filter((value) => value >= 2000);

  const warnings = [];
  if (!scan.notes.length) warnings.push('库里还没有笔记');
  if (scan.failures.length) warnings.push(`${scan.failures.length} 个文件解析失败，先跑 tabellio doctor`);
  if (!files.length) warnings.push('还没有召回审计（插件未装或未产生记录）');
  if (!usage.rows) warnings.push('还没有用量日志（runs/usage.jsonl 不存在）');

  return {
    store: storePath,
    generatedAt: now,
    window: { days: windowDays, since, until: now },
    notes: {
      total: scan.notes.length,
      added: added.length,
      candidates: scan.candidates.length,
      parseFailures: scan.failures.length,
      bytes: scan.bytes,
    },
    recall: {
      turns: rows.length,
      injected: injected.length,
      suppressed: modes.suppressed ?? 0,
      refused: modes.refused ?? 0,
      judgedOut: modes.judged_out ?? 0,
      notice: modes.notice ?? 0,
      deduped: modes.deduped ?? 0,
      other: rows.length - (injected.length + (modes.suppressed ?? 0) + (modes.refused ?? 0) + (modes.judged_out ?? 0) + (modes.deduped ?? 0)),
      injectRate: rows.length ? round(injected.length / rows.length, 3) : 0,
    },
    injection: {
      notesMean: injected.length ? round(mean(injected.map((row) => Number(row.count) || 0)), 2) : 0,
      charsP50: percentile(chars, 50),
      charsP90: percentile(chars, 90),
      charsMax: chars.length ? Math.max(...chars) : 0,
      tokensApproxP50: Math.ceil(percentile(chars, 50) / 2),
      tokensApproxP90: Math.ceil(percentile(chars, 90) / 2),
    },
    latency: {
      samples: latency.length,
      p50: percentile(latency, 50),
      p90: percentile(latency, 90),
      max: latency.length ? Math.max(...latency) : 0,
      slow: slow.length,
      slowRate: latency.length ? round(slow.length / latency.length, 3) : 0,
      cold: cold.length,
    },
    judge: {
      calls: usage.judgeCalls,
      msP50: percentile(usage.judgeMs, 50),
      msP90: percentile(usage.judgeMs, 90),
      semanticTurns: usage.semanticTurns,
    },
    feedback,
    warnings,
  };
}

/** 人类可读表格；`tabellio health` 默认走这里。 */
export function formatHealth(report) {
  const { window, notes, recall, injection, latency, judge, feedback } = report;
  const from = new Date(window.since).toISOString().slice(0, 10);
  const to = new Date(window.until).toISOString().slice(0, 10);
  const pct = (value) => `${Math.round(value * 100)}%`;
  const lines = [
    `tabellio health — 最近 ${window.days} 天（${from} → ${to}）`,
    `库：${report.store}`,
    `规模：${notes.total} 条笔记（窗口内新增 ${notes.added}）· 候选待批 ${notes.candidates} · 解析失败 ${notes.parseFailures}`,
    `召回：${recall.turns} 次 → 注入 ${recall.injected}（${pct(recall.injectRate)}）· 意图闸拦 ${recall.suppressed} · 拒答 ${recall.refused} · 裁决丢弃 ${recall.judgedOut}`,
    `注入：每次 ${injection.notesMean} 条 · ${injection.charsP50} 字（p90 ${injection.charsP90}，≈${injection.tokensApproxP50} token）`,
    `延迟：p50 ${latency.p50}ms · p90 ${latency.p90}ms · 慢轮(≥1.5s) ${latency.slow}/${latency.samples} · 冷启动(≥2s) ${latency.cold}`,
    `judge：窗口内调用 ${judge.calls} 次 · p50 ${judge.msP50}ms · 语义命中 ${judge.semanticTurns} 轮`,
    `反馈：${feedback.total} 条（${Object.entries(feedback.bySignal).map(([k, v]) => `${k} ${v}`).join(' · ') || '无'}）`,
  ];
  for (const warning of report.warnings) lines.push(`⚠️  ${warning}`);
  return lines.join('\n');
}
