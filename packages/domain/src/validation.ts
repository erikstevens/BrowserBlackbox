import type {
  ArtifactManifest,
  Assertion,
  Checkpoint,
  DiagnosisFinding,
  DiagnosisResult,
  DomainBundle,
  InspectionMetadata,
  LocatorRecommendation,
  RecordedStep,
  RedactionRule,
  RequestResponseCapture,
  SelectorCandidate,
  SimulationRule,
  TimelineEvent,
} from './contracts';
import {
  ARTIFACT_FORMAT_VERSION,
  CHECKPOINT_MODEL_VERSION,
  DIAGNOSIS_RULE_CATALOG_VERSION,
  DOMAIN_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
} from './versions';

type IssueCollector = string[];

type UnknownRecord = Record<string, unknown>;

export class DomainValidationError extends Error {
  constructor(
    public readonly contractName: string,
    public readonly issues: string[],
  ) {
    super(`Invalid ${contractName}: ${issues.join('; ')}`);
    this.name = 'DomainValidationError';
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function isIsoDate(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function validateSchemaVersion(
  issues: IssueCollector,
  value: unknown,
  field: string,
  expected: string,
): void {
  if (value !== expected) {
    issues.push(`${field} must equal ${expected}`);
  }
}

function validateLiteral<T extends string>(
  issues: IssueCollector,
  value: unknown,
  field: string,
  allowed: readonly T[],
): value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    issues.push(`${field} must be one of: ${allowed.join(', ')}`);
    return false;
  }
  return true;
}

function validateNumberRange(
  issues: IssueCollector,
  value: unknown,
  field: string,
  options: { min?: number; max?: number },
): value is number {
  if (!isNumber(value)) {
    issues.push(`${field} must be a finite number`);
    return false;
  }

  if (options.min !== undefined && value < options.min) {
    issues.push(`${field} must be >= ${options.min}`);
  }

  if (options.max !== undefined && value > options.max) {
    issues.push(`${field} must be <= ${options.max}`);
  }

  return true;
}

function validateBaseEntity(
  issues: IssueCollector,
  value: unknown,
  contractName: string,
): value is UnknownRecord {
  if (!isRecord(value)) {
    issues.push(`${contractName} must be an object`);
    return false;
  }

  validateSchemaVersion(issues, value.schemaVersion, 'schemaVersion', DOMAIN_SCHEMA_VERSION);
  return true;
}

function assertValid<T>(
  contractName: string,
  value: unknown,
  validator: (value: unknown, issues: IssueCollector) => value is T,
): T {
  const issues: string[] = [];

  if (!validator(value, issues)) {
    throw new DomainValidationError(contractName, issues);
  }

  if (issues.length > 0) {
    throw new DomainValidationError(contractName, issues);
  }

  return value;
}

function validateSelectorCandidate(
  value: unknown,
  issues: IssueCollector,
): value is SelectorCandidate {
  if (!validateBaseEntity(issues, value, 'SelectorCandidate')) {
    return false;
  }

  validateLiteral(
    issues,
    value.strategy,
    'strategy',
    ['test-id', 'role-name', 'label', 'semantic-attribute', 'text', 'css', 'xpath'] as const,
  );
  validateLiteral(
    issues,
    value.uniqueness,
    'uniqueness',
    ['unique', 'multiple', 'unknown'] as const,
  );
  validateLiteral(
    issues,
    value.stability,
    'stability',
    ['excellent', 'good', 'risky', 'fragile'] as const,
  );

  if (!isNonEmptyString(value.locator)) {
    issues.push('locator must be a non-empty string');
  }

  validateNumberRange(issues, value.stabilityScore, 'stabilityScore', { min: 0, max: 100 });

  if (!isStringArray(value.reasoning) || value.reasoning.length === 0) {
    issues.push('reasoning must contain at least one string');
  }

  if (!isBoolean(value.fallback)) {
    issues.push('fallback must be a boolean');
  }

  return true;
}

function validateLocatorRecommendation(
  value: unknown,
  issues: IssueCollector,
): value is LocatorRecommendation {
  if (!isRecord(value)) {
    issues.push('recommendations must be an object');
    return false;
  }

  validateSelectorCandidate(value.primary, issues);

  if (!Array.isArray(value.fallbacks)) {
    issues.push('fallbacks must be an array');
    return false;
  }

  value.fallbacks.forEach((candidate, index) => {
    const fallbackIssues: string[] = [];
    validateSelectorCandidate(candidate, fallbackIssues);
    fallbackIssues.forEach((issue) => issues.push(`fallbacks[${index}].${issue}`));

    if (isRecord(candidate) && candidate.fallback !== true) {
      issues.push(`fallbacks[${index}] must set fallback to true`);
    }
  });

  return true;
}

function validateAssertion(value: unknown, issues: IssueCollector): value is Assertion {
  if (!validateBaseEntity(issues, value, 'Assertion')) {
    return false;
  }

  if (
    !validateLiteral(
      issues,
      value.kind,
      'kind',
      [
        'element-visible',
        'element-hidden',
        'element-enabled',
        'element-contains-text',
        'url-matches',
        'api-response-status',
        'api-response-body-contains',
        'no-console-errors',
        'page-load-under',
        'download-occurred',
        'request-occurred',
        'request-completed-within',
      ] as const,
    )
  ) {
    return false;
  }

  switch (value.kind) {
    case 'element-visible':
    case 'element-hidden':
    case 'element-enabled':
      if (!isNonEmptyString(value.selector)) {
        issues.push('selector must be a non-empty string');
      }
      break;
    case 'element-contains-text':
      if (!isNonEmptyString(value.selector)) {
        issues.push('selector must be a non-empty string');
      }
      if (!isNonEmptyString(value.expectedText)) {
        issues.push('expectedText must be a non-empty string');
      }
      break;
    case 'url-matches':
      if (!isNonEmptyString(value.expectedUrl)) {
        issues.push('expectedUrl must be a non-empty string');
      }
      validateLiteral(issues, value.matchMode, 'matchMode', ['exact', 'glob', 'regex'] as const);
      break;
    case 'api-response-status':
      if (!isNonEmptyString(value.requestMatcher)) {
        issues.push('requestMatcher must be a non-empty string');
      }
      validateNumberRange(issues, value.expectedStatus, 'expectedStatus', { min: 100, max: 599 });
      break;
    case 'api-response-body-contains':
      if (!isNonEmptyString(value.requestMatcher)) {
        issues.push('requestMatcher must be a non-empty string');
      }
      if (!isNonEmptyString(value.expectedValue)) {
        issues.push('expectedValue must be a non-empty string');
      }
      break;
    case 'page-load-under':
      validateNumberRange(issues, value.thresholdMs, 'thresholdMs', { min: 1 });
      break;
    case 'download-occurred':
      if (value.fileNamePattern !== undefined && !isNonEmptyString(value.fileNamePattern)) {
        issues.push('fileNamePattern must be a non-empty string when provided');
      }
      break;
    case 'request-occurred':
      if (!isNonEmptyString(value.requestMatcher)) {
        issues.push('requestMatcher must be a non-empty string');
      }
      break;
    case 'request-completed-within':
      if (!isNonEmptyString(value.requestMatcher)) {
        issues.push('requestMatcher must be a non-empty string');
      }
      validateNumberRange(issues, value.thresholdMs, 'thresholdMs', { min: 1 });
      break;
    case 'no-console-errors':
      break;
  }

  return true;
}

function validateRecordedStep(value: unknown, issues: IssueCollector): value is RecordedStep {
  if (!validateBaseEntity(issues, value, 'RecordedStep')) {
    return false;
  }

  if (!isNonEmptyString(value.id)) {
    issues.push('id must be a non-empty string');
  }

  if (!isNonEmptyString(value.title)) {
    issues.push('title must be a non-empty string');
  }

  validateLiteral(issues, value.status, 'status', ['active', 'disabled'] as const);
  validateLiteral(
    issues,
    value.evidenceState,
    'evidenceState',
    ['current', 'stale', 'pending-regeneration'] as const,
  );

  if (!isIsoDate(value.createdAt)) {
    issues.push('createdAt must be an ISO timestamp');
  }

  if (!isIsoDate(value.updatedAt)) {
    issues.push('updatedAt must be an ISO timestamp');
  }

  if (!isStringArray(value.dependencyStepIds)) {
    issues.push('dependencyStepIds must be an array of strings');
  }

  if (!isBoolean(value.invalidatesEvidenceAfter)) {
    issues.push('invalidatesEvidenceAfter must be a boolean');
  }

  if (!validateLiteral(issues, value.kind, 'kind', ['action', 'assertion'] as const)) {
    return false;
  }

  if (value.kind === 'action') {
    if (!isRecord(value.action)) {
      issues.push('action must be an object');
      return false;
    }

    if (
      !validateLiteral(
        issues,
        value.action.type,
        'action.type',
        [
          'navigate',
          'click',
          'double-click',
          'fill',
          'select-option',
          'set-checked',
          'press-key',
          'drag-and-drop',
          'upload-file',
          'dialog',
          'wait-for-download',
          'wait-for-popup',
          'reload',
        ] as const,
      )
    ) {
      return false;
    }

    switch (value.action.type) {
      case 'navigate':
        if (!isNonEmptyString(value.action.url)) {
          issues.push('action.url must be a non-empty string');
        }
        break;
      case 'click':
      case 'double-click':
        if (!isNonEmptyString(value.action.selector)) {
          issues.push('action.selector must be a non-empty string');
        }
        break;
      case 'fill':
        if (!isNonEmptyString(value.action.selector)) {
          issues.push('action.selector must be a non-empty string');
        }
        if (typeof value.action.value !== 'string') {
          issues.push('action.value must be a string');
        }
        if (!isBoolean(value.action.sensitive)) {
          issues.push('action.sensitive must be a boolean');
        }
        break;
      case 'select-option':
        if (!isNonEmptyString(value.action.selector) || !isNonEmptyString(value.action.value)) {
          issues.push('select-option requires selector and value');
        }
        break;
      case 'set-checked':
        if (!isNonEmptyString(value.action.selector)) {
          issues.push('action.selector must be a non-empty string');
        }
        if (!isBoolean(value.action.checked)) {
          issues.push('action.checked must be a boolean');
        }
        break;
      case 'press-key':
        if (!isNonEmptyString(value.action.key)) {
          issues.push('action.key must be a non-empty string');
        }
        if (
          value.action.selector !== undefined &&
          !isNonEmptyString(value.action.selector)
        ) {
          issues.push('action.selector must be a non-empty string when provided');
        }
        if (!Array.isArray(value.action.modifiers) || !value.action.modifiers.every(isNonEmptyString)) {
          issues.push('action.modifiers must be an array of strings');
        }
        break;
      case 'drag-and-drop':
        if (
          !isNonEmptyString(value.action.sourceSelector) ||
          !isNonEmptyString(value.action.targetSelector)
        ) {
          issues.push('drag-and-drop requires sourceSelector and targetSelector');
        }
        break;
      case 'upload-file':
        if (!isNonEmptyString(value.action.selector) || !isNonEmptyString(value.action.fileName)) {
          issues.push('upload-file requires selector and fileName');
        }
        break;
      case 'dialog':
        validateLiteral(
          issues,
          value.action.dialogType,
          'action.dialogType',
          ['alert', 'confirm', 'prompt', 'beforeunload'] as const,
        );
        validateLiteral(
          issues,
          value.action.action,
          'action.action',
          ['accept', 'dismiss'] as const,
        );
        if (value.action.promptText !== undefined && typeof value.action.promptText !== 'string') {
          issues.push('action.promptText must be a string when provided');
        }
        break;
      case 'wait-for-download':
      case 'wait-for-popup':
      case 'reload':
        break;
    }
  }

  if (value.kind === 'assertion') {
    validateAssertion(value.assertion, issues);
  }

  return true;
}

function validateInspectionMetadata(
  value: unknown,
  issues: IssueCollector,
): value is InspectionMetadata {
  if (!validateBaseEntity(issues, value, 'InspectionMetadata')) {
    return false;
  }

  if (!isRecord(value.target)) {
    issues.push('target must be an object');
  } else {
    if (!isNonEmptyString(value.target.tagName)) {
      issues.push('target.tagName must be a non-empty string');
    }
    if (!isStringRecord(value.target.attributes)) {
      issues.push('target.attributes must be a string record');
    }
    if (value.target.textContent !== undefined && typeof value.target.textContent !== 'string') {
      issues.push('target.textContent must be a string when provided');
    }
    if (value.target.role !== undefined && !isNonEmptyString(value.target.role)) {
      issues.push('target.role must be a non-empty string when provided');
    }
    if (
      value.target.accessibleName !== undefined &&
      !isNonEmptyString(value.target.accessibleName)
    ) {
      issues.push('target.accessibleName must be a non-empty string when provided');
    }
    if (value.target.labelText !== undefined && !isNonEmptyString(value.target.labelText)) {
      issues.push('target.labelText must be a non-empty string when provided');
    }
    validateLiteral(
      issues,
      value.target.interactiveType,
      'target.interactiveType',
      ['button', 'link', 'input', 'select', 'textarea', 'checkbox', 'radio', 'other'] as const,
    );
  }

  validateLocatorRecommendation(value.recommendations, issues);

  if (value.stableParent !== undefined) {
    if (!isRecord(value.stableParent)) {
      issues.push('stableParent must be an object when provided');
    } else {
      if (!isNonEmptyString(value.stableParent.locator)) {
        issues.push('stableParent.locator must be a non-empty string');
      }
      validateLiteral(
        issues,
        value.stableParent.strategy,
        'stableParent.strategy',
        ['test-id', 'role-name', 'label', 'semantic-attribute', 'text', 'css', 'xpath'] as const,
      );
      if (!isStringArray(value.stableParent.reasoning) || value.stableParent.reasoning.length === 0) {
        issues.push('stableParent.reasoning must contain at least one string');
      }
    }
  }

  if (!isRecord(value.context)) {
    issues.push('context must be an object');
  } else {
    const context = value.context;

    validateNumberRange(issues, context.iframeDepth, 'context.iframeDepth', { min: 0 });
    ['inShadowDom', 'visible', 'enabled', 'obscured'].forEach((field) => {
      if (!isBoolean(context[field])) {
        issues.push(`context.${field} must be a boolean`);
      }
    });
    if (context.testId !== undefined && !isNonEmptyString(context.testId)) {
      issues.push('context.testId must be a non-empty string when provided');
    }
    if (context.iframeSource !== undefined && !isNonEmptyString(context.iframeSource)) {
      issues.push('context.iframeSource must be a non-empty string when provided');
    }
  }

  if (!isStringArray(value.relatedRequestIds)) {
    issues.push('relatedRequestIds must be an array of strings');
  }

  return true;
}

function validateCaptureBody(value: unknown, issues: IssueCollector, field: string): void {
  if (!isRecord(value)) {
    issues.push(`${field} must be an object`);
    return;
  }

  if (
    !validateLiteral(
      issues,
      value.state,
      `${field}.state`,
      ['full', 'redacted', 'excluded', 'unavailable', 'truncated'] as const,
    )
  ) {
    return;
  }

  if (value.contentType !== undefined && !isNonEmptyString(value.contentType)) {
    issues.push(`${field}.contentType must be a non-empty string when provided`);
  }

  switch (value.state) {
    case 'full':
      if (typeof value.text !== 'string') {
        issues.push(`${field}.text must be a string`);
      }
      break;
    case 'redacted':
      if (typeof value.text !== 'string') {
        issues.push(`${field}.text must be a string`);
      }
      if (!isStringArray(value.redactionRuleIds) || value.redactionRuleIds.length === 0) {
        issues.push(`${field}.redactionRuleIds must contain at least one string`);
      }
      break;
    case 'excluded':
    case 'unavailable':
    case 'truncated':
      if (!isNonEmptyString(value.reason)) {
        issues.push(`${field}.reason must be a non-empty string`);
      }
      break;
  }
}

function validateRequestResponseCapture(
  value: unknown,
  issues: IssueCollector,
): value is RequestResponseCapture {
  if (!validateBaseEntity(issues, value, 'RequestResponseCapture')) {
    return false;
  }

  if (!isNonEmptyString(value.id)) {
    issues.push('id must be a non-empty string');
  }

  if (!isIsoDate(value.timestamp)) {
    issues.push('timestamp must be an ISO timestamp');
  }

  if (
    value.triggeringStepId !== undefined &&
    !isNonEmptyString(value.triggeringStepId)
  ) {
    issues.push('triggeringStepId must be a non-empty string when provided');
  }

  validateLiteral(issues, value.protocol, 'protocol', ['http', 'websocket'] as const);

  if (!isRecord(value.request)) {
    issues.push('request must be an object');
  } else {
    if (!isNonEmptyString(value.request.url)) {
      issues.push('request.url must be a non-empty string');
    }
    if (!isNonEmptyString(value.request.method)) {
      issues.push('request.method must be a non-empty string');
    }
    if (!isStringRecord(value.request.headers)) {
      issues.push('request.headers must be a string record');
    }
    validateCaptureBody(value.request.body, issues, 'request.body');
  }

  if (value.response !== undefined) {
    if (!isRecord(value.response)) {
      issues.push('response must be an object when provided');
    } else {
      validateNumberRange(issues, value.response.status, 'response.status', { min: 100, max: 599 });
      if (!isStringRecord(value.response.headers)) {
        issues.push('response.headers must be a string record');
      }
      validateCaptureBody(value.response.body, issues, 'response.body');
    }
  }

  if (value.durationMs !== undefined) {
    validateNumberRange(issues, value.durationMs, 'durationMs', { min: 0 });
  }

  if (value.failure !== undefined) {
    if (!isRecord(value.failure)) {
      issues.push('failure must be an object when provided');
    } else {
      if (!isNonEmptyString(value.failure.code)) {
        issues.push('failure.code must be a non-empty string');
      }
      if (!isNonEmptyString(value.failure.message)) {
        issues.push('failure.message must be a non-empty string');
      }
    }
  }

  if (!isStringArray(value.correlationIds)) {
    issues.push('correlationIds must be an array of strings');
  }

  if (!isRecord(value.origin)) {
    issues.push('origin must be an object');
  } else {
    if (!isBoolean(value.origin.fromCache)) {
      issues.push('origin.fromCache must be a boolean');
    }
    if (!isBoolean(value.origin.fromServiceWorker)) {
      issues.push('origin.fromServiceWorker must be a boolean');
    }
  }

  validateNumberRange(issues, value.retryCount, 'retryCount', { min: 0 });

  if (!isBoolean(value.blocked)) {
    issues.push('blocked must be a boolean');
  }

  if (value.timings !== undefined) {
    if (!isRecord(value.timings)) {
      issues.push('timings must be an object when provided');
    } else {
      const timings = value.timings;

      ['dnsMs', 'connectMs', 'tlsMs', 'requestMs', 'responseMs'].forEach((field) => {
        if (timings[field] !== undefined) {
          validateNumberRange(issues, timings[field], `timings.${field}`, { min: 0 });
        }
      });
    }
  }

  return true;
}

function validateRedactionRule(value: unknown, issues: IssueCollector): value is RedactionRule {
  if (!validateBaseEntity(issues, value, 'RedactionRule')) {
    return false;
  }

  if (!isNonEmptyString(value.id)) {
    issues.push('id must be a non-empty string');
  }

  validateLiteral(
    issues,
    value.kind,
    'kind',
    ['header', 'cookie', 'query-param', 'form-field', 'json-path', 'regex'] as const,
  );

  if (!isNonEmptyString(value.target)) {
    issues.push('target must be a non-empty string');
  }

  validateLiteral(issues, value.scope, 'scope', ['request', 'response', 'both'] as const);
  validateLiteral(issues, value.mode, 'mode', ['always', 'user-defined'] as const);

  return true;
}

function validateSimulationRule(value: unknown, issues: IssueCollector): value is SimulationRule {
  if (!validateBaseEntity(issues, value, 'SimulationRule')) {
    return false;
  }

  if (!isNonEmptyString(value.id)) {
    issues.push('id must be a non-empty string');
  }
  if (!isBoolean(value.enabled)) {
    issues.push('enabled must be a boolean');
  }
  if (!isNonEmptyString(value.title)) {
    issues.push('title must be a non-empty string');
  }

  validateLiteral(issues, value.appliesTo, 'appliesTo', ['global', 'scenario'] as const);

  if (!isRecord(value.match)) {
    issues.push('match must be an object');
  } else {
    const match = value.match;
    const matchFields = ['routePattern', 'domain', 'method', 'flowContext'] as const;
    const definedFields = matchFields.filter((field) => match[field] !== undefined);

    if (definedFields.length === 0) {
      issues.push('match must define at least one routePattern, domain, method, or flowContext');
    }

    definedFields.forEach((field) => {
      if (!isNonEmptyString(match[field])) {
        issues.push(`match.${field} must be a non-empty string when provided`);
      }
    });
  }

  if (!isRecord(value.action)) {
    issues.push('action must be an object');
    return false;
  }

  if (
    !validateLiteral(
      issues,
      value.action.kind,
      'action.kind',
      [
        'fixed-latency',
        'latency-jitter',
        'throttle-upload',
        'throttle-download',
        'offline',
        'route-block',
        'forced-status',
        'delayed-response',
        'response-fixture',
      ] as const,
    )
  ) {
    return false;
  }

  switch (value.action.kind) {
    case 'fixed-latency':
    case 'latency-jitter':
    case 'throttle-upload':
    case 'throttle-download':
      validateNumberRange(issues, value.action.valueMsOrKbps, 'action.valueMsOrKbps', { min: 1 });
      break;
    case 'offline':
      break;
    case 'route-block':
      if (value.action.statusText !== undefined && !isNonEmptyString(value.action.statusText)) {
        issues.push('action.statusText must be a non-empty string when provided');
      }
      break;
    case 'forced-status':
      validateNumberRange(issues, value.action.status, 'action.status', { min: 100, max: 599 });
      break;
    case 'delayed-response':
      validateNumberRange(issues, value.action.delayMs, 'action.delayMs', { min: 1 });
      if (value.action.status !== undefined) {
        validateNumberRange(issues, value.action.status, 'action.status', { min: 100, max: 599 });
      }
      if (value.action.fixturePath !== undefined && !isNonEmptyString(value.action.fixturePath)) {
        issues.push('action.fixturePath must be a non-empty string when provided');
      }
      break;
    case 'response-fixture':
      if (!isNonEmptyString(value.action.fixturePath)) {
        issues.push('action.fixturePath must be a non-empty string');
      }
      if (value.action.status !== undefined) {
        validateNumberRange(issues, value.action.status, 'action.status', { min: 100, max: 599 });
      }
      break;
  }

  return true;
}

function validateTimelineEvent(value: unknown, issues: IssueCollector): value is TimelineEvent {
  if (!validateBaseEntity(issues, value, 'TimelineEvent')) {
    return false;
  }

  if (!isNonEmptyString(value.id)) {
    issues.push('id must be a non-empty string');
  }
  if (!isIsoDate(value.timestamp)) {
    issues.push('timestamp must be an ISO timestamp');
  }
  if (!isNonEmptyString(value.summary)) {
    issues.push('summary must be a non-empty string');
  }

  if (
    !validateLiteral(
      issues,
      value.kind,
      'kind',
      [
        'user-action',
        'navigation',
        'retry',
        'timeout',
        'screenshot',
        'assertion',
        'request',
        'console',
        'exception',
        'simulation-rule',
        'checkpoint',
      ] as const,
    )
  ) {
    return false;
  }

  switch (value.kind) {
    case 'user-action':
    case 'navigation':
    case 'retry':
    case 'timeout':
    case 'screenshot':
      if (value.stepId !== undefined && !isNonEmptyString(value.stepId)) {
        issues.push('stepId must be a non-empty string when provided');
      }
      break;
    case 'assertion':
      if (!isNonEmptyString(value.stepId)) {
        issues.push('stepId must be a non-empty string');
      }
      validateLiteral(
        issues,
        value.assertionKind,
        'assertionKind',
        [
          'element-visible',
          'element-hidden',
          'element-enabled',
          'element-contains-text',
          'url-matches',
          'api-response-status',
          'api-response-body-contains',
          'no-console-errors',
          'page-load-under',
          'download-occurred',
          'request-occurred',
          'request-completed-within',
        ] as const,
      );
      validateLiteral(issues, value.outcome, 'outcome', ['passed', 'failed'] as const);
      break;
    case 'request':
      if (!isNonEmptyString(value.requestId)) {
        issues.push('requestId must be a non-empty string');
      }
      break;
    case 'console':
    case 'exception':
      validateLiteral(issues, value.severity, 'severity', ['warning', 'error'] as const);
      break;
    case 'simulation-rule':
      if (!isNonEmptyString(value.ruleId)) {
        issues.push('ruleId must be a non-empty string');
      }
      break;
    case 'checkpoint':
      if (!isNonEmptyString(value.checkpointId)) {
        issues.push('checkpointId must be a non-empty string');
      }
      validateLiteral(issues, value.status, 'status', ['created', 'reused', 'invalidated'] as const);
      break;
  }

  return true;
}

function validateDiagnosisFinding(
  value: unknown,
  issues: IssueCollector,
): value is DiagnosisFinding {
  if (!validateBaseEntity(issues, value, 'DiagnosisFinding')) {
    return false;
  }

  validateLiteral(
    issues,
    value.ruleId,
    'ruleId',
    [
      'assertion_blocked_by_failed_request',
      'assertion_blocked_by_console_error',
      'assertion_blocked_by_missing_dom_transition',
      'navigation_blocked_by_request_failure',
      'download_missing_without_trigger',
      'popup_missing_without_trigger',
    ] as const,
  );
  validateLiteral(issues, value.confidence, 'confidence', ['high', 'medium', 'low'] as const);

  if (!isStringArray(value.evidenceEventIds) || value.evidenceEventIds.length === 0) {
    issues.push('evidenceEventIds must contain at least one string');
  }

  if (!isRecord(value.affectedWindow)) {
    issues.push('affectedWindow must be an object');
  } else {
    if (!isIsoDate(value.affectedWindow.startedAt)) {
      issues.push('affectedWindow.startedAt must be an ISO timestamp');
    }
    if (!isIsoDate(value.affectedWindow.endedAt)) {
      issues.push('affectedWindow.endedAt must be an ISO timestamp');
    }
  }

  if (!isNonEmptyString(value.summary)) {
    issues.push('summary must be a non-empty string');
  }

  return true;
}

function validateDiagnosisResult(
  value: unknown,
  issues: IssueCollector,
): value is DiagnosisResult {
  if (!validateBaseEntity(issues, value, 'DiagnosisResult')) {
    return false;
  }

  validateSchemaVersion(
    issues,
    value.catalogVersion,
    'catalogVersion',
    DIAGNOSIS_RULE_CATALOG_VERSION,
  );

  if (!Array.isArray(value.findings)) {
    issues.push('findings must be an array');
  } else {
    value.findings.forEach((finding, index) => {
      const findingIssues: string[] = [];
      validateDiagnosisFinding(finding, findingIssues);
      findingIssues.forEach((issue) => issues.push(`findings[${index}].${issue}`));
    });
  }

  if (Array.isArray(value.findings) && value.findings.length === 0 && !isNonEmptyString(value.noDeterminationReason)) {
    issues.push('noDeterminationReason is required when findings is empty');
  }

  return true;
}

function validateCheckpoint(value: unknown, issues: IssueCollector): value is Checkpoint {
  if (!validateBaseEntity(issues, value, 'Checkpoint')) {
    return false;
  }

  validateSchemaVersion(
    issues,
    value.checkpointModelVersion,
    'checkpointModelVersion',
    CHECKPOINT_MODEL_VERSION,
  );

  ['id', 'label', 'stepId'].forEach((field) => {
    if (!isNonEmptyString(value[field])) {
      issues.push(`${field} must be a non-empty string`);
    }
  });

  validateLiteral(issues, value.kind, 'kind', ['step-boundary', 'browser-context'] as const);
  validateLiteral(issues, value.status, 'status', ['valid', 'stale'] as const);

  if (!isIsoDate(value.createdAt)) {
    issues.push('createdAt must be an ISO timestamp');
  }

  if (!isStringArray(value.dependencyStepIds)) {
    issues.push('dependencyStepIds must be an array of strings');
  }

  if (!Array.isArray(value.invalidationReasons) || !value.invalidationReasons.every(isNonEmptyString)) {
    issues.push('invalidationReasons must be an array of strings');
  }

  const invalidationReasons = Array.isArray(value.invalidationReasons)
    ? value.invalidationReasons
    : undefined;

  if (value.status === 'stale' && invalidationReasons?.length === 0) {
    issues.push('stale checkpoints must include at least one invalidation reason');
  }

  if (value.status === 'valid' && invalidationReasons !== undefined && invalidationReasons.length > 0) {
    issues.push('valid checkpoints cannot include invalidation reasons');
  }

  if (!isRecord(value.captures)) {
    issues.push('captures must be an object');
  } else {
    const captures = value.captures;
    ['cookies', 'localStorage', 'sessionStorage'].forEach((field) => {
      if (!isBoolean(captures[field])) {
        issues.push(`captures.${field} must be a boolean`);
      }
    });
  }

  if (value.snapshot !== undefined) {
    if (!isRecord(value.snapshot)) {
      issues.push('snapshot must be an object when present');
    } else {
      if (!isIsoDate(value.snapshot.capturedAt)) {
        issues.push('snapshot.capturedAt must be an ISO timestamp');
      }

      if (!isNonEmptyString(value.snapshot.pageUrl)) {
        issues.push('snapshot.pageUrl must be a non-empty string');
      }

      if (!Array.isArray(value.snapshot.cookies)) {
        issues.push('snapshot.cookies must be an array');
      } else {
        value.snapshot.cookies.forEach((cookie, index) => {
          if (!isRecord(cookie)) {
            issues.push(`snapshot.cookies[${index}] must be an object`);
            return;
          }

          ['name', 'value', 'domain', 'path'].forEach((field) => {
            if (!isNonEmptyString(cookie[field])) {
              issues.push(`snapshot.cookies[${index}].${field} must be a non-empty string`);
            }
          });

          if (typeof cookie.expires !== 'number') {
            issues.push(`snapshot.cookies[${index}].expires must be a number`);
          }

          ['httpOnly', 'secure'].forEach((field) => {
            if (!isBoolean(cookie[field])) {
              issues.push(`snapshot.cookies[${index}].${field} must be a boolean`);
            }
          });

          validateLiteral(
            issues,
            cookie.sameSite,
            `snapshot.cookies[${index}].sameSite`,
            ['Strict', 'Lax', 'None'] as const,
          );
        });
      }

      if (!Array.isArray(value.snapshot.origins)) {
        issues.push('snapshot.origins must be an array');
      } else {
        value.snapshot.origins.forEach((origin, index) => {
          if (!isRecord(origin)) {
            issues.push(`snapshot.origins[${index}] must be an object`);
            return;
          }

          if (!isNonEmptyString(origin.origin)) {
            issues.push(`snapshot.origins[${index}].origin must be a non-empty string`);
          }

          ['localStorage', 'sessionStorage'].forEach((field) => {
            if (!isRecord(origin[field])) {
              issues.push(`snapshot.origins[${index}].${field} must be an object`);
              return;
            }

            for (const [key, entry] of Object.entries(origin[field])) {
              if (typeof entry !== 'string') {
                issues.push(
                  `snapshot.origins[${index}].${field}.${key} must be a string`,
                );
              }
            }
          });
        });
      }
    }
  }

  return true;
}

function validateArtifactManifest(
  value: unknown,
  issues: IssueCollector,
): value is ArtifactManifest {
  if (!validateBaseEntity(issues, value, 'ArtifactManifest')) {
    return false;
  }

  validateSchemaVersion(
    issues,
    value.artifactFormatVersion,
    'artifactFormatVersion',
    ARTIFACT_FORMAT_VERSION,
  );
  validateSchemaVersion(
    issues,
    value.redactionPolicyVersion,
    'redactionPolicyVersion',
    REDACTION_POLICY_VERSION,
  );
  validateSchemaVersion(
    issues,
    value.checkpointModelVersion,
    'checkpointModelVersion',
    CHECKPOINT_MODEL_VERSION,
  );

  ['appVersion', 'targetUrl', 'runId'].forEach((field) => {
    if (!isNonEmptyString(value[field])) {
      issues.push(`${field} must be a non-empty string`);
    }
  });

  if (!isIsoDate(value.createdAt)) {
    issues.push('createdAt must be an ISO timestamp');
  }

  if (!isRecord(value.replayEngine)) {
    issues.push('replayEngine must be an object');
  } else {
    validateLiteral(issues, value.replayEngine.id, 'replayEngine.id', ['playwright'] as const);
    if (!isNonEmptyString(value.replayEngine.version)) {
      issues.push('replayEngine.version must be a non-empty string');
    }
    validateLiteral(
      issues,
      value.replayEngine.browserTarget,
      'replayEngine.browserTarget',
      ['chromium'] as const,
    );
  }

  if (!isRecord(value.compatibility)) {
    issues.push('compatibility must be an object');
  } else {
    if (!isNonEmptyString(value.compatibility.minimumAppVersion)) {
      issues.push('compatibility.minimumAppVersion must be a non-empty string');
    }
    if (
      !Array.isArray(value.compatibility.supportedArtifactMajorVersions) ||
      !value.compatibility.supportedArtifactMajorVersions.every(
        (entry) => Number.isInteger(entry) && entry > 0,
      )
    ) {
      issues.push('compatibility.supportedArtifactMajorVersions must be an array of positive integers');
    }
  }

  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) {
    issues.push('artifacts must contain at least one entry');
  } else {
    value.artifacts.forEach((artifact, index) => {
      if (!isRecord(artifact)) {
        issues.push(`artifacts[${index}] must be an object`);
        return;
      }

      if (!isNonEmptyString(artifact.path)) {
        issues.push(`artifacts[${index}].path must be a non-empty string`);
      }

      validateLiteral(
        issues,
        artifact.kind,
        `artifacts[${index}].kind`,
        [
          'generated-test',
          'trace',
          'console-log',
          'network-capture',
          'api-capture',
          'timeline',
          'report',
          'screenshot',
          'video',
          'dom-snapshot',
          'api-collection',
          'fixture',
          'selector-repair',
          'replay-metadata',
          'checkpoint-metadata',
        ] as const,
      );

      if (!isBoolean(artifact.required)) {
        issues.push(`artifacts[${index}].required must be a boolean`);
      }
      if (!isBoolean(artifact.present)) {
        issues.push(`artifacts[${index}].present must be a boolean`);
      }
      if (artifact.required === true && artifact.present === false) {
        issues.push(`artifacts[${index}] cannot be required and missing`);
      }
    });
  }

