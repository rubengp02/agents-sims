import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { TeamTask } from '../../core/src/team.js';
import { LiveOfficeActivity } from '../src/components/LiveOfficeActivity.js';
const tasks = [
  {
    role: 'developer',
    status: 'running',
    liveActivity: [
      {
        id: 'cmd',
        title: 'Ejecutando un comando',
        detail: 'npm test <script>unsafe</script>',
        at: 1,
        completed: false,
      },
    ],
  },
] as TeamTask[];
describe('live activity', () => {
  it('names tools in stored events without changing their original details', () => {
    const detail = JSON.stringify({ tool: 'project_list', arguments: { path: 'server' } });
    const task = {
      ...tasks[0],
      liveActivity: [
        { id: 'tool', title: 'Usando una herramienta', detail, at: 1, completed: false },
      ],
    } as TeamTask;
    const html = renderToStaticMarkup(
      createElement(LiveOfficeActivity, { tasks: [task], working: true, waiting: false }),
    );
    expect(html).toContain('Usando una herramienta: project_list');
    expect(task.liveActivity![0].title).toBe('Usando una herramienta');
  });
  it('shows the observed next operation under a thinking phase without inventing thoughts', () => {
    const task = {
      ...tasks[0],
      liveActivity: [
        { id: 'think', title: 'Pensando', at: 0, completed: true },
        {
          id: 'search',
          title: 'Buscando información',
          detail: 'Documentación oficial de Vercel',
          at: 1,
          completed: true,
        },
      ],
    } as TeamTask;
    const html = renderToStaticMarkup(
      createElement(LiveOfficeActivity, { tasks: [task], working: false, waiting: false }),
    );
    expect(html).toContain('Actividad observada después');
    expect(html).toContain('Documentación oficial de Vercel');
    expect(html).not.toContain('no ha comunicado más detalles');
  });
  it('shows actual command details escaped, processing indicator and the next known step', () => {
    const html = renderToStaticMarkup(
      createElement(LiveOfficeActivity, { tasks, working: true, waiting: false }),
    );
    expect(html).toContain('chat-live-shimmer');
    expect(html).toContain('npm test &lt;script&gt;');
    expect(html).toContain('recibir el resultado');
  });
  it('stops the animation when paused and never presents old events as current work', () => {
    const html = renderToStaticMarkup(
      createElement(LiveOfficeActivity, {
        tasks: tasks.map((t) => ({ ...t, status: 'paused' as const })),
        working: false,
        waiting: false,
      }),
    );
    expect(html).not.toContain('class="chat-live-shimmer"');
    expect(html).toContain('Actividad finalizada');
  });
});
