import type { TeamRole } from '../../../core/src/team.js';
import { object } from './subscriptionPolicy.js';
import { ExecutionBlocked } from './types.js';

export interface WorkflowTask {
  role: Exclude<TeamRole, 'chief'>;
  title: string;
  prompt: string;
  dependsOn: number[];
  parallelSafe: boolean;
}

/** Validate all tasks before creation, inject phase barriers, then topologically order. */
export function normalizeWorkflowPlan(raw: unknown): WorkflowTask[] {
  const invalid = () =>
    new ExecutionBlocked(
      'invalid_plan',
      'El plan contiene tareas o dependencias incompatibles. No se ha creado ni ejecutado ningún paso.',
    );
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) throw invalid();
  const tasks: WorkflowTask[] = raw.map((value, index) => {
    const item = object(value);
    if (
      !['designer', 'architect', 'developer', 'tester'].includes(String(item.role)) ||
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      item.title.length > 160 ||
      typeof item.prompt !== 'string' ||
      !item.prompt.trim() ||
      item.prompt.length > 20_000 ||
      !Array.isArray(item.dependsOn) ||
      item.dependsOn.some(
        (dep) => !Number.isInteger(dep) || dep < 0 || dep >= raw.length || dep === index,
      ) ||
      (item.parallelSafe !== undefined && typeof item.parallelSafe !== 'boolean')
    )
      throw invalid();
    return {
      role: item.role as WorkflowTask['role'],
      title: item.title,
      prompt: item.prompt,
      dependsOn: [...new Set(item.dependsOn as number[])],
      parallelSafe: item.parallelSafe === true,
    };
  });
  for (const task of tasks) {
    const prerequisites = tasks.flatMap((other, index) =>
      (task.role === 'developer' && ['architect', 'designer'].includes(other.role)) ||
      (task.role === 'tester' && ['architect', 'designer', 'developer'].includes(other.role))
        ? [index]
        : [],
    );
    task.dependsOn = [...new Set([...task.dependsOn, ...prerequisites])];
  }
  const order: number[] = [];
  const remaining = new Set(tasks.map((_, index) => index));
  while (remaining.size) {
    const next = [...remaining].find((index) =>
      tasks[index].dependsOn.every((dep) => order.includes(dep)),
    );
    if (next === undefined) throw invalid(); // cycle, including a conflict with mandatory phase order
    order.push(next);
    remaining.delete(next);
  }
  return order.map((index) => ({
    ...tasks[index],
    dependsOn: tasks[index].dependsOn.map((dep) => order.indexOf(dep)),
  }));
}
