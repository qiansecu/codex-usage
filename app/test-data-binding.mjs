import test from 'node:test';
import assert from 'node:assert/strict';
import { bindUsage } from './data-binding.mjs';
const a = '11111111-1111-7111-8111-111111111111';
const b = '22222222-2222-7222-8222-222222222222';
const first = '33333333-3333-7333-8333-333333333333';
const second = '44444444-4444-7444-8444-444444444444';
const makeTurn = (id, total) => ({ id, accountingMatches: true, usage: { total_tokens: total }, status: 'completed', steps: 1 });
const snapshot = { threadId: a, sourceState: 'ready', accountingMatches: true,
  reportedUsage: { total_tokens: 300 }, recordedTurns: 2, steps: 2,
  turns: [makeTurn(first, 100), makeTurn(second, 200)] };

test('binds each visible reply to its actual turn even in reversed DOM order', () => {
  const frame = bindUsage({ threadId: a, replies: [
    { slotId: 'x', turnCandidates: [second] }, { slotId: 'y', turnCandidates: [first] },
  ] }, snapshot);
  assert.equal(frame.replies.x.totalTokens, 200);
  assert.equal(frame.replies.y.totalTokens, 100);
  assert.equal(frame.summary.totalTokens, 300);
});
test('chat switching cannot apply the previous chat snapshot', () => {
  const frame = bindUsage({ threadId: b, replies: [{ slotId: 'x', turnCandidates: [first] }] }, snapshot);
  assert.equal(frame.threadId, null);
  assert.equal(frame.summary, null);
  assert.equal(frame.replies.x.totalTokens, undefined);
});
test('unknown or ambiguous turns stay unknown rather than using position', () => {
  const frame = bindUsage({ threadId: a, replies: [
    { slotId: 'x', turnCandidates: [] }, { slotId: 'y', turnCandidates: [first, second] },
  ] }, snapshot);
  assert.equal(frame.replies.x.totalTokens, undefined);
  assert.equal(frame.replies.y.reason, 'ambiguous-turn');
});
test('failed cumulative accounting is not displayed as a trusted total', () => {
  const frame = bindUsage({ threadId: a, replies: [] }, { ...snapshot, accountingMatches: false, performance: { modelActiveMs: 3000 } });
  assert.equal(frame.summary.totalTokens, null);
  assert.equal(frame.summary.performance, null);
});

test('detail keeps real zero distinct from unrecorded optional token fields and uses that turn model', () => {
  const record = { ...makeTurn(first, 100), provider: 'openai_http', models: ['past-model'],
    cacheWriteAvailable: true, reasoningAvailable: true,
    usage: { total_tokens: 100, cache_write_input_tokens: 0, reasoning_output_tokens: 20 } };
  const view = { threadId: a, replies: [{ slotId: 'x', turnCandidates: [first] }] };
  let reply = bindUsage(view, { ...snapshot, turns: [record] }).replies.x;
  assert.equal(reply.cacheWriteTokens, 0); assert.equal(reply.reasoningTokens, 20);
  assert.deepEqual(reply.models, ['past-model']);
  reply = bindUsage(view, { ...snapshot, turns: [{ ...record, cacheWriteAvailable: false }] }).replies.x;
  assert.equal(reply.cacheWriteTokens, null);
});

test('session details use reported cumulative fields rather than local-only totals', () => {
  const data = { ...snapshot, reportedUsage: { total_tokens: 1000, input_tokens: 900, cached_input_tokens: 800, output_tokens: 100 },
    localUsage: { total_tokens: 500 }, inheritedUsage: { total_tokens: 500 } };
  const summary = bindUsage({ threadId: a, replies: [] }, data).summary;
  assert.equal(summary.totalTokens, 1000);
  assert.equal(summary.inputTokens, 900);
  assert.equal(summary.cachedInputTokens, 800);
  assert.equal(summary.outputTokens, 100);
  assert.equal(summary.inheritedTokens, 500);
});
