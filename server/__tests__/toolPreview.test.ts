import { describe, expect, it } from 'vitest';

import { previewUrl, requestBodyPreview, toolPreview } from '../src/tools/toolPreview.js';
describe('safe previews with complete public data', () => {
  it('redacts login data, URL tokens and nested credentials', () => {
    expect(
      requestBodyPreview('password=PRIVATE_PASSWORD&csrf=PRIVATE_CSRF&message=public', false),
    ).toEqual({
      password: '[dato privado oculto]',
      csrf: '[dato privado oculto]',
      message: 'public',
    });
    expect(requestBodyPreview('opaque credentials', true)).toContain('ocultos');
    expect(
      previewUrl('https://example.invalid/login?token=PRIVATE&destination=public'),
    ).not.toContain('PRIVATE');
    expect(toolPreview({ selector: '#password', value: 'PRIVATE_PASSWORD' })).toEqual({
      selector: '#password',
      value: '[dato privado oculto]',
    });
  });
  it('refuses an incomplete large preview rather than authorizing truncated content', () => {
    expect(() => toolPreview('x'.repeat(64001))).toThrow('revisarla completa');
  });
});
