import type {
  Assertion,
  CaptureBody,
  RecordedStep,
  RequestResponseCapture,
  SimulationRule,
} from '@browser-blackbox/domain';

export type PlaywrightUiExportWarning =
  | {
      kind: 'disabled-step-omitted';
      stepId: string;
      title: string;
    }
  | {
      kind: 'unsupported-step-omitted';
      stepId: string;
      title: string;
      detail: string;
    }
  | {
      kind: 'unsupported-simulation-rule-omitted';
      ruleId: string;
      title: string;
      detail: string;
    };

export type PlaywrightUiExportResult = {
  fileName: string;
  testName: string;
  code: string;
  warnings: PlaywrightUiExportWarning[];
};

export type ApiExportWarning =
  | {
      kind: 'non-http-capture-omitted';
      captureId: string;
      detail: string;
    }
  | {
      kind: 'request-body-not-inlineable';
      captureId: string;
      url: string;
      detail: string;
    }
  | {
      kind: 'response-body-not-asserted';
      captureId: string;
      url: string;
      detail: string;
    };

export type PlaywrightApiExportResult = {
  fileName: string;
  testName: string;
  code: string;
  warnings: ApiExportWarning[];
};

export type ApiRequestFixtureExportResult = {
  fileName: string;
  code: string;
  warnings: ApiExportWarning[];
};

export type ApiCollectionExportResult = {
  fileName: string;
  code: string;
  warnings: ApiExportWarning[];
};

export type SimulationExportWarning =
  | {
      kind: 'unsupported-simulation-rule-omitted';
      ruleId: string;
      title: string;
      detail: string;
    }
  | {
      kind: 'simulation-fixture-required';
      ruleId: string;
      title: string;
      detail: string;
    };

export type PlaywrightSimulationExportResult = {
  fileName: string;
  code: string;
  warnings: SimulationExportWarning[];
  exportedRuleIds: string[];
};

type ApiExportInput = {
  flowTitle?: string;
  steps?: RecordedStep[];
  captures: RequestResponseCapture[];
};

type SimulationExportInput = {
  simulationRules: SimulationRule[];
};

type ApiExportModel = {
  flowTitle: string;
  commonOrigin: string | null;
  warnings: ApiExportWarning[];
  requests: ApiExportRequest[];
  groups: ApiExportGroup[];
};

type ApiExportRequest = {
  capture: RequestResponseCapture;
  requestVariableName: string;
  requestUrl: string;
  requestInitLines: string[];
  responseAssertionLines: string[];
  fixture: {
    id: string;
    method: string;
    url: string;
    urlTemplate: string;
    triggeringStepId?: string;
    request: {
      headers: Record<string, string>;
      body: ApiFixtureBody;
    };
    response?: {
      status: number;
      headers: Record<string, string>;
      body: ApiFixtureBody;
    };
    correlationIds: string[];
    retryCount: number;
    blocked: boolean;
    durationMs?: number;
  };
};

type ApiExportGroup = {
  id: string;
  title: string;
  requests: ApiExportRequest[];
};

type ApiFixtureBody =
  | {
      state: 'full' | 'redacted';
      contentType?: string;
      text: string;
      parsedJson?: unknown;
      redactionRuleIds?: string[];
    }
  | {
      state: 'excluded' | 'unavailable' | 'truncated';
      contentType?: string;
      reason: string;
    };

type EmittedSimulationRule = {
  ruleId: string;
  routePattern: string;
  handlerLines: string[];
  usesFixture: boolean;
};