  return true;
}

function validateDomainBundle(value: unknown, issues: IssueCollector): value is DomainBundle {
  if (!validateBaseEntity(issues, value, 'DomainBundle')) {
    return false;
  }

  const fields: Array<
    readonly [keyof DomainBundle, (entry: unknown, childIssues: IssueCollector) => boolean]
  > = [
    ['steps', (entry, childIssues) => Array.isArray(entry) && entry.every((item) => validateRecordedStep(item, childIssues))],
    [
      'captures',
      (entry, childIssues) =>
        Array.isArray(entry) && entry.every((item) => validateRequestResponseCapture(item, childIssues)),
    ],
    [
      'timeline',
      (entry, childIssues) =>
        Array.isArray(entry) && entry.every((item) => validateTimelineEvent(item, childIssues)),
    ],
    [
      'checkpoints',
      (entry, childIssues) =>
        Array.isArray(entry) && entry.every((item) => validateCheckpoint(item, childIssues)),
    ],
    ['manifest', (entry, childIssues) => validateArtifactManifest(entry, childIssues)],
  ];

  fields.forEach(([field, validator]) => {
    const childIssues: string[] = [];
    const valid = validator(value[field], childIssues);
    if (!valid) {
      issues.push(`${String(field)} is invalid`);
    }
    childIssues.forEach((issue) => issues.push(`${String(field)}.${issue}`));
  });

  return true;
}

