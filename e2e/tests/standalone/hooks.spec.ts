import path from 'node:path';

import { expect, test } from '../../fixtures/standalone';
import { sendHookEvent, sessionEndExit, sessionStartStartup } from '../../helpers/hooks';
import { expectOverlayCount } from '../../helpers/office';
import { setSettings } from '../../helpers/webview';

test.describe('Standalone / hooks', () => {
  test('observes hook-driven lifecycle without promoting external sessions to employees @area:standalone', async ({
    page,
    standalone,
  }) => {
    await setSettings(page, { alwaysShowLabels: true, watchAllSessions: true });
    await standalone.drainMessages();
    const sessionId = 'standalone-hooks-test-session';
    const event = (hook_event_name: string, extra = {}) =>
      sendHookEvent(standalone.hookServerConfig, {
        session_id: sessionId,
        hook_event_name,
        ...extra,
      });
    const presence = async () =>
      (await (await page.request.get(`${standalone.hostUrl}/api/office/presence`)).json()).sessions;

    await sendHookEvent(
      standalone.hookServerConfig,
      sessionStartStartup(sessionId, standalone.workspaceDir),
    );
    expect(await presence()).toHaveLength(0);
    await event('PreToolUse', {
      tool_name: 'Read',
      tool_input: { file_path: path.join(standalone.workspaceDir, 'demo.ts') },
    });
    await expect.poll(async () => (await presence())[0]?.status).toBe('Trabajando');
    await page.getByRole('button', { name: 'Otras sesiones de Codex', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Otras sesiones de Codex', exact: true });
    await expect(panel.getByText('Trabajando', { exact: true })).toBeVisible();
    await expect(panel.getByText(/Sesión de claude/)).toBeVisible();
    await expectOverlayCount(page, 0);
    const messages = await standalone.drainMessages();
    expect(
      messages.some((message) => ['agentCreated', 'agentToolStart'].includes(message.type)),
    ).toBe(false);

    await event('PermissionRequest');
    await event('PostToolUse');
    await event('Notification', { notification_type: 'idle_prompt' });
    await expect.poll(async () => (await presence())[0]?.status).toBe('Disponible');
    await expect(panel.getByText('Disponible', { exact: true })).toBeVisible();

    await sendHookEvent(standalone.hookServerConfig, sessionEndExit(sessionId));
    await expect.poll(async () => (await presence()).length).toBe(0);
    await expect(panel.getByText('No hay otras sesiones detectadas.')).toBeVisible();
    await expectOverlayCount(page, 0);
  });
});