export function generatePlaywrightUiTest(input: {
  flowTitle?: string;
  steps: RecordedStep[];
  simulationRules?: SimulationRule[];
}): PlaywrightUiExportResult {
  const simulationMapping = generatePlaywrightSimulationRules({
    simulationRules: input.simulationRules ?? [],
  });
  const activeSteps = input.steps.filter((step) => step.status === 'active');
  const warnings: PlaywrightUiExportWarning[] = input.steps
    .filter((step) => step.status === 'disabled')
    .map((step) => ({
      kind: 'disabled-step-omitted',
      stepId: step.id,
      title: step.title,
    }));

  const fileName = 'generated/test.spec.ts';
  const testName = deriveTestName(input.flowTitle, activeSteps);
  const bodyLines: string[] = [];

  for (const step of activeSteps) {
    const emitted = emitStep(step);
    if (emitted) {
      bodyLines.push(...emitted);
      continue;
    }

    warnings.push({
      kind: 'unsupported-step-omitted',
      stepId: step.id,
      title: step.title,
      detail: describeUnsupportedStep(step),
    });
  }

  warnings.push(
    ...simulationMapping.warnings.map((warning) => ({
      kind: 'unsupported-simulation-rule-omitted' as const,
      ruleId: warning.ruleId,
      title: warning.title,
      detail: warning.detail,
    })),
  );

  const imports = [`import { test, expect } from '@playwright/test';`];
  if (simulationMapping.exportedRuleIds.length > 0) {
    imports.push(`import { installSimulationRules } from './simulation-rules';`);
  }

  const code = [
    ...imports,
    ``,
    `test(${JSON.stringify(testName)}, async ({ page }) => {`,
    ...indentLines(
      [
        ...(simulationMapping.exportedRuleIds.length > 0
          ? [`const removeSimulationRules = await installSimulationRules(page);`, ``]
          : []),
        ...(bodyLines.length > 0
          ? bodyLines
          : [`// No active supported steps were available for export.`]),
        ...(simulationMapping.exportedRuleIds.length > 0
          ? [``, `await removeSimulationRules();`]
          : []),
      ],
    ),
    `});`,
    ``,
  ].join('\n');

  return {
    fileName,
    testName,
    code,
    warnings,
  };
}

export function generatePlaywrightSimulationRules(
  input: SimulationExportInput,
): PlaywrightSimulationExportResult {
  const fileName = 'generated/simulation-rules.ts';
  const warnings: SimulationExportWarning[] = [];
  const executableRules = input.simulationRules
    .filter((rule) => rule.enabled)
    .flatMap((rule) => {
      const emitted = emitSimulationRule(rule, warnings);
      return emitted ? [emitted] : [];
    });
  const requiresReadFile = executableRules.some((rule) => rule.usesFixture);
  const importLines = [
    `import type { Page } from '@playwright/test';`,
    ...(requiresReadFile ? [`import { readFile } from 'node:fs/promises';`] : []),
  ];
  const bodyLines =
    executableRules.length === 0
      ? [`return async () => {};`]
      : [
          `const cleanup: Array<() => Promise<void>> = [];`,
          ``,
          ...executableRules.flatMap((rule) => [
            `await page.route(${JSON.stringify(rule.routePattern)}, async (route) => {`,
            ...indentLines(rule.handlerLines, 1),
            `});`,
            `cleanup.push(async () => {`,
            ...indentLines([`await page.unroute(${JSON.stringify(rule.routePattern)});`], 1),
            `});`,
            ``,
          ]),
          `return async () => {`,
          ...indentLines([`for (const remove of cleanup.reverse()) {`, `  await remove();`, `}`], 1),
          `};`,
        ];

  return {
    fileName,
    exportedRuleIds: executableRules.map((rule) => rule.ruleId),
    warnings,
    code: [
      ...importLines,
      ``,
      `export async function installSimulationRules(page: Page): Promise<() => Promise<void>> {`,
      ...indentLines(trimTrailingBlankLines(bodyLines)),
      `}`,
      ``,
      ...(requiresReadFile
        ? [
            `async function loadFixtureBody(path: string): Promise<string> {`,
            ...indentLines([`return readFile(path, 'utf8');`]),
            `}`,
            ``,
          ]
        : []),
    ].join('\n'),
  };
}

