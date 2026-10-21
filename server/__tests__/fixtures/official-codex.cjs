// Deterministic local process fixture. No network, CLI installation or inference.
const mode = process.argv[2] || 'success';
process.stdin.resume();
process.stdin.on('end', () => {
  const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
  emit({ type: 'thread.started', thread_id: 'fixture-session' });
  process.stderr.write('private diagnostic must never be persisted\n');
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }
  if (mode === 'bad') { process.stdout.write('broken json\n'); setInterval(() => {}, 1000); return; }
  if (mode === 'limit') { emit({ type: 'turn.failed', error: { message: 'usage limit reached; private detail' } }); process.exitCode = 1; return; }
  if (mode === 'failed') { emit({ type: 'turn.failed', error: { message: 'private failure detail' } }); process.exitCode = 1; return; }
  emit({ type: 'item.completed', item: { type: 'command_execution', command: 'private tool content' } });
  emit({ type: 'item.completed', item: { type: 'agent_message', text: 'fixture answer' } });
  emit({ type: 'turn.completed', usage: { input_tokens: 20, output_tokens: 4, ...(mode === 'cache' ? { cached_input_tokens: 12 } : mode === 'bad-cache' ? { cached_input_tokens: 21 } : {}) } });
});
