const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function bindUsage(view, snapshot) {
  const validThread = uuid.test(view.threadId ?? '') && snapshot.threadId === view.threadId;
  const sourceReady = validThread && snapshot.sourceState === 'ready' && snapshot.accountingMatches;
  const turns = new Map((validThread ? snapshot.turns ?? [] : []).map(turn => [turn.id, turn]));
  const replies = {};
  for (const slot of view.replies ?? []) {
    const matches = [...new Set(slot.turnCandidates ?? [])].filter(id => turns.has(id));
    const turn = matches.length === 1 ? turns.get(matches[0]) : null;
    replies[slot.slotId] = turn?.accountingMatches ? {
      turnId: turn.id, totalTokens: turn.usage.total_tokens, inputTokens: turn.usage.input_tokens,
      outputTokens: turn.usage.output_tokens, cachedInputTokens: turn.usage.cached_input_tokens,
      cacheWriteTokens: turn.cacheWriteAvailable ? turn.usage.cache_write_input_tokens : null,
      reasoningTokens: turn.reasoningAvailable ? turn.usage.reasoning_output_tokens : null,
      provider: turn.provider ?? null, models: turn.models ?? [],
      status: turn.status, steps: turn.steps,
    } : { reason: matches.length > 1 ? 'ambiguous-turn' : 'unmatched-turn' };
  }
  return {
    threadId: validThread ? view.threadId : null,
    sourceState: validThread ? snapshot.sourceState : 'unbound',
    sampledAt: snapshot.sampledAt,
    summary: validThread && ['ready', 'waiting-usage'].includes(snapshot.sourceState) ? {
      turns: snapshot.recordedTurns, steps: snapshot.steps,
      totalTokens: sourceReady ? snapshot.reportedUsage.total_tokens : null,
      inputTokens: sourceReady ? snapshot.reportedUsage.input_tokens : null,
      cachedInputTokens: sourceReady ? snapshot.reportedUsage.cached_input_tokens : null,
      outputTokens: sourceReady ? snapshot.reportedUsage.output_tokens : null,
      cachedPercent: sourceReady ? snapshot.cachePercent : null,
      outputSpeed: sourceReady ? snapshot.outputSpeed : null,
      outputSpeedSamples: snapshot.outputSpeedSamples,
      performance: sourceReady ? snapshot.performance ?? null : null,
      contextPercent: snapshot.contextPercent,
      contextTokens: snapshot.contextTokens, contextWindow: snapshot.contextWindow,
      contextAt: snapshot.contextAt ?? null, contextEstimated: snapshot.contextEstimated !== false,
      inheritedTokens: snapshot.inheritedUsage?.total_tokens ?? null,
      accountingMatches: snapshot.accountingMatches,
    } : null,
    replies,
  };
}