export function generatePlaywrightApiTest(input: ApiExportInput): PlaywrightApiExportResult {
  const model = buildApiExportModel(input);
  const fileName = 'generated/api.spec.ts';
  const testName = `${model.flowTitle} API`;
  const bodyLines: string[] = [];

  if (model.commonOrigin) {
    bodyLines.push(`const baseURL = process.env.BASE_URL ?? ${JSON.stringify(model.commonOrigin)};`);
    bodyLines.push(``);
  }

  for (const group of model.groups) {
    bodyLines.push(`test.step(${JSON.stringify(group.title)}, async () => {`);
    const groupLines: string[] = [];

    for (const request of group.requests) {
      groupLines.push(
        `const ${request.requestVariableName} = await request.${request.capture.request.method.toLowerCase()}(${request.requestUrl}, {`,
        ...indentLines(request.requestInitLines, 2),
        `});`,
      );

      if (request.responseAssertionLines.length > 0) {
        groupLines.push(...request.responseAssertionLines.map((line) => line.replace('$response', request.requestVariableName)));
      }

      groupLines.push(``);
    }

    bodyLines.push(...indentLines(trimTrailingBlankLines(groupLines), 1));
    bodyLines.push(`});`);
    bodyLines.push(``);
  }

  const code = [
    `import { test, expect } from '@playwright/test';`,
    ``,
    `test(${JSON.stringify(testName)}, async ({ request }) => {`,
    ...indentLines(
      trimTrailingBlankLines(
        bodyLines.length > 0
          ? bodyLines
          : [`// No HTTP captures were available for API export.`],
      ),
    ),
    `});`,
    ``,
  ].join('\n');

  return {
    fileName,
    testName,
    code,
    warnings: model.warnings,
  };
}

export function generateApiRequestFixture(input: ApiExportInput): ApiRequestFixtureExportResult {
  const model = buildApiExportModel(input);
  const fileName = 'fixtures/api-requests.json';
  const code = `${JSON.stringify(
    {
      schemaVersion: '1.0.0',
      flowTitle: model.flowTitle,
      environmentVariables: model.commonOrigin
        ? [
            {
              name: 'BASE_URL',
              defaultValue: model.commonOrigin,
              required: false,
            },
          ]
        : [],
      secretPlaceholders: [
        {
          token: '[REDACTED]',
          meaning: 'Value was redacted before export and should be replaced with a safe secret source.',
        },
      ],
      groups: model.groups.map((group) => ({
        id: group.id,
        title: group.title,
        requests: group.requests.map((request) => request.fixture),
      })),
      warnings: model.warnings,
    },
    null,
    2,
  )}\n`;

  return {
    fileName,
    code,
    warnings: model.warnings,
  };
}

export function generateApiCollection(input: ApiExportInput): ApiCollectionExportResult {
  const model = buildApiExportModel(input);
  const fileName = 'collections/postman.collection.json';
  const code = `${JSON.stringify(
    {
      info: {
        name: `${model.flowTitle} API Collection`,
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        description:
          'Generated by QA Browser Shell from canonical captured HTTP traffic. Redacted placeholders remain intentionally preserved.',
      },
      variable: model.commonOrigin
        ? [
            {
              key: 'baseUrl',
              value: model.commonOrigin,
              type: 'string',
            },
          ]
        : [],
      item: model.groups.map((group) => ({
        name: group.title,
        item: group.requests.map((request) => buildPostmanItem(request, model.commonOrigin)),
      })),
      protocolProfileBehavior: {
        disableBodyPruning: true,
      },
    },
    null,
    2,
  )}\n`;

  return {
    fileName,
    code,
    warnings: model.warnings,
  };
}

function buildApiExportModel(input: ApiExportInput): ApiExportModel {
  const flowTitle = deriveApiFlowTitle(input.flowTitle, input.captures);
  const commonOrigin = deriveCommonOrigin(input.captures);
  const warnings: ApiExportWarning[] = [];
  const stepTitleMap = new Map(input.steps?.map((step) => [step.id, step.title]) ?? []);
  const requests: ApiExportRequest[] = [];

  for (const capture of input.captures) {
    if (capture.protocol !== 'http') {
      warnings.push({
        kind: 'non-http-capture-omitted',
        captureId: capture.id,
        detail: `Capture protocol ${capture.protocol} is not exported in the API request artifacts.`,
      });
      continue;
    }

    requests.push(buildApiExportRequest(capture, commonOrigin, warnings, requests.length));
  }

  const groups = new Map<string, ApiExportGroup>();

  for (const request of requests) {
    const stepId = request.capture.triggeringStepId ?? 'uncorrelated';
    const title =
      request.capture.triggeringStepId && stepTitleMap.has(request.capture.triggeringStepId)
        ? stepTitleMap.get(request.capture.triggeringStepId) ?? request.capture.triggeringStepId
        : request.capture.triggeringStepId ?? 'Uncorrelated requests';
    const existing = groups.get(stepId);

    if (existing) {
      existing.requests.push(request);
      continue;
    }

    groups.set(stepId, {
      id: stepId,
      title,
      requests: [request],
    });
  }

  return {
    flowTitle,
    commonOrigin,
    warnings,
    requests,
    groups: [...groups.values()],
  };
}

