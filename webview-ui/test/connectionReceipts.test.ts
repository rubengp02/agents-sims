import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { ConnectionOperationRecords } from '../src/components/ConnectionReceipts.js';

it('shows coverage, approval and uncertainty without claiming old operations or repeating them', () => {
  const html = renderToStaticMarkup(
    createElement(ConnectionOperationRecords, {
      log: {
        recordingStartedAt: 1000,
        historicalCoverage: 'No acredita operaciones anteriores.',
        operations: [
          {
            id: 'receipt-one',
            connectionId: 'connection',
            tool: 'fixture',
            status: 'review_required',
            createdAt: 1000,
            updatedAt: 2000,
            argumentsHash: 'argument-hash',
            toolDefinitionHash: 'schema-hash',
            approval: { id: 'approval-one', fingerprint: 'fingerprint', approvedAt: 500 },
            review: { acknowledgedAt: 3000, outcome: 'not_determined' },
          },
        ],
      },
    }),
  );
  expect(html).toContain('No acredita operaciones anteriores');
  expect(html).toContain('Resultado incierto');
  expect(html).toContain('approval-one');
  expect(html).toContain('receipt-one');
  expect(html).toContain('no determina si la operación se realizó');
  expect(html).toContain('no repite la operación');
  expect(html).not.toContain('<button');
});
