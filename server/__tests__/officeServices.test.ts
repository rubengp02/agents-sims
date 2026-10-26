import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TeamTask } from '../../core/src/team.js';
import { LocalChecks } from '../src/execution/localChecks.js';
import {
  captureDirectoryRevision,
  projectRevisionCapture,
} from '../src/execution/projectRevision.js';
import { OfficeServices } from '../src/tools/officeServices.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
async function fixture(nestedHost = false) {
  const root = mkdtempSync(join(tmpdir(), 'office-services-'));
  roots.push(root);
  const project = join(root, 'source');
  await mkdir(project);
  writeFileSync(join(project, 'style.css'), 'body { color: red; }');
  const host = nestedHost ? join(project, 'app') : project;
  if (nestedHost) await mkdir(host);
  const services = new OfficeServices(join(root, 'private'), host);
  await services.initialize();
  const task = {
    id: 'fixture-task',
    project,
    role: 'developer',
    allowWrites: true,
    conversationId: 'fixture-conversation',
  } as TeamTask;
  return { root, project, services, task };
}
describe('office services across storage, isolated review and restart (no model)', () => {
  it('reviews every managed-copy file even when the containing repository ignores private storage', async () => {
    const { root, project, services, task } = await fixture();
    execFileSync('git', ['init', root], { windowsHide: true, stdio: 'ignore' });
    writeFileSync(join(root, '.gitignore'), 'private/\n');
    await services.prepareSelf(task);
    const copy = task.executionProject!;
    writeFileSync(join(copy, 'new.cjs'), 'module.exports = 1;');
    const reviewed = captureDirectoryRevision(copy);
    expect(Object.keys(reviewed.files)).toEqual(['new.cjs', 'style.css']);
    expect(Object.keys((await services.selfReviewBase(task))!.files)).toEqual(['style.css']);
    // Git in the containing repo intentionally sees none of these private files.
    expect(Object.keys(projectRevisionCapture(copy)().files)).toEqual([]);
    writeFileSync(join(copy, 'style.css'), 'changed after review');
    await expect(services.integrateSelf(task, reviewed.digest)).rejects.toMatchObject({
      code: 'self_review_outdated',
    });
    writeFileSync(join(copy, 'style.css'), 'body { color: red; }');
    await services.integrateSelf(task, reviewed.digest);
    expect(readFileSync(join(project, 'new.cjs'), 'utf8')).toBe('module.exports = 1;');
    await services.close();
  });
  it('binds project reads and registered checks to the isolated project for the Tester', async () => {
    const { root, project, services, task } = await fixture(true);
    task.role = 'tester';
    task.allowWrites = false;
    const checks = new LocalChecks(
      {
        fixture: {
          executable: process.execPath,
          args: [
            '-e',
            "if(require('node:fs').readFileSync('style.css','utf8')!=='isolated')process.exit(1)",
          ],
          timeoutMs: 10000,
        },
      },
      join(root, 'logs'),
      project,
    );
    await services.prepareSelf(task);
    writeFileSync(join(task.executionProject!, 'style.css'), 'isolated');
    await checks.authorizeSelfWorkspace(task.selfWorkspaceReceipt!);
    // Employee tasks share the root's authorized copy, without owning its receipt.
    delete task.selfWorkspaceReceipt;
    const createSession = vi.spyOn(services.runtime, 'createSession');
    const tools = await services.execution(task, new AbortController().signal, checks);
    expect(tools.hasStartedWork()).toBe(false);
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        project: join(task.executionProject!, 'app'),
        projectRoot: task.executionProject,
      }),
    );
    const client = new Client({ name: 'tester-fixture', version: '1' });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(tools.toolServer.url), {
          requestInit: { headers: { authorization: `Bearer ${tools.toolServer.token}` } },
        }),
      );
      const read = await client.callTool({
        name: 'project_read',
        arguments: { args: { path: 'style.css' } },
      });
      expect(JSON.stringify(read)).toContain('isolated');
      expect(tools.hasStartedWork()).toBe(true);
      const checked = await client.callTool({
        name: 'project_check_run',
        arguments: { args: { id: 'fixture' } },
      });
      expect(JSON.stringify(checked)).toContain('\\"passed\\":true');
      expect(task.localChecks).toEqual([
        expect.objectContaining({ id: 'fixture', passed: true, exitCode: 0 }),
      ]);
      expect(readFileSync(join(project, 'style.css'), 'utf8')).toContain('red');
    } finally {
      await client.close();
      await services.close();
    }
  });
  it('closes the owned MCP listener when the whole service is stopped', async () => {
    const { services, task } = await fixture();
    const tools = await services.execution(task, new AbortController().signal);
    const response = await fetch(tools.toolServer.url);
    expect(response.status).toBe(403);
    await services.close();
    await expect(fetch(tools.toolServer.url)).rejects.toThrow();
  });
  it('integrates only the reviewed copy and leaves the running source untouched until then', async () => {
    const { project, services, task } = await fixture();
    await services.prepareSelf(task);
    expect(await services.hasSelfChanges(task)).toBe(false);
    await expect(
      services.integrateSelf(task, undefined as unknown as string),
    ).resolves.toBeUndefined();
    const capture = projectRevisionCapture(task.executionProject!);
    writeFileSync(join(task.executionProject!, 'style.css'), 'body { color: blue; }');
    expect(readFileSync(join(project, 'style.css'), 'utf8')).toContain('red');
    expect(await services.hasSelfChanges(task)).toBe(true);
    const reviewed = capture();
    writeFileSync(join(task.executionProject!, 'unreviewed.ts'), 'later');
    await expect(services.integrateSelf(task, reviewed.digest)).rejects.toMatchObject({
      code: 'self_review_outdated',
    });
    rmSync(join(task.executionProject!, 'unreviewed.ts'));
    await services.integrateSelf(task, reviewed.digest);
    expect(readFileSync(join(project, 'style.css'), 'utf8')).toContain('blue');
    await services.close();
  });
  it('retains generated bytes and the latest capability verification after restart', async () => {
    const { root, project, services, task } = await fixture();
    const outputs = join(services.directory, 'outputs', task.id);
    await mkdir(outputs, { recursive: true });
    const image = join(outputs, 'native.png');
    await sharp({ create: { width: 8, height: 8, channels: 3, background: 'blue' } })
      .png()
      .toFile(image);
    await services.generated(task, image);
    const id = task.artifacts![0].id;
    await services.close();
    const restored = new OfficeServices(join(root, 'private'), project);
    await restored.initialize();
    expect((await restored.artifacts.read(id)).bytes).toEqual(readFileSync(image));
    expect(restored.capabilities().find((c) => c.id === 'image-generation')).toMatchObject({
      state: 'available',
      lastCheckedAt: expect.any(String),
    });
    expect(existsSync(join(project, 'native.png'))).toBe(false);
    await restored.close();
  });
});
