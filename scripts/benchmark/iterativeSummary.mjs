/** Completion of a measurement and acceptance of a solution are separate facts. */
export function iterativeSummary(trials, plan) {
  const controlsPassed =
    trials.length === 2 &&
    trials[0].method === 'direct' &&
    trials[1].method === 'office' &&
    typeof trials[0].initialFilesHash === 'string' &&
    trials[0].initialFilesHash === trials[1].initialFilesHash &&
    trials.every(
      (t) =>
        t.usageKnown === true &&
        t.runs.length > 0 &&
        t.runs.length <= plan.maxTurnsPerMethod &&
        t.runs.every(
          (r) =>
            r.status === 'completed' &&
            r.model === plan.model &&
            r.effort === plan.effort &&
            [r.inputTokens, r.outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0),
        ) &&
        t.tokens === t.runs.reduce((n, r) => n + r.inputTokens + r.outputTokens, 0),
    );
  const complete = controlsPassed && trials.every((t) => t.taskStatus === 'completed');
  return {
    controlsPassed,
    status: complete ? 'completed' : 'incomplete',
    generalImprovementProven: false,
    comparison: complete
      ? {
          directAccepted: trials[0].status === 'accepted',
          officeAccepted: trials[1].status === 'accepted',
          tokenRatioOfficeToDirect:
            trials[0].tokens > 0 ? trials[1].tokens / trials[0].tokens : null,
          elapsedRatioOfficeToDirect:
            trials[0].totalMs > 0 ? trials[1].totalMs / trials[0].totalMs : null,
        }
      : null,
  };
}
