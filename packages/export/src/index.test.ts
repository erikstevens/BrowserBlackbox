import {
  domainVersions,
  requestResponseCaptureFixture,
  type RecordedStep,
  type RequestResponseCapture,
} from '@browser-blackbox/domain';
import { describe, expect, it } from 'vitest';
import {
  generateApiCollection,
  generateApiRequestFixture,
  generatePlaywrightApiTest,
  generatePlaywrightUiTest,
} from './index';

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

describe('generatePlaywrightApiTest', () => {
  it('exports a Playwright API test with base url extraction and body assertions', () => {
    const captures: RequestResponseCapture[] = [requestResponseCaptureFixture];
    const steps: RecordedStep[] = [
      {
        schemaVersion: domainVersions.domainSchemaVersion,
        id: 'step-login-submit',
        title: 'Submit login',
        kind: 'action',
        status: 'active',
        evidenceState: 'current',
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
        dependencyStepIds: [],
        invalidatesEvidenceAfter: true,
        action: {
          type: 'click',
          selector: 'page.getByRole("button", { name: "Sign in" })',
        },
      },
    ];

    const result = generatePlaywrightApiTest({
      flowTitle: 'Login flow',
      steps,
      captures,
    });

    expect(result.fileName).toBe('generated/api.spec.ts');
    expect(result.testName).toBe('Login flow API');
    expect(result.warnings).toEqual([]);
    expect(result.code).toContain(
      `const baseURL = process.env.BASE_URL ?? "https://example.test";`,
    );
    expect(result.code).toContain(`test.step("Submit login", async () => {`);
    expect(result.code).toContain(
      `const response1 = await request.post(\`\${baseURL}/api/login\`, {`,
    );
    expect(result.code).toContain(`expect(response1.status()).toBe(200);`);
    expect(result.code).toContain(`expect(request_auth_loginJson).toMatchObject({`);
  });

  it('omits websocket captures and warns when bodies cannot be inlined', () => {
    const captures: RequestResponseCapture[] = [
      {
        ...requestResponseCaptureFixture,
        id: 'request-download',
        request: {
          ...requestResponseCaptureFixture.request,
          url: 'https://example.test/api/download',
          method: 'GET',
          body: {
            state: 'unavailable',
            reason: 'Body not captured for GET request',
          },
        },
        response: {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
          },
          body: {
            state: 'truncated',
            contentType: 'application/octet-stream',
            reason: 'Binary payload omitted',
          },
        },
      },
      {
        ...requestResponseCaptureFixture,
        id: 'ws-1',
        protocol: 'websocket',
      },
    ];

    const result = generatePlaywrightApiTest({ captures });

    expect(result.code).toContain(`await request.get(\`\${baseURL}/api/download\`, {`);
    expect(result.warnings).toEqual([
      {
        kind: 'request-body-not-inlineable',
        captureId: 'request-download',
        url: 'https://example.test/api/download',
        detail: 'Request body is unavailable and cannot be emitted inline: Body not captured for GET request',
      },
      {
        kind: 'response-body-not-asserted',
        captureId: 'request-download',
        url: 'https://example.test/api/download',
        detail: 'Response body is truncated and was not converted into a body assertion: Binary payload omitted',
      },
      {
        kind: 'non-http-capture-omitted',
        captureId: 'ws-1',
        detail: 'Capture protocol websocket is not exported in the API request artifacts.',
      },
    ]);
  });
});

describe('generateApiRequestFixture', () => {
  it('exports grouped request fixtures with environment metadata', () => {
    const result = generateApiRequestFixture({
      flowTitle: 'Login flow',
      steps: [
        {
          schemaVersion: domainVersions.domainSchemaVersion,
          id: 'step-login-submit',
          title: 'Submit login',
          kind: 'action',
          status: 'active',
          evidenceState: 'current',
          createdAt: '2026-06-30T00:00:00.000Z',
          updatedAt: '2026-06-30T00:00:00.000Z',
          dependencyStepIds: [],
          invalidatesEvidenceAfter: true,
          action: {
            type: 'click',
            selector: 'page.getByRole("button", { name: "Sign in" })',
          },
        },
      ],
      captures: [requestResponseCaptureFixture],
    });

    expect(result.fileName).toBe('fixtures/api-requests.json');
    expect(result.warnings).toEqual([]);
    const parsed = JSON.parse(result.code) as {
      environmentVariables: Array<{ name: string; defaultValue: string }>;
      groups: Array<{ title: string; requests: Array<{ urlTemplate: string; response?: { status: number } }> }>;
      secretPlaceholders: Array<{ token: string }>;
    };
    expect(parsed.environmentVariables).toEqual([
      {
        name: 'BASE_URL',
        defaultValue: 'https://example.test',
        required: false,
      },
    ]);
    expect(parsed.secretPlaceholders).toEqual([
      {
        token: '[REDACTED]',
        meaning: 'Value was redacted before export and should be replaced with a safe secret source.',
      },
    ]);
    expect(parsed.groups[0]?.title).toBe('Submit login');
    expect(parsed.groups[0]?.requests[0]?.urlTemplate).toBe('/api/login');
    expect(parsed.groups[0]?.requests[0]?.response?.status).toBe(200);
  });
});

describe('generateApiCollection', () => {
  it('exports a Postman-compatible grouped collection with example responses', () => {
    const result = generateApiCollection({
      flowTitle: 'Login flow',
      steps: [
        {
          schemaVersion: domainVersions.domainSchemaVersion,
          id: 'step-login-submit',
          title: 'Submit login',
          kind: 'action',
          status: 'active',
          evidenceState: 'current',
          createdAt: '2026-06-30T00:00:00.000Z',
          updatedAt: '2026-06-30T00:00:00.000Z',
          dependencyStepIds: [],
          invalidatesEvidenceAfter: true,
          action: {
            type: 'click',
            selector: 'page.getByRole("button", { name: "Sign in" })',
          },
        },
      ],
      captures: [requestResponseCaptureFixture],
    });

    expect(result.fileName).toBe('collections/postman.collection.json');
    expect(result.warnings).toEqual([]);
    const parsed = JSON.parse(result.code) as {
      info: { schema: string; name: string };
      variable: Array<{ key: string; value: string }>;
      item: Array<{
        name: string;
        item: Array<{
          name: string;
          request: { url: string; body?: { options: { raw: { language: string } } } };
          response: Array<{ code: number; body: string; _postman_previewlanguage?: string }>;
        }>;
      }>;
    };
    expect(parsed.info.schema).toBe(
      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    );
    expect(parsed.info.name).toBe('Login flow API Collection');
    expect(parsed.variable).toEqual([
      {
        key: 'baseUrl',
        value: 'https://example.test',
        type: 'string',
      },
    ]);
    expect(parsed.item[0]?.name).toBe('Submit login');
    expect(parsed.item[0]?.item[0]?.name).toBe('POST /api/login');
    expect(parsed.item[0]?.item[0]?.request.url).toBe('{{baseUrl}}/api/login');
    expect(parsed.item[0]?.item[0]?.request.body?.options.raw.language).toBe('json');
    expect(parsed.item[0]?.item[0]?.response[0]?.code).toBe(200);
    expect(parsed.item[0]?.item[0]?.response[0]?.body).toContain('"token":"opaque"');
    expect(parsed.item[0]?.item[0]?.response[0]?._postman_previewlanguage).toBe('json');
  });
});
