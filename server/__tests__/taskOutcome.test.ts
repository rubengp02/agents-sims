import { describe, expect, it } from 'vitest';

import { parseTaskOutcome } from '../src/execution/taskOutcome.js';

describe('task outcome, separate from CLI success', () => {
  it.each(['completed', 'blocked', 'failed'] as const)(
    'accepts explicit final status %s',
    (status) => {
      expect(
        parseTaskOutcome(`Respuesta real\nOFFICE_RESULT ${JSON.stringify({ status })}\n`),
      ).toBe(status);
    },
  );
  it.each([
    'No pude crear archivos.',
    'OFFICE_RESULT {"status":"completed"}\nPero no se ha realizado.',
    'OFFICE_RESULT {"status":"completed"}\n```',
    'OFFICE_RESULT {"status":"unknown"}',
    'OFFICE_RESULT {"status":"completed","extra":true}',
    'OFFICE_RESULT ["completed"]',
    'OFFICE_RESULT null',
    'OFFICE_RESULT {"status":true}',
    'OFFICE_RESULT malformed',
  ])('leaves unverified output blocked: %s', (output) => {
    expect(parseTaskOutcome(output)).toBeNull();
  });
  it('uses the final declaration rather than a preceding success', () => {
    expect(
      parseTaskOutcome(
        'OFFICE_RESULT {"status":"completed"}\nNo hubo permisos.\nOFFICE_RESULT {"status":"blocked"}',
      ),
    ).toBe('blocked');
  });
});
