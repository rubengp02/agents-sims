/** Public CI diagnostics contain failure identities, never captured tool output. */
export function validationDiagnostics(log) {
  return log
    .split(/\r?\n/)
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, '').trim())
    .map((line) => {
      const failure = /^FAIL\s+((?:__tests__|src|test)\/[\w./-]+\.test\.[jt]sx?)(?:\s|$)/.exec(
        line,
      );
      return failure ? `FAIL ${failure[1]}` : line;
    })
    .filter(
      (line) =>
        /^not ok \d+ - [a-zA-Z0-9 ,.:()/_-]+$/.test(line) ||
        /^FAIL (?:__tests__|src|test)\/[\w./-]+\.test\.[jt]sx?$/.test(line) ||
        /^(?:expected|actual): (?:true|false|null|\d+)$/.test(line) ||
        /^code: '[A-Z_]+'$/.test(line),
    )
    .slice(0, 40);
}