function buildApiExportRequest(
  capture: RequestResponseCapture,
  commonOrigin: string | null,
  warnings: ApiExportWarning[],
  index: number,
): ApiExportRequest {
  const requestVariableName = `response${index + 1}`;
  const requestUrl = emitRequestUrl(capture.request.url, commonOrigin);
  const requestInitLines = buildRequestInitLines(capture, warnings);
  const responseAssertionLines = buildResponseAssertionLines(capture, warnings);

  return {
    capture,
    requestVariableName,
    requestUrl,
    requestInitLines,
    responseAssertionLines,
    fixture: {
      id: capture.id,
      method: capture.request.method,
      url: capture.request.url,
      urlTemplate: deriveUrlTemplate(capture.request.url, commonOrigin),
      triggeringStepId: capture.triggeringStepId,
      request: {
        headers: capture.request.headers,
        body: toFixtureBody(capture.request.body),
      },
      response: capture.response
        ? {
            status: capture.response.status,
            headers: capture.response.headers,
            body: toFixtureBody(capture.response.body),
          }
        : undefined,
      correlationIds: capture.correlationIds,
      retryCount: capture.retryCount,
      blocked: capture.blocked,
      durationMs: capture.durationMs,
    },
  };
}

function buildRequestInitLines(
  capture: RequestResponseCapture,
  warnings: ApiExportWarning[],
): string[] {
  const lines = [`headers: ${formatObjectLiteral(capture.request.headers)},`];
  const bodyLine = emitRequestBodyLine(capture, warnings);
  if (bodyLine) {
    lines.push(bodyLine);
  }
  return lines;
}

function emitRequestBodyLine(
  capture: RequestResponseCapture,
  warnings: ApiExportWarning[],
): string | null {
  const body = capture.request.body;
  if (!isTextCaptureBody(body)) {
    warnings.push({
      kind: 'request-body-not-inlineable',
      captureId: capture.id,
      url: capture.request.url,
      detail: `Request body is ${body.state} and cannot be emitted inline: ${body.reason}`,
    });
    return null;
  }

  if (body.contentType?.includes('application/json')) {
    const parsedJson = safeParseJson(body.text);
    if (parsedJson !== undefined) {
      return `data: ${formatValueLiteral(parsedJson)},`;
    }
  }

  return `data: ${JSON.stringify(body.text)},`;
}

function buildResponseAssertionLines(
  capture: RequestResponseCapture,
  warnings: ApiExportWarning[],
): string[] {
  const response = capture.response;
  if (!response) {
    return capture.failure
      ? [
          `expect($response.ok()).toBe(false);`,
          `// Original capture ended with failure ${JSON.stringify(capture.failure.code)}: ${capture.failure.message}`,
        ]
      : [];
  }

  const lines = [`expect($response.status()).toBe(${response.status});`];

  if (!isTextCaptureBody(response.body)) {
    warnings.push({
      kind: 'response-body-not-asserted',
      captureId: capture.id,
      url: capture.request.url,
      detail: `Response body is ${response.body.state} and was not converted into a body assertion: ${response.body.reason}`,
    });
    return lines;
  }

  if (response.body.contentType?.includes('application/json')) {
    const parsedJson = safeParseJson(response.body.text);
    if (parsedJson !== undefined) {
      const jsonVariableName = `${capture.id.replace(/[^a-zA-Z0-9]+/g, '_')}Json`;
      lines.push(`const ${jsonVariableName} = await $response.json();`);
      lines.push(
        Array.isArray(parsedJson) || isPlainObject(parsedJson)
          ? `expect(${jsonVariableName}).toMatchObject(${formatValueLiteral(parsedJson)});`
          : `expect(${jsonVariableName}).toEqual(${formatValueLiteral(parsedJson)});`,
      );
      return lines;
    }
  }

  if (response.body.text.length > 0) {
    lines.push(`await expect($response.text()).resolves.toContain(${JSON.stringify(response.body.text.slice(0, 120))});`);
  }

  return lines;
}

