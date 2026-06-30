import { describe, expect, it } from 'vitest';
import { domainVersions, type RecordedStep } from '@browser-blackbox/domain';
import { generatePlaywrightUiTest } from './index';

describe('generatePlaywrightUiTest', () => {
  it('exports a standard playwright spec from supported active steps', () => {
    const steps: RecordedStep[] = [
      {
        schemaVersion: domainVersions.domainSchemaVersion,
        id: 'step-1',
        title: 'Open login page',
        kind: 'action',
        status: 'active',
        evidenceState: 'current',
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
        dependencyStepIds: [],
        invalidatesEvidenceAfter: true,
        action: {
          type: 'navigate',
          url: 'https://example.test/login',
        },
      },
      {
        schemaVersion: domainVersions.domainSchemaVersion,
        id: 'step-2',
        title: 'Fill email',
        kind: 'action',
        status: 'active',
        evidenceState: 'current',
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
        dependencyStepIds: ['step-1'],
        invalidatesEvidenceAfter: true,
        action: {
          type: 'fill',
          selector: 'page.getByLabel("Email")',
          value: 'qa@example.test',
          sensitive: false,
        },
      },
      {
        schemaVersion: domainVersions.domainSchemaVersion,
        id: 'step-3',
        title: 'Assert dashboard',
        kind: 'assertion',
        status: 'active',
        evidenceState: 'current',
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
        dependencyStepIds: ['step-2'],
        invalidatesEvidenceAfter: true,
        assertion: {
          schemaVersion: domainVersions.domainSchemaVersion,
          kind: 'element-visible',
          selector: 'page.getByRole("heading", { name: "Dashboard" })',
        },
      },
    ];

    const result = generatePlaywrightUiTest({
      flowTitle: 'Login flow',
      steps,
    });

    expect(result.fileName).toBe('generated/test.spec.ts');
    expect(result.testName).toBe('Login flow');
    expect(result.warnings).toEqual([]);
    expect(result.code).toContain(`import { test, expect } from '@playwright/test';`);
    expect(result.code).toContain(`test("Login flow", async ({ page }) => {`);
    expect(result.code).toContain(`await page.goto("https://example.test/login");`);
    expect(result.code).toContain(`await page.getByLabel("Email").fill("qa@example.test");`);
    expect(result.code).toContain(
      `await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();`,
    );
  });

  it('omits disabled and unsupported steps while reporting warnings', () => {
    const steps: RecordedStep[] = [
      {
        schemaVersion: domainVersions.domainSchemaVersion,
        id: 'step-disabled',
        title: 'Disabled click',
        kind: 'action',
        status: 'disabled',
        evidenceState: 'stale',
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
        dependencyStepIds: [],
        invalidatesEvidenceAfter: true,
        action: {
          type: 'click',
          selector: 'page.getByRole("button", { name: "Disabled" })',
        },
      },
      {
        schemaVersion: domainVersions.domainSchemaVersion,
        id: 'step-unsupported',
        title: 'Wait for request',
        kind: 'assertion',
        status: 'active',
        evidenceState: 'current',
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
        dependencyStepIds: [],
        invalidatesEvidenceAfter: true,
        assertion: {
          schemaVersion: domainVersions.domainSchemaVersion,
          kind: 'request-occurred',
          requestMatcher: '**/api/login',
        },
      },
    ];

    const result = generatePlaywrightUiTest({ steps });

    expect(result.warnings).toEqual([
      {
        kind: 'disabled-step-omitted',
        stepId: 'step-disabled',
        title: 'Disabled click',
      },
      {
        kind: 'unsupported-step-omitted',
        stepId: 'step-unsupported',
        title: 'Wait for request',
        detail: 'Assertion kind request-occurred is not exported in Phase 8 slice 1.',
      },
    ]);
    expect(result.code).toContain('No active supported steps were available for export.');
  });
});
