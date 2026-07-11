import {
  type ActionStep,
  artifactManifestFixture,
  checkpointFixture,
  diagnosisResultFixture,
  domainVersions,
  recordedStepFixture,
  redactionRuleFixture,
  requestResponseCaptureFixture,
  simulationRuleFixture,
  timelineEventFixture,
} from '@browser-blackbox/domain';
import { createDefaultProjectSettings } from '@browser-blackbox/shared';
import type { StoredRunSnapshot } from './contracts';

export const storedRunSnapshotFixture: StoredRunSnapshot = {
  projection: {
    projectionId: 'projection-working-001',
    kind: 'working-copy',
    createdAt: '2026-06-24T15:00:00.000Z',
    updatedAt: '2026-06-24T15:00:10.000Z',
  },
  session: {
    sessionId: 'session-001',
    runId: artifactManifestFixture.runId,
    targetUrl: artifactManifestFixture.targetUrl,
    appVersion: artifactManifestFixture.appVersion,
    browserTarget: artifactManifestFixture.replayEngine.browserTarget,
    createdAt: '2026-06-24T15:00:00.000Z',
    updatedAt: '2026-06-24T15:00:10.000Z',
  },
  flow: {
    flowId: 'flow-001',
    schemaVersion: domainVersions.domainSchemaVersion,
    createdAt: '2026-06-24T15:00:10.000Z',
  },
  manifest: artifactManifestFixture,
  projectSettings: createDefaultProjectSettings(),
  steps: [
    {
      ...recordedStepFixture,
      id: 'step-fill-username',
      title: 'Fill username',
      kind: 'action',
      dependencyStepIds: [],
      action: {
        type: 'fill',
        selector: 'page.getByLabel("Email")',
        value: 'qa@example.test',
        sensitive: false,
      },
    } satisfies ActionStep,
    {
      ...recordedStepFixture,
      id: 'step-fill-password',
      title: 'Fill password',
      kind: 'action',
      dependencyStepIds: [],
      action: {
        type: 'fill',
        selector: 'page.getByLabel("Password")',
        value: '[REDACTED]',
        sensitive: true,
      },
    } satisfies ActionStep,
    recordedStepFixture,
  ],
  captures: [requestResponseCaptureFixture],
  redactionRules: [redactionRuleFixture],
  simulationRules: [simulationRuleFixture],
  timeline: [
    {
      ...timelineEventFixture,
      id: 'timeline-user-action-login',
      kind: 'user-action',
      summary: 'User clicked Sign in',
      stepId: 'step-login-submit',
    },
    timelineEventFixture,
  ],
  checkpoints: [checkpointFixture],
  diagnosis: diagnosisResultFixture,
};

export const storedArtifactContentsFixture: Record<string, string> = {
  'generated/test.spec.ts': `import { test, expect } from '@playwright/test';\n\ntest('login flow', async ({ page }) => {\n  await page.goto('https://example.test/login');\n  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();\n});\n`,
  'logs/timeline.json': JSON.stringify(
    {
      events: storedRunSnapshotFixture.timeline,
    },
    null,
    2,
  ),
  'network/api-capture.json': JSON.stringify(
    {
      captures: storedRunSnapshotFixture.captures,
    },
    null,
    2,
  ),
};