function deriveApiFlowTitle(flowTitle: string | undefined, captures: RequestResponseCapture[]): string {
  if (flowTitle && flowTitle.trim().length > 0) {
    return flowTitle.trim();
  }

  const firstHttpCapture = captures.find((capture) => capture.protocol === 'http');
  if (firstHttpCapture) {
    try {
      const url = new URL(firstHttpCapture.request.url);
      return `${url.hostname} API flow`;
    } catch {
      return `${firstHttpCapture.request.method} API flow`;
    }
  }

  return 'Recorded API flow';
}

function deriveTestName(flowTitle: string | undefined, steps: RecordedStep[]): string {
  const firstNavigate = steps.find(
    (step) => step.kind === 'action' && step.action.type === 'navigate',
  );

  if (flowTitle && flowTitle.trim().length > 0) {
    return flowTitle.trim();
  }

  if (firstNavigate && firstNavigate.kind === 'action' && firstNavigate.action.type === 'navigate') {
    try {
      const url = new URL(firstNavigate.action.url);
      const path = url.pathname === '/' ? 'home' : url.pathname.replace(/^\/+|\/+$/g, '').replace(/[/-]+/g, ' ');
      return `${url.hostname} ${path} flow`.trim();
    } catch {
      return firstNavigate.title;
    }
  }

  return steps[0]?.title ?? 'Recorded flow';
}

function deriveCommonOrigin(captures: RequestResponseCapture[]): string | null {
  const origins = captures
    .filter((capture) => capture.protocol === 'http')
    .map((capture) => {
      try {
        return new URL(capture.request.url).origin;
      } catch {
        return null;
      }
    })
    .filter((origin): origin is string => origin !== null);

  if (origins.length === 0) {
    return null;
  }

  return origins.every((origin) => origin === origins[0]) ? origins[0] : null;
}

function emitRequestUrl(url: string, commonOrigin: string | null): string {
  const template = deriveUrlTemplate(url, commonOrigin);
  if (commonOrigin) {
    return `\`${'${baseURL}'}${template}\``;
  }
  return JSON.stringify(template);
}