export function parseSelectorCandidate(value: unknown): SelectorCandidate {
  return assertValid('SelectorCandidate', value, validateSelectorCandidate);
}

export function parseAssertion(value: unknown): Assertion {
  return assertValid('Assertion', value, validateAssertion);
}

export function parseRecordedStep(value: unknown): RecordedStep {
  return assertValid('RecordedStep', value, validateRecordedStep);
}

export function parseInspectionMetadata(value: unknown): InspectionMetadata {
  return assertValid('InspectionMetadata', value, validateInspectionMetadata);
}

export function parseRequestResponseCapture(value: unknown): RequestResponseCapture {
  return assertValid('RequestResponseCapture', value, validateRequestResponseCapture);
}

export function parseRedactionRule(value: unknown): RedactionRule {
  return assertValid('RedactionRule', value, validateRedactionRule);
}

export function parseSimulationRule(value: unknown): SimulationRule {
  return assertValid('SimulationRule', value, validateSimulationRule);
}

export function parseTimelineEvent(value: unknown): TimelineEvent {
  return assertValid('TimelineEvent', value, validateTimelineEvent);
}

export function parseDiagnosisResult(value: unknown): DiagnosisResult {
  return assertValid('DiagnosisResult', value, validateDiagnosisResult);
}

export function parseCheckpoint(value: unknown): Checkpoint {
  return assertValid('Checkpoint', value, validateCheckpoint);
}

