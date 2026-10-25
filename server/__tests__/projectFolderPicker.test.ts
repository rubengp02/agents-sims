import { afterEach, describe, expect, it, vi } from 'vitest';
const { execute, exists } = vi.hoisted(() => ({ execute: vi.fn(), exists: vi.fn(() => true) }));
vi.mock('node:child_process', () => ({ execFile: execute }));
vi.mock('node:fs', () => ({ existsSync: exists }));
import { pickProjectFolder } from '../src/execution/projectFolderPicker.js';

afterEach(() => {
  vi.restoreAllMocks();
  execute.mockReset();
  exists.mockReset().mockReturnValue(true);
});
describe('native Windows project folder picker', () => {
  it('launches the precompiled graphical helper directly and preserves Unicode', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const selected = 'C:\\Proyectos\\Diseño y pruebas';
    execute.mockImplementation((_file, args, options, callback) => {
      expect(_file).toMatch(/office-folder-picker\.exe$/);
      expect(_file).not.toMatch(/powershell/i);
      expect(args).toEqual([]);
      expect(options.windowsHide).toBe(false);
      expect(options.shell).toBeUndefined();
      callback(null, Buffer.from(selected).toString('base64'), '');
    });
    expect(await pickProjectFolder()).toBe(selected);
  });
  it('shares one window across concurrent clicks and allows a new selection after Cancel', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    let finish!: () => void;
    execute.mockImplementation((_file, _args, _options, callback) => {
      finish = () => callback(null, '', '');
    });
    const first = pickProjectFolder(),
      second = pickProjectFolder();
    expect(first).toBe(second);
    expect(execute).toHaveBeenCalledTimes(1);
    finish();
    expect(await first).toBeNull();
    const next = pickProjectFolder();
    expect(execute).toHaveBeenCalledTimes(2);
    finish();
    await next;
  });
  it('reports failure clearly and releases the window guard', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    execute.mockImplementationOnce((_file, _args, _options, callback) =>
      callback(new Error('timeout')),
    );
    await expect(pickProjectFolder()).rejects.toMatchObject({ code: 'folder_picker_failed' });
    execute.mockImplementationOnce((_file, _args, _options, callback) => callback(null, '', ''));
    expect(await pickProjectFolder()).toBeNull();
  });
  it('rejects invalid native output', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    execute.mockImplementationOnce((_file, _args, _options, callback) =>
      callback(null, Buffer.from('relative-path').toString('base64'), ''),
    );
    await expect(pickProjectFolder()).rejects.toMatchObject({ code: 'folder_picker_invalid' });
  });
  it('reports a missing helper without attempting PowerShell or runtime compilation', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    exists.mockReturnValue(false);
    await expect(pickProjectFolder()).rejects.toMatchObject({ code: 'folder_picker_unavailable' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('keeps manual entry available on other platforms', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    await expect(pickProjectFolder()).rejects.toMatchObject({ code: 'folder_picker_unavailable' });
    expect(execute).not.toHaveBeenCalled();
  });
});
