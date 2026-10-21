/** Independent acceptance: never reads model answers, sessions or modified public tests. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export async function verifyCase(id, project) {
  const tests = [];
  const check = async (name, fn) => {
    try {
      await fn();
      tests.push({ id: name, passed: true });
    } catch {
      tests.push({ id: name, passed: false });
    }
  };
  const load = (file) => import(pathToFileURL(resolve(project, file)).href);
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  };
  const observe = (promise) =>
    promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
  try {
    if (id === 'easy') {
      const { normalizeLabel } = await load('label.mjs');
      for (const [index, input, output] of [
        [0, '  HoLA  ', 'hola'],
        [1, 'UNO   DOS', 'uno dos'],
        [2, 'A\t\nB', 'a b'],
        [3, '\u00a0ÁRBOL\u2003VERDE\u00a0', 'árbol verde'],
        [4, '', ''],
        [5, ' \n\t ', ''],
        [6, 'ÉXITO, ¿SÍ?', 'éxito, ¿sí?'],
        [7, 'a b', 'a b'],
      ])
        await check(`value-${index}`, () => assert.equal(normalizeLabel(input), output));
      for (const [index, value] of [null, undefined, 123, {}, [], true].entries())
        await check(`type-${index}`, () => assert.throws(() => normalizeLabel(value), TypeError));
      await check('idempotent', () =>
        assert.equal(normalizeLabel(normalizeLabel(' A  B ')), normalizeLabel(' A  B ')),
      );
    } else if (id === 'medium') {
      const { parseCents } = await load('money.mjs');
      const { calculateInvoice } = await load('invoice.mjs');
      for (const [index, price, cents] of [
        [0, '0.00', 0],
        [1, '12.34', 1234],
        [2, '90071992547409.91', Number.MAX_SAFE_INTEGER],
      ])
        await check(`parse-${index}`, () => assert.equal(parseCents(price), cents));
      for (const [index, value] of [
        '01.00',
        '1',
        '1.0',
        '1.000',
        '+1.00',
        '-1.00',
        ' 1.00',
        '1.00 ',
        '1e2',
        1,
        null,
      ].entries())
        await check(`parse-invalid-${index}`, () =>
          assert.throws(() => parseCents(value), TypeError),
        );
      await check('parse-overflow', () =>
        assert.throws(() => parseCents('90071992547409.92'), RangeError),
      );
      await check('empty', () =>
        assert.deepEqual(calculateInvoice([]), {
          subtotalCents: 0,
          discountCents: 0,
          totalCents: 0,
        }),
      );
      await check('half-up', () =>
        assert.deepEqual(calculateInvoice([{ price: '0.01', quantity: 1 }], 5000), {
          subtotalCents: 1,
          discountCents: 1,
          totalCents: 0,
        }),
      );
      await check('round-once', () =>
        assert.deepEqual(
          calculateInvoice(
            [
              { price: '0.01', quantity: 1 },
              { price: '0.01', quantity: 1 },
            ],
            5000,
          ),
          { subtotalCents: 2, discountCents: 1, totalCents: 1 },
        ),
      );
      await check('full-discount', () =>
        assert.deepEqual(calculateInvoice([{ price: '1.23', quantity: 2 }], 10000), {
          subtotalCents: 246,
          discountCents: 246,
          totalCents: 0,
        }),
      );
      await check('safe-boundary', () =>
        assert.deepEqual(calculateInvoice([{ price: '90071992547409.91', quantity: 1 }], 1), {
          subtotalCents: 9007199254740991,
          discountCents: 900719925474,
          totalCents: 9006298534815517,
        }),
      );
      await check('sum-overflow', () =>
        assert.throws(
          () => calculateInvoice([{ price: '90071992547409.91', quantity: 2 }]),
          RangeError,
        ),
      );
      await check('invalid-lines', () => assert.throws(() => calculateInvoice({}), TypeError));
      await check('invalid-item', () => assert.throws(() => calculateInvoice([null]), TypeError));
      await check('quantity-type', () =>
        assert.throws(() => calculateInvoice([{ price: '1.00', quantity: '1' }]), TypeError),
      );
      for (const [index, value] of [0, -1, 1.2, 1001, NaN].entries())
        await check(`quantity-range-${index}`, () =>
          assert.throws(() => calculateInvoice([{ price: '1.00', quantity: value }]), RangeError),
        );
      await check('discount-type', () => assert.throws(() => calculateInvoice([], '1'), TypeError));
      for (const [index, value] of [-1, 10001, 1.2, NaN].entries())
        await check(`discount-range-${index}`, () =>
          assert.throws(() => calculateInvoice([], value), RangeError),
        );
      await check('immutable', () => {
        const input = Object.freeze([Object.freeze({ price: '3.27', quantity: 4 })]);
        assert.deepEqual(calculateInvoice(input, 2500), {
          subtotalCents: 1308,
          discountCents: 327,
          totalCents: 981,
        });
      });
      await check('generated-integer-cases', () => {
        // Integer-rational oracle, rounded via quotient/remainder rather than fixture formula.
        for (let cents = 1; cents <= 199; cents += 11)
          for (const bps of [0, 1, 3333, 5000, 9999, 10000]) {
            const product = BigInt(cents) * BigInt(bps),
              quotient = product / 10000n,
              remainder = product % 10000n;
            const discount = Number(quotient + (remainder >= 5000n ? 1n : 0n));
            assert.deepEqual(
              calculateInvoice(
                [
                  {
                    price: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`,
                    quantity: 1,
                  },
                ],
                bps,
              ),
              { subtotalCents: cents, discountCents: discount, totalCents: cents - discount },
            );
          }
      });
    } else if (id === 'hard') {
      const { createQueue } = await load('queue.mjs');
      const { validateConcurrency } = await load('validation.mjs');
      for (const [index, value] of [0, 9, 1.2, NaN, Infinity].entries())
        await check(`concurrency-range-${index}`, () => {
          assert.throws(() => validateConcurrency(value), RangeError);
          assert.throws(() => createQueue({ concurrency: value }), RangeError);
        });
      for (const [index, value] of ['2', null, undefined].entries())
        await check(`concurrency-type-${index}`, () =>
          assert.throws(() => validateConcurrency(value), TypeError),
        );
      await check('accepted-limits', async () => {
        for (const concurrency of [1, 2, 8]) {
          const q = createQueue({ concurrency });
          await q.idle();
          assert.equal(validateConcurrency(concurrency), concurrency);
        }
      });
      await check('invalid-submit', () => {
        const q = createQueue({ concurrency: 1 });
        for (const id of ['', ' ', null, 1]) assert.throws(() => q.submit(id, () => 0), TypeError);
        assert.throws(() => q.submit('a', null), TypeError);
      });
      await check('fifo-concurrency-and-idle', async () => {
        const q = createQueue({ concurrency: 2 }),
          gates = [deferred(), deferred(), deferred()],
          order = [];
        const promises = gates.map((gate, i) =>
          q.submit(String(i), async (signal) => {
            assert.equal(signal.aborted, false);
            order.push(i);
            return gate.promise;
          }),
        );
        let idle = false;
        const waiting = q.idle().then(() => {
          idle = true;
        });
        await flush();
        assert.deepEqual(order, [0, 1]);
        assert.equal(idle, false);
        assert.equal(q.stats().running, 2);
        assert.equal(q.stats().queued, 1);
        gates[0].resolve('zero');
        await flush();
        assert.deepEqual(order, [0, 1, 2]);
        assert.equal(idle, false);
        gates[1].resolve('one');
        gates[2].resolve('two');
        assert.deepEqual(await Promise.all(promises), ['zero', 'one', 'two']);
        await waiting;
        assert.deepEqual(q.stats(), {
          running: 0,
          queued: 0,
          completed: 3,
          cancelled: 0,
          failed: 0,
        });
      });
      await check('duplicate-active-and-completed', async () => {
        const q = createQueue({ concurrency: 1 }),
          gate = deferred();
        let calls = 0;
        const p = q.submit('x', () => {
          calls++;
          return gate.promise;
        });
        assert.equal(
          q.submit('x', () => {
            throw new Error('duplicate');
          }),
          p,
        );
        gate.resolve(23);
        assert.equal(await p, 23);
        assert.equal(
          q.submit('x', () => 0),
          p,
        );
        assert.equal(calls, 1);
        assert.equal(q.cancel('x'), false);
      });
      await check('cancel-pending', async () => {
        const q = createQueue({ concurrency: 1 }),
          gate = deferred();
        const active = q.submit('active', () => gate.promise);
        let invoked = false;
        const pending = q.submit('pending', () => {
          invoked = true;
        });
        const result = observe(pending);
        assert.equal(q.cancel('pending'), true);
        assert.equal(q.cancel('pending'), false);
        assert.equal(q.cancel('unknown'), false);
        assert.equal((await result).error?.name, 'AbortError');
        assert.equal(invoked, false);
        assert.equal(
          q.submit('pending', () => 0),
          pending,
        );
        gate.resolve(1);
        await active;
        await q.idle();
        assert.deepEqual(q.stats(), {
          running: 0,
          queued: 0,
          completed: 1,
          cancelled: 1,
          failed: 0,
        });
      });
      await check('cancel-active-retains-slot', async () => {
        const q = createQueue({ concurrency: 1 }),
          gate = deferred();
        let signal,
          second = false;
        const first = observe(
          q.submit('a', (s) => {
            signal = s;
            return gate.promise;
          }),
        );
        const next = q.submit('b', () => {
          second = true;
          return 9;
        });
        await flush();
        assert.equal(q.cancel('a'), true);
        await flush();
        assert.equal(signal.aborted, true);
        assert.equal(second, false);
        assert.equal(q.stats().running, 1);
        gate.resolve(2);
        assert.equal((await first).error?.name, 'AbortError');
        assert.equal(await next, 9);
        await q.idle();
        assert.deepEqual(q.stats(), {
          running: 0,
          queued: 0,
          completed: 1,
          cancelled: 1,
          failed: 0,
        });
      });
      await check('sync-throw-and-rejection-do-not-stall', async () => {
        const q = createQueue({ concurrency: 1 }),
          error = new Error('expected');
        const first = observe(
          q.submit('x', () => {
            throw error;
          }),
        );
        const second = observe(q.submit('y', () => Promise.reject(undefined)));
        const third = q.submit('z', () => 7);
        assert.equal((await first).error, error);
        assert.ok(Object.hasOwn(await second, 'error'));
        assert.equal(await third, 7);
        await q.idle();
        assert.equal(q.stats().failed, 2);
      });
      await check('stats-copy', async () => {
        const q = createQueue({ concurrency: 1 });
        const copy = q.stats();
        try {
          copy.completed = 99;
        } catch {}
        assert.equal(q.stats().completed, 0);
        await q.idle();
      });
    } else throw new Error('Unknown case');
  } catch {
    tests.push({ id: 'load-or-contract', passed: false });
  }
  return {
    caseId: id,
    tests,
    passed: tests.length > 0 && tests.every((test) => test.passed),
    failedChecks: tests.filter((test) => !test.passed).map((test) => test.id),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Bounded externally too; no hanging implementation can hold the comparison open.
  const timeout = setTimeout(() => {
    console.log(
      JSON.stringify({
        caseId: process.argv[2],
        passed: false,
        tests: [{ id: 'acceptance-timeout', passed: false }],
        failedChecks: ['acceptance-timeout'],
      }),
    );
    process.exit(2);
  }, 3000);
  const result = await verifyCase(process.argv[2], process.argv[3]);
  clearTimeout(timeout);
  console.log(JSON.stringify(result));
}
