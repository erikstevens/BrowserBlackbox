import { describe, expect, it } from 'vitest';
import { productSummary } from './index';

describe('productSummary', () => {
  it('keeps Playwright export central to the product promise', () => {
    expect(productSummary).toContain('Playwright');
  });
});
