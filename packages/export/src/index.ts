import type { Assertion, RecordedStep } from '@browser-blackbox/domain';

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
    };

export type PlaywrightUiExportResult = {
  fileName: string;
  testName: string;
  code: string;
  warnings: PlaywrightUiExportWarning[];
};

export function generatePlaywrightUiTest(input: {
  flowTitle?: string;
  steps: RecordedStep[];
}): PlaywrightUiExportResult {
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

  const code = [
    `import { test, expect } from '@playwright/test';`,
    ``,
    `test(${JSON.stringify(testName)}, async ({ page }) => {`,
    ...indentLines(bodyLines.length > 0 ? bodyLines : [`// No active supported steps were available for export.`]),
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

function indentLines(lines: string[]): string[] {
  return lines.map((line) => `  ${line}`);
}
