import { describe, expect, it } from 'vitest';

import { cliMetricsObserver, createExecutionMetrics } from '../src/execution/executionMetrics.js';
import { ROLE_PROFILES, roleOutcomeInstruction } from '../src/execution/roleProfiles.js';
import { prepareTaskContext } from '../src/execution/taskContext.js';

describe('safe execution counters, no inference', () => {
  it('deduplicates completions and keeps only fixed aggregates, including UTF-8 size', () => {
    const m = createExecutionMetrics('codex-json', 'privado ñ', 'prefijo privado ñ');
    const observe = cliMetricsObserver(m);
    const event = {
      type: 'item.completed',
      item: {
        id: 'private-id',
        type: 'command_execution',
        command: 'private command',
        aggregated_output: 'ñ',
      },
    };
    observe({ type: 'item.started', item: event.item });
    observe(event);
    observe(event);
    observe({ type: 'item.completed', item: { id: 'second', type: 'command_execution' } });
    observe({
      type: 'item.completed',
      item: { type: 'file_change', changes: [{ path: '/secret/path' }] },
    });
    observe({ type: 'turn.completed', usage: { input_tokens: 1 } });
    expect(m).toMatchObject({
      completedToolEvents: 3,
      commandEvents: 2,
      fileChangeEvents: 1,
      duplicateToolEvents: 1,
      observedToolOutputUtf8Bytes: 2,
      toolOutputMissing: 1,
      completedTurns: 1,
      usageEvents: 1,
      activityEvents: 1,
      fileReads: null,
      internalModelRequests: null,
    });
    const saved = JSON.stringify(m);
    for (const text of ['private', 'privado', '/secret', 'ñ']) expect(saved).not.toContain(text);
    expect(m.promptUtf8Bytes).toBeGreaterThan(m.promptCharacters);
  });
  it('bounds identifier storage without affecting task acceptance or calling a tool', () => {
    const m = createExecutionMetrics('codex-json', 'x');
    const observe = cliMetricsObserver(m);
    observe({ type: 'item.completed', item: { id: 'x'.repeat(257), type: 'command_execution' } });
    expect(m.counterSaturated).toBe(true);
    expect(m.completedToolEvents).toBe(0);
  });
  it('does not call AO activity events completed tools or file reads', () => {
    const m = createExecutionMetrics('ao-activity', 'x');
    expect(m.completedToolEvents).toBeNull();
    expect(m.observedToolOutputUtf8Bytes).toBeNull();
    expect(m.fileReads).toBeNull();
  });
});

describe('opt-in minimal renderer', () => {
  const packet = {
    objective: 'Objetivo exacto',
    files: ['a.ts'],
    decisions: ['Conserva ñ'],
    acceptance: ['Criterio A', 'Criterio B'],
    checks: ['local'],
  };
  it('removes only an exactly repeated objective and empty history', () => {
    const baseline = prepareTaskContext('developer', packet.objective, packet);
    const minimal = prepareTaskContext('developer', packet.objective, packet, [], {
      variant: 'minimal-v1',
    });
    expect(baseline.prompt.split(packet.objective)).toHaveLength(3);
    expect(minimal.prompt.split(packet.objective)).toHaveLength(2);
    expect(minimal.characters).toBeLessThan(baseline.characters);
    for (const text of [
      ...packet.acceptance,
      ...packet.decisions,
      ...packet.files,
      ...packet.checks,
      ROLE_PROFILES.developer,
      roleOutcomeInstruction('developer'),
      'No delegues ni uses otros proveedores',
    ])
      expect(minimal.prompt).toContain(text);
    expect(minimal.utf8Bytes).toBe(Buffer.byteLength(minimal.prompt));
  });
  it('preserves different instructions, acceptance and truncated handoffs', () => {
    const p = prepareTaskContext(
      'developer',
      'Objetivo exacto. Además conserva permisos.',
      packet,
      [{ title: 'Autor', output: 'x'.repeat(10000) }],
      { variant: 'minimal-v1' },
    );
    expect(p.prompt).toContain('Además conserva permisos.');
    expect(p.prompt).toContain('"truncated":true');
    expect(p.dependencyTruncated).toBe(true);
    expect(p.prompt).toContain('Criterio B');
  });
});