export function parseArtifactManifest(value: unknown): ArtifactManifest {
  return assertValid('ArtifactManifest', value, validateArtifactManifest);
}

export function parseDomainBundle(value: unknown): DomainBundle {
  return assertValid('DomainBundle', value, validateDomainBundle);
}

export function deterministicSerialize(value: unknown): string {
  return JSON.stringify(sortForSerialization(value));
}

function sortForSerialization(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortForSerialization(entry));
  }

  if (isRecord(value)) {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = sortForSerialization(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

export function transitionEvidenceState(
  current: 'current' | 'stale' | 'pending-regeneration',
  next: 'current' | 'stale' | 'pending-regeneration',
): 'current' | 'stale' | 'pending-regeneration' {
  const allowedTransitions: Record<string, Array<'current' | 'stale' | 'pending-regeneration'>> = {
    current: ['stale', 'pending-regeneration'],
    stale: ['pending-regeneration'],
    'pending-regeneration': ['current', 'stale'],
  };

  if (!allowedTransitions[current].includes(next)) {
    throw new DomainValidationError('EvidenceStateTransition', [
      `cannot transition evidence state from ${current} to ${next}`,
    ]);
  }

  return next;
}

export function invalidateCheckpoint(checkpoint: Checkpoint, reason: string): Checkpoint {
  const nextReason = reason.trim();

  if (nextReason.length === 0) {
    throw new DomainValidationError('Checkpoint', ['invalidation reason must be non-empty']);
  }

  return parseCheckpoint({
    ...checkpoint,
    status: 'stale',
    invalidationReasons: checkpoint.invalidationReasons.includes(nextReason)
      ? checkpoint.invalidationReasons
      : [...checkpoint.invalidationReasons, nextReason],
  });
}
