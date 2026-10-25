import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { officeStateDirectory } from '../src/officeStateDirectory.js';

describe('preview state isolation', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('preserves the exact ordinary directory without preview mode', () => {
    vi.stubEnv('PIXEL_OFFICE_PREVIEW', '');
    expect(officeStateDirectory()).toBe(join(homedir(), '.pixel-agents'));
  });
  it('requires an absolute private directory and uses it for preview state', () => {
    vi.stubEnv('PIXEL_OFFICE_PREVIEW', '1');
    vi.stubEnv('PIXEL_OFFICE_STATE_DIR', 'relative');
    expect(() => officeStateDirectory()).toThrow('privada');
    vi.stubEnv('PIXEL_OFFICE_STATE_DIR', join(homedir(), 'fixture-preview-state'));
    expect(officeStateDirectory()).toBe(join(homedir(), 'fixture-preview-state'));
  });
});
