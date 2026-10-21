export function accountFixture() {
  return {
    account: { type: 'chatgpt', planType: 'plus', email: 'private@example.invalid' },
    requiresOpenaiAuth: true,
  };
}
export function limitsFixture() {
  return {
    rateLimitsByLimitId: {
      codex: {
        planType: 'plus',
        primary: { usedPercent: 20, resetsAt: 4_000_000_000 },
        secondary: null,
        rateLimitReachedType: null,
        credits: { hasCredits: false, unlimited: false, balance: '0' },
      },
    },
  };
}
export function modelsFixture() {
  return {
    data: [
      {
        model: 'gpt-6.1-sol',
        supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }],
      },
    ],
    nextCursor: null,
  };
}
