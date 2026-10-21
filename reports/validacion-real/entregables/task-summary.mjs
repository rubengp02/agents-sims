export function countByStatus(tasks) {
  if (!Array.isArray(tasks)) {
    throw new TypeError('tasks must be an array');
  }

  const counts = { pending: 0, running: 0, done: 0 };
  for (const task of tasks) {
    if (task === null || typeof task !== 'object') {
      throw new TypeError('Each task must be an object');
    }
    const status = task.status;
    if (status !== 'pending' && status !== 'running' && status !== 'done') {
      throw new TypeError('Each task must have a valid status');
    }
    counts[status] += 1;
  }
  return counts;
}
