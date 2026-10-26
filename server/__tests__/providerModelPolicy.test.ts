import { describe, expect, it } from 'vitest';

import { chooseProviderModel } from '../src/execution/providerModelPolicy.js';
import { chooseModel } from '../src/execution/teamPolicy.js';
import type { SubscriptionEvidence } from '../src/execution/types.js';

const task = {
  prompt: 'Explica brevemente el proyecto.',
  role: 'chief' as const,
  override: null,
};
const native: SubscriptionEvidence = {
  checkedAt: 1,
  plan: 'google-included',
  quota: [],
  models: [
    { id: 'gemini-test-high', efforts: ['default'] },
    { id: 'gemini-test-low', efforts: ['default'] },
  ],
};
describe('provider model policy', () => {
  it('assesses the actual objective instead of internal security boilerplate', () => {
    const result = chooseProviderModel(
      { ...task, prompt: 'Comprueba los permisos y la seguridad antes de responder.' },
      native,
      'antigravity',
      task.prompt,
    );
    expect(result.choice.model).toBe('gemini-test-low');
    expect(result.explanation).toContain('provisional');
  });
  it.each([
    ['tester', task.prompt],
    ['chief', 'Implementa autenticación y control de acceso.'],
  ] as const)('uses the stronger native model for %s and relevant risk', (role, objective) => {
    expect(
      chooseProviderModel({ ...task, role }, native, 'antigravity', objective).choice.model,
    ).toBe('gemini-test-high');
  });
  it('preserves an explicit native choice and rejects it if unavailable', () => {
    const override = {
      provider: 'antigravity' as const,
      model: 'gemini-test-high',
      effort: 'default',
    };
    const result = chooseProviderModel({ ...task, override }, native, 'antigravity', task.prompt);
    expect(result.choice).toEqual(override);
    expect(result.explanation).toContain('manual');
    expect(() =>
      chooseProviderModel(
        { ...task, override },
        { ...native, models: [] },
        'antigravity',
        task.prompt,
      ),
    ).toThrow('no está disponible');
  });
  it('falls back only within the verified native catalog and rejects an empty catalog', () => {
    const catalog = { ...native, models: [{ id: 'claude-test', efforts: ['default'] }] };
    expect(chooseProviderModel(task, catalog, 'antigravity', task.prompt).choice.model).toBe(
      'claude-test',
    );
    expect(() =>
      chooseProviderModel(task, { ...native, models: [] }, 'antigravity', task.prompt),
    ).toThrow('no está disponible');
  });
  it('leaves Codex routing and the Chief proposal unchanged', () => {
    const evidence = {
      ...native,
      plan: 'plus' as const,
      models: [{ id: 'gpt-6.1-sol', efforts: ['low', 'medium'] }],
    };
    const proposed = {
      ...task,
      proposedChoice: { provider: 'codex' as const, model: 'gpt-6.1-sol', effort: 'medium' },
    };
    expect(chooseProviderModel(proposed, evidence, 'codex', task.prompt)).toEqual(
      chooseModel(proposed, evidence),
    );
  });
});
