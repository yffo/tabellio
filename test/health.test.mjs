/**
 * `health` 的聚合口径。
 *
 * 这里只喂固定时间戳的合成日志，不碰真实库：健康报告的每个字段都是
 * 「别人拿去做趋势」的数字，口径错了比功能缺了更难发现。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildHealthReport, formatHealth } from '../src/health.js';
import { tempDir, rm } from './helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'bin', 'memory');
// 相对真实时间生成日志：CLI 用例不能注入 now，只能保证两条路径看到同一窗口。
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function remember(dir, title, body) {
  const source = join(dir, `${title}.source.md`);
  writeFileSync(source, `# ${title}\n\n${body}\n`, 'utf8');
  const run = spawnSync(
    process.execPath,
    [CLI, 'remember', '--file', source, '--kind', 'semantic', '--trust', 'user_stated', '--json'],
    { encoding: 'utf8', env: { ...process.env, MEMORY_STORE: dir } },
  );
  assert.equal(run.status, 0, run.stderr);
}

function seedStore() {
  const dir = tempDir('memory-health-');
  const runs = join(dir, 'runs');
  mkdirSync(runs, { recursive: true });
  remember(dir, '构建命令', 'acme-widget 用 pnpm build。');
  remember(dir, '部署约定', '先跑 typecheck 再发布。');

  const audit = [
    // 窗口内：两次注入、一次意图闸、一次拒答、一次裁决丢弃
    { at: NOW - 1 * DAY, mode: 'context', refused: false, count: 2, chars: 300, elapsedMs: 520, judged: false, reason: null },
    { at: NOW - 2 * DAY, mode: 'notice', refused: false, count: 1, chars: 120, elapsedMs: 300, judged: true, reason: null },
    { at: NOW - 3 * DAY, mode: 'suppressed', refused: false, count: 0, chars: 0, elapsedMs: 40, judged: false, reason: 'no_memory_intent' },
    { at: NOW - 4 * DAY, mode: 'refused', refused: true, count: 0, chars: 0, elapsedMs: 60, judged: false, reason: 'top_score_below_threshold' },
    { at: NOW - 5 * DAY, mode: 'judged_out', refused: false, count: 0, chars: 0, elapsedMs: 1800, judged: true, reason: 'llm_judge_kept_none' },
    // 窗口外：不该进统计
    { at: NOW - 20 * DAY, mode: 'context', refused: false, count: 9, chars: 9999, elapsedMs: 9999, judged: false, reason: null },
  ];
  writeFileSync(join(runs, 'recall-audit-2026-10.jsonl'), audit.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  writeFileSync(
    join(runs, 'usage.jsonl'),
    [
      { at: NOW - 1 * DAY, mode: 'context', chars: 300, judge: 1, judgeMs: 900, semantic: 1, notes: 2 },
      { at: NOW - 2 * DAY, mode: 'notice', chars: 120, judge: 0, judgeMs: 0, semantic: 1, notes: 1 },
    ].map((row) => JSON.stringify(row)).join('\n') + '\n',
    'utf8',
  );
  writeFileSync(
    join(runs, 'feedback.jsonl'),
    [{ signal: 'corrected', noteIds: ['note-a'], query: '构建用哪个命令？', source: 'test', at: NOW - DAY }]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n',
    'utf8',
  );
  return dir;
}

test('health counts only the window and never invents missing data', (t) => {
  const dir = seedStore();
  t.after(() => rm(dir));
  const report = buildHealthReport(dir, { days: 7, now: NOW });

  assert.equal(report.window.days, 7);
  assert.equal(report.notes.total, 2);
  assert.equal(report.notes.parseFailures, 0);
  assert.equal(report.recall.turns, 5);
  assert.equal(report.recall.injected, 2);
  assert.equal(report.recall.suppressed, 1);
  assert.equal(report.recall.refused, 1);
  assert.equal(report.recall.judgedOut, 1);
  assert.equal(report.recall.injectRate, 0.4);
  assert.equal(report.injection.notesMean, 1.5);
  assert.equal(report.injection.charsP50, 120);
  assert.equal(report.injection.charsMax, 300);
  assert.equal(report.injection.tokensApproxP50, 60);
  // 延迟只看真正注入的两轮：40/60ms 的拦截轮次不算「用户等记忆的时间」。
  assert.equal(report.latency.samples, 2);
  assert.equal(report.latency.max, 520);
  assert.equal(report.judge.calls, 1);
  assert.equal(report.judge.msP50, 900);
  assert.equal(report.feedback.total, 1);
  assert.equal(report.feedback.bySignal.corrected, 1);
  assert.deepEqual(report.warnings, []);
});

test('health says what is missing instead of reporting zeros', (t) => {
  const dir = tempDir('memory-health-empty-');
  t.after(() => rm(dir));
  const report = buildHealthReport(dir, { days: 7, now: NOW });
  assert.equal(report.notes.total, 0);
  assert.equal(report.recall.turns, 0);
  assert.ok(report.warnings.some((line) => line.includes('还没有召回审计')));
  assert.ok(report.warnings.some((line) => line.includes('还没有用量日志')));
  assert.match(formatHealth(report), /最近 7 天/);
});

test('cli health --json prints one parseable object and exits 0', (t) => {
  const dir = seedStore();
  t.after(() => rm(dir));
  const run = spawnSync(process.execPath, [CLI, 'health', '--days', '7', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, MEMORY_STORE: dir },
  });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.notes.total, 2);
  assert.equal(report.recall.turns, 5);
  assert.equal(report.window.days, 7);
});