function deriveUrlTemplate(url: string, commonOrigin: string | null): string {
  if (!commonOrigin) {
    return url;
  }

  try {
    const parsed = new URL(url);
    if (parsed.origin !== commonOrigin) {
      return url;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function buildPostmanItem(
  request: ApiExportRequest,
  commonOrigin: string | null,
): {
  name: string;
  request: {
    method: string;
    header: Array<{ key: string; value: string; type: 'text' }>;
    url: string;
    description: string;
    body?: {
      mode: 'raw';
      raw: string;
      options: {
        raw: {
          language: string;
        };
      };
    };
  };
  response: Array<{
    name: string;
    originalRequest: {
      method: string;
      header: Array<{ key: string; value: string; type: 'text' }>;
      url: string;
      body?: {
        mode: 'raw';
        raw: string;
        options: {
          raw: {
            language: string;
          };
        };
      };
    };
    status: string;
    code: number;
    header: Array<{ key: string; value: string }>;
    body: string;
    _postman_previewlanguage?: string;
  }>;
} {
  const postmanRequest = {
    method: request.capture.request.method,
    header: Object.entries(request.capture.request.headers).map(([key, value]) => ({
      key,
      value,
      type: 'text' as const,
    })),
    url: derivePostmanUrl(request.capture.request.url, commonOrigin),
    description: buildPostmanDescription(request.capture),
    body: buildPostmanBody(request.capture.request.body),
  };

  return {
    name: `${request.capture.request.method} ${request.fixture.urlTemplate}`,
    request: postmanRequest,
    response: request.capture.response
      ? [
          {
            name: `${request.capture.response.status} response`,
            originalRequest: {
              method: postmanRequest.method,
              header: postmanRequest.header,
              url: postmanRequest.url,
              body: postmanRequest.body,
            },
            status: String(request.capture.response.status),
            code: request.capture.response.status,
            header: Object.entries(request.capture.response.headers).map(([key, value]) => ({
              key,
              value,
            })),
            body: buildPostmanResponseBody(request.capture.response.body),
            _postman_previewlanguage: inferPostmanLanguage(
              request.capture.response.body.contentType,
            ),
          },
        ]
      : [],
  };
}

function buildPostmanDescription(capture: RequestResponseCapture): string {
  return [
    `Captured by QA Browser Shell`,
    `Capture ID: ${capture.id}`,
    capture.triggeringStepId ? `Triggering step: ${capture.triggeringStepId}` : `Triggering step: uncorrelated`,
    `Retry count: ${capture.retryCount}`,
    `Blocked: ${capture.blocked ? 'yes' : 'no'}`,
  ].join('\n');
}

function derivePostmanUrl(url: string, commonOrigin: string | null): string {
  const template = deriveUrlTemplate(url, commonOrigin);
  if (commonOrigin && template !== url) {
    return `{{baseUrl}}${template}`;
  }
  return template;
}

function buildPostmanBody(body: CaptureBody):
  | {
      mode: 'raw';
      raw: string;
      options: {
        raw: {
          language: string;
        };
      };
    }
  | undefined {
  if (!isTextCaptureBody(body)) {
    return undefined;
  }

  return {
    mode: 'raw',
    raw: body.text,
    options: {
      raw: {
        language: inferPostmanLanguage(body.contentType),
      },
    },
  };
}

function buildPostmanResponseBody(body: CaptureBody): string {
  if (!isTextCaptureBody(body)) {
    return `[${body.state}] ${body.reason}`;
  }

  return body.text;
}

function toFixtureBody(body: CaptureBody): ApiFixtureBody {
  if (body.state === 'full') {
    return {
      state: 'full',
      contentType: body.contentType,
      text: body.text,
      parsedJson: safeParseJson(body.text),
    };
  }

  if (body.state === 'redacted') {
    return {
      state: 'redacted',
      contentType: body.contentType,
      text: body.text,
      parsedJson: safeParseJson(body.text),
      redactionRuleIds: body.redactionRuleIds,
    };
  }

  return {
    state: body.state,
    contentType: body.contentType,
    reason: body.reason,
  };
}

function emitStep(step: RecordedStep): string[] | null {
  if (step.kind === 'action') {
    switch (step.action.type) {
      case 'navigate':
        return [`await page.goto(${JSON.stringify(step.action.url)});`];
      case 'click':
        return [`await ${step.action.selector}.click();`];
      case 'double-click':
        return [`await ${step.action.selector}.dblclick();`];
      case 'fill':
        return [`await ${step.action.selector}.fill(${JSON.stringify(step.action.value)});`];
      case 'select-option':
        return [`await ${step.action.selector}.selectOption(${JSON.stringify(step.action.value)});`];
      case 'set-checked':
        return [`await ${step.action.selector}.setChecked(${step.action.checked ? 'true' : 'false'});`];
      case 'press-key': {
        const keyInput =
          step.action.modifiers.length > 0
            ? [...step.action.modifiers, step.action.key].join('+')
            : step.action.key;
        if (step.action.selector) {
          return [`await ${step.action.selector}.press(${JSON.stringify(keyInput)});`];
        }
        return [`await page.keyboard.press(${JSON.stringify(keyInput)});`];
      }
      case 'drag-and-drop':
        return [
          `await page.dragAndDrop(${JSON.stringify(step.action.sourceSelector)}, ${JSON.stringify(step.action.targetSelector)});`,
        ];
      case 'upload-file':
        return [
          `await ${step.action.selector}.setInputFiles(${JSON.stringify(step.action.fileName)});`,
        ];
      case 'dialog':
        return emitDialogAction(step.action);
      case 'wait-for-download':
        return [`await page.waitForEvent('download');`];
      case 'wait-for-popup':
        return [`await page.waitForEvent('popup');`];
      case 'reload':
        return [`await page.reload();`];
      default:
        return null;
    }
  }

  return emitAssertion(step.assertion);
}

function emitDialogAction(
  action: Extract<RecordedStep, { kind: 'action' }>['action'] & { type: 'dialog' },
): string[] {
  const handler =
    action.action === 'accept'
      ? `dialog.accept(${action.promptText ? JSON.stringify(action.promptText) : ''})`
      : 'dialog.dismiss()';

  return [
    `page.once('dialog', async (dialog) => {`,
    ...indentLines([`await ${handler};`]),
    `});`,
  ];
}

function emitAssertion(assertion: Assertion): string[] | null {
  switch (assertion.kind) {
    case 'element-visible':
      return [`await expect(${assertion.selector}).toBeVisible();`];
    case 'element-hidden':
      return [`await expect(${assertion.selector}).toBeHidden();`];
    case 'element-enabled':
      return [`await expect(${assertion.selector}).toBeEnabled();`];
    case 'element-contains-text':
      return [`await expect(${assertion.selector}).toContainText(${JSON.stringify(assertion.expectedText)});`];
    case 'url-matches':
      return [`await expect(page).toHaveURL(${emitUrlMatcher(assertion.expectedUrl, assertion.matchMode)});`];
    default:
      return null;
  }
}

function emitUrlMatcher(expectedUrl: string, mode: 'exact' | 'glob' | 'regex'): string {
  if (mode === 'regex') {
    return `new RegExp(${JSON.stringify(expectedUrl)})`;
  }

  return JSON.stringify(expectedUrl);
}

function describeUnsupportedStep(step: RecordedStep): string {
  if (step.kind === 'assertion') {
    return `Assertion kind ${step.assertion.kind} is not exported in Phase 8 slice 1.`;
  }

  return `Action type ${step.action.type} is not exported in Phase 8 slice 1.`;
}

function emitSimulationRule(
  rule: SimulationRule,
  warnings: SimulationExportWarning[],
): EmittedSimulationRule | null {
  const routePattern = rule.match.routePattern ?? (rule.match.domain ? `**/*` : '**/*');
  const guardLines = buildSimulationRequestGuards(rule);

  switch (rule.action.kind) {
    case 'fixed-latency':
      return {
        ruleId: rule.id,
        routePattern,
        usesFixture: false,
        handlerLines: [
          ...guardLines,
          `await new Promise((resolve) => setTimeout(resolve, ${rule.action.valueMsOrKbps}));`,
          `await route.continue();`,
        ],
      };
    case 'offline':
      return {
        ruleId: rule.id,
        routePattern,
        usesFixture: false,
        handlerLines: [...guardLines, `await route.abort('internetdisconnected');`],
      };
    case 'route-block':
      return {
        ruleId: rule.id,
        routePattern,
        usesFixture: false,
        handlerLines: [...guardLines, `await route.abort('blockedbyclient');`],
      };
    case 'forced-status':
      return {
        ruleId: rule.id,
        routePattern,
        usesFixture: false,
        handlerLines: [
          ...guardLines,
          `await route.fulfill({`,
          ...indentLines(
            [
              `status: ${rule.action.status},`,
              `contentType: 'text/plain',`,
              `body: ${JSON.stringify(`Forced status ${rule.action.status} by ${rule.title}.`)},`,
            ],
            1,
          ),
          `});`,
        ],
      };
    case 'delayed-response': {
      const responseLines = rule.action.fixturePath
        ? [
            `const fixtureBody = await loadFixtureBody(${JSON.stringify(rule.action.fixturePath)});`,
            `await route.fulfill({`,
            ...indentLines(
              [
                `status: ${rule.action.status ?? 200},`,
                `body: fixtureBody,`,
              ],
              1,
            ),
            `});`,
          ]
        : [
            `await route.fulfill({`,
            ...indentLines(
              [
                `status: ${rule.action.status ?? 200},`,
                `contentType: 'text/plain',`,
                `body: ${JSON.stringify(`Delayed response injected by ${rule.title}.`)},`,
              ],
              1,
            ),
            `});`,
          ];
      return {
        ruleId: rule.id,
        routePattern,
        usesFixture: Boolean(rule.action.fixturePath),
        handlerLines: [
          ...guardLines,
          `await new Promise((resolve) => setTimeout(resolve, ${rule.action.delayMs}));`,
          ...responseLines,
        ],
      };
    }
    case 'response-fixture':
      if (rule.action.fixturePath.trim().length === 0) {
        warnings.push({
          kind: 'simulation-fixture-required',
          ruleId: rule.id,
          title: rule.title,
          detail: 'Response fixture export requires a readable fixture path.',
        });
        return null;
      }

      return {
        ruleId: rule.id,
        routePattern,
        usesFixture: true,
        handlerLines: [
          ...guardLines,
          `const fixtureBody = await loadFixtureBody(${JSON.stringify(rule.action.fixturePath)});`,
          `await route.fulfill({`,
          ...indentLines(
            [
              `status: ${rule.action.status ?? 200},`,
              `body: fixtureBody,`,
            ],
            1,
          ),
          `});`,
        ],
      };
    case 'latency-jitter':
    case 'throttle-upload':
    case 'throttle-download':
      warnings.push({
        kind: 'unsupported-simulation-rule-omitted',
        ruleId: rule.id,
        title: rule.title,
        detail: `Simulation action ${rule.action.kind} is not exported into Playwright code in Phase 8 slice 5.`,
      });
      return null;
    default:
      warnings.push({
        kind: 'unsupported-simulation-rule-omitted',
        ruleId: rule.id,
        title: rule.title,
        detail: `Simulation action ${(rule as { action: { kind: string } }).action.kind} is not exported into Playwright code in Phase 8 slice 5.`,
      });
      return null;
  }
}

function buildSimulationRequestGuards(rule: SimulationRule): string[] {
  const guards: string[] = [];
  if (rule.match.method) {
    guards.push(
      `if (route.request().method() !== ${JSON.stringify(rule.match.method.toUpperCase())}) {`,
      ...indentLines([`await route.continue();`, `return;`]),
      `}`,
    );
  }

  if (rule.match.domain) {
    guards.push(
      `if (new URL(route.request().url()).hostname !== ${JSON.stringify(rule.match.domain)}) {`,
      ...indentLines([`await route.continue();`, `return;`]),
      `}`,
    );
  }

  return guards;
}

function safeParseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isTextCaptureBody(
  body: CaptureBody,
): body is Extract<CaptureBody, { state: 'full' | 'redacted' }> {
  return body.state === 'full' || body.state === 'redacted';
}

function inferPostmanLanguage(contentType: string | undefined): string {
  if (!contentType) {
    return 'text';
  }

  if (contentType.includes('application/json')) {
    return 'json';
  }

  if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
    return 'xml';
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    return 'text';
  }

  if (contentType.includes('text/html')) {
    return 'html';
  }

  return 'text';
}

function formatObjectLiteral(value: Record<string, string>): string {
  if (Object.keys(value).length === 0) {
    return '{}';
  }

  return formatValueLiteral(value);
}

function formatValueLiteral(value: unknown, depth = 0): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }

    return `[\n${value
      .map((entry) => `${'  '.repeat(depth + 1)}${formatValueLiteral(entry, depth + 1)}`)
      .join(',\n')}\n${'  '.repeat(depth)}]`;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return '{}';
    }

    return `{\n${entries
      .map(
        ([key, entryValue]) =>
          `${'  '.repeat(depth + 1)}${JSON.stringify(key)}: ${formatValueLiteral(entryValue, depth + 1)}`,
      )
      .join(',\n')}\n${'  '.repeat(depth)}}`;
  }

  return JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') {
    trimmed.pop();
  }
  return trimmed;
}

function indentLines(lines: string[], level = 1): string[] {
  const padding = '  '.repeat(level);
  return lines.map((line) => `${padding}${line}`);
}
