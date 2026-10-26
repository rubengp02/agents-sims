import type { TeamProvider } from '../../../core/src/team.js';
import { assessTask } from './taskAssessment.js';
import { chooseModel } from './teamPolicy.js';
import type { SubscriptionEvidence } from './types.js';

/** Provider routing is a pure policy; coordination owns diagnosis and dispatch. */
export function chooseProviderModel(
  task: Parameters<typeof chooseModel>[0],
  evidence: SubscriptionEvidence,
  provider: TeamProvider,
  objective: string,
): ReturnType<typeof chooseModel> {
  const automaticNative = provider === 'antigravity' && !task.override;
  const result = chooseModel(
    {
      ...task,
      override:
        task.override ??
        (automaticNative
          ? {
              provider,
              model:
                (
                  evidence.models.find(
                    (model) =>
                      model.id.startsWith('gemini-') &&
                      model.id.endsWith(
                        task.role === 'tester' ||
                          assessTask(objective, task.assessment).difficulty === 'complex'
                          ? '-high'
                          : '-low',
                      ),
                  ) ?? evidence.models[0]
                )?.id ?? '',
              effort: 'default',
            }
          : null),
    },
    evidence,
  );
  if (automaticNative)
    result.explanation =
      'Asignación automática provisional sobre el catálogo nativo verificado; eficiencia aún no medida.';
  return result;
}
