import {
  ARTIFACT_FORMAT_VERSION,
  CHECKPOINT_MODEL_VERSION,
  DIAGNOSIS_RULE_CATALOG_VERSION,
  DOMAIN_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  type SemanticVersion,
} from './versions';

export const productSummary =
  'Turn a real browser session into maintainable Playwright output, reusable API artifacts, and debuggable evidence without leaving a single desktop workspace.';

export type ManagedBrowserTarget = 'chromium';

export type EvidenceState = 'current' | 'stale' | 'pending-regeneration';
export type StepStatus = 'active' | 'disabled';
export type SelectorStrategy =
  | 'test-id'
  | 'role-name'
  | 'label'
  | 'semantic-attribute'
  | 'text'
  | 'css'
  | 'xpath';
export type StabilityTier = 'excellent' | 'good' | 'risky' | 'fragile';

export type SelectorCandidate = {
  schemaVersion: SemanticVersion;
  locator: string;
  strategy: SelectorStrategy;
  uniqueness: 'unique' | 'multiple' | 'unknown';
  stability: StabilityTier;
  stabilityScore: number;
  reasoning: string[];
  fallback: boolean;
};

export type LocatorRecommendation = {
  primary: SelectorCandidate;
  fallbacks: SelectorCandidate[];
};

export type Assertion =
  | {
      schemaVersion: SemanticVersion;
      kind: 'element-visible' | 'element-hidden' | 'element-enabled';
      selector: string;
    }
  | {
      schemaVersion: SemanticVersion;
      kind: 'element-contains-text';
      selector: string;
      expectedText: string;
    }
  | {
      schemaVersion: SemanticVersion;
      kind: 'url-matches';
      expectedUrl: string;
      matchMode: 'exact' | 'glob' | 'regex';
    }
  | {
      schemaVersion: SemanticVersion;
      kind: 'api-response-status';
      requestMatcher: string;
      expectedStatus: number;
    }
  | {
      schemaVersion: SemanticVersion;
      kind: 'api-response-body-contains';
      requestMatcher: string;
      expectedValue: string;
    }
  | {
      schemaVersion: SemanticVersion;
      kind: 'no-console-errors';
    }
  | {
      schemaVersion: SemanticVersion;
      kind: 'page-load-under';
      thresholdMs: number;
    }
  | {
      schemaVersion: SemanticVersion;
      kind: 'download-occurred';
      fileNamePattern?: string;
    }
  | {
      schemaVersion: SemanticVersion;
      kind: 'request-occurred';
      requestMatcher: string;
    }
  | {
      schemaVersion: SemanticVersion;
      kind: 'request-completed-within';
      requestMatcher: string;
      thresholdMs: number;
    };

export type StepAction =
  | {
      type: 'navigate';
      url: string;
    }
  | {
      type: 'click' | 'double-click';
      selector: string;
    }
  | {
      type: 'fill';
      selector: string;
      value: string;
      sensitive: boolean;
    }
  | {
      type: 'select-option';
      selector: string;
      value: string;
    }
  | {
      type: 'set-checked';
      selector: string;
      checked: boolean;
    }
  | {
      type: 'press-key';
      selector?: string;
      key: string;
      modifiers: string[];
    }
  | {
      type: 'drag-and-drop';
      sourceSelector: string;
      targetSelector: string;
    }
  | {
      type: 'upload-file';
      selector: string;
      fileName: string;
    }
  | {
      type: 'dialog';
      dialogType: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
      action: 'accept' | 'dismiss';
      promptText?: string;
    }
  | {
      type: 'wait-for-download' | 'wait-for-popup' | 'reload';
    };

type RecordedStepBase = {
  schemaVersion: SemanticVersion;
  id: string;
  title: string;
  status: StepStatus;
  evidenceState: EvidenceState;
  createdAt: string;
  updatedAt: string;
  dependencyStepIds: string[];
  invalidatesEvidenceAfter: boolean;
};

export type ActionStep = RecordedStepBase & {
  kind: 'action';
  action: StepAction;
};

export type AssertionStep = RecordedStepBase & {
  kind: 'assertion';
  assertion: Assertion;
};

export type RecordedStep = ActionStep | AssertionStep;

export type InspectionMetadata = {
  schemaVersion: SemanticVersion;
  target: {
    tagName: string;
    textContent?: string;
    attributes: Record<string, string>;
    role?: string;
    accessibleName?: string;
    labelText?: string;
    interactiveType:
      | 'button'
      | 'link'
      | 'input'
      | 'select'
      | 'textarea'
      | 'checkbox'
      | 'radio'
      | 'other';
  };
  recommendations: LocatorRecommendation;
  context: {
    testId?: string;
    iframeDepth: number;
    iframeSource?: string;
    inShadowDom: boolean;
    visible: boolean;
    enabled: boolean;
    obscured: boolean;
  };
  relatedRequestIds: string[];
};

export type CaptureBody =
  | {
      state: 'full';
      contentType?: string;
      text: string;
    }
  | {
      state: 'redacted';
      contentType?: string;
      text: string;
      redactionRuleIds: string[];
    }
  | {
      state: 'excluded' | 'unavailable' | 'truncated';
      contentType?: string;
      reason: string;
    };

export type RequestResponseCapture = {
  schemaVersion: SemanticVersion;
  id: string;
  timestamp: string;
  triggeringStepId?: string;
  protocol: 'http' | 'websocket';
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: CaptureBody;
  };
  response?: {
    status: number;
    headers: Record<string, string>;
    body: CaptureBody;
  };
  durationMs?: number;
  failure?: {
    code: string;
    message: string;
  };
  correlationIds: string[];
  origin: {
    fromCache: boolean;
    fromServiceWorker: boolean;
  };
  retryCount: number;
  blocked: boolean;
  timings?: {
    dnsMs?: number;
    connectMs?: number;
    tlsMs?: number;
    requestMs?: number;
    responseMs?: number;
  };
};

export type RedactionRule =
  | {
      schemaVersion: SemanticVersion;
      id: string;
      kind: 'header' | 'cookie' | 'query-param' | 'form-field';
      target: string;
      scope: 'request' | 'response' | 'both';
      mode: 'always' | 'user-defined';
    }
  | {
      schemaVersion: SemanticVersion;
      id: string;
      kind: 'json-path' | 'regex';
      target: string;
      scope: 'request' | 'response' | 'both';
      mode: 'always' | 'user-defined';
    };

export type SimulationRule =
  | {
      schemaVersion: SemanticVersion;
      id: string;
      enabled: boolean;
      title: string;
      appliesTo: 'global' | 'scenario';
      match: {
        routePattern?: string;
        domain?: string;
        method?: string;
        flowContext?: string;
      };
      action: {
        kind: 'fixed-latency' | 'latency-jitter' | 'throttle-upload' | 'throttle-download';
        valueMsOrKbps: number;
      };
    }
  | {
      schemaVersion: SemanticVersion;
      id: string;
      enabled: boolean;
      title: string;
      appliesTo: 'global' | 'scenario';
      match: {
        routePattern?: string;
        domain?: string;
        method?: string;
        flowContext?: string;
      };
      action:
        | {
            kind: 'offline';
          }
        | {
            kind: 'route-block';
            statusText?: string;
          }
        | {
            kind: 'forced-status';
            status: number;
          }
        | {
            kind: 'delayed-response';
            delayMs: number;
            status?: number;
            fixturePath?: string;
          }
        | {
            kind: 'response-fixture';
            fixturePath: string;
            status?: number;
          };
    };

export type TimelineEvent =
  | {
      schemaVersion: SemanticVersion;
      id: string;
      timestamp: string;
      kind: 'user-action' | 'navigation' | 'retry' | 'timeout' | 'screenshot';
      stepId?: string;
      summary: string;
    }
  | {
      schemaVersion: SemanticVersion;
      id: string;
      timestamp: string;
      kind: 'assertion';
      stepId: string;
      summary: string;
      assertionKind: Assertion['kind'];
      outcome: 'passed' | 'failed';
    }
  | {
      schemaVersion: SemanticVersion;
      id: string;
      timestamp: string;
      kind: 'request';
      requestId: string;
      summary: string;
    }
  | {
      schemaVersion: SemanticVersion;
      id: string;
      timestamp: string;
      kind: 'console' | 'exception';
      summary: string;
      severity: 'warning' | 'error';
    }
  | {
      schemaVersion: SemanticVersion;
      id: string;
      timestamp: string;
      kind: 'simulation-rule';
      ruleId: string;
      summary: string;
    }
  | {
      schemaVersion: SemanticVersion;
      id: string;
      timestamp: string;
      kind: 'checkpoint';
      checkpointId: string;
      summary: string;
      status: 'created' | 'reused' | 'invalidated';
    };

export type DiagnosisRuleId =
  | 'assertion_blocked_by_failed_request'
  | 'assertion_blocked_by_console_error'
  | 'assertion_blocked_by_missing_dom_transition'
  | 'navigation_blocked_by_request_failure'
  | 'download_missing_without_trigger'
  | 'popup_missing_without_trigger';

export type DiagnosisFinding = {
  schemaVersion: SemanticVersion;
  ruleId: DiagnosisRuleId;
  confidence: 'high' | 'medium' | 'low';
  evidenceEventIds: string[];
  affectedWindow: {
    startedAt: string;
    endedAt: string;
  };
  summary: string;
};

export type DiagnosisResult = {
  schemaVersion: SemanticVersion;
  catalogVersion: SemanticVersion;
  findings: DiagnosisFinding[];
  noDeterminationReason?: string;
};

export type Checkpoint = {
  schemaVersion: SemanticVersion;
  checkpointModelVersion: SemanticVersion;
  id: string;
  label: string;
  kind: 'step-boundary' | 'browser-context';
  createdAt: string;
  stepId: string;
  dependencyStepIds: string[];
  status: 'valid' | 'stale';
  invalidationReasons: string[];
  captures: {
    cookies: boolean;
    localStorage: boolean;
    sessionStorage: boolean;
  };
};

export type ArtifactManifest = {
  schemaVersion: SemanticVersion;
  artifactFormatVersion: SemanticVersion;
  appVersion: SemanticVersion;
  createdAt: string;
  targetUrl: string;
  runId: string;
  replayEngine: {
    id: 'playwright';
    version: string;
    browserTarget: ManagedBrowserTarget;
  };
  redactionPolicyVersion: SemanticVersion;
  checkpointModelVersion: SemanticVersion;
  compatibility: {
    minimumAppVersion: SemanticVersion;
    supportedArtifactMajorVersions: number[];
  };
  artifacts: Array<{
    path: string;
    kind:
      | 'generated-test'
      | 'trace'
      | 'console-log'
      | 'network-capture'
      | 'api-capture'
      | 'timeline'
      | 'report'
      | 'screenshot'
      | 'video'
      | 'dom-snapshot'
      | 'api-collection'
      | 'fixture'
      | 'selector-repair'
      | 'replay-metadata'
      | 'checkpoint-metadata';
    required: boolean;
    present: boolean;
  }>;
};

export type DomainBundle = {
  schemaVersion: SemanticVersion;
  steps: RecordedStep[];
  captures: RequestResponseCapture[];
  timeline: TimelineEvent[];
  checkpoints: Checkpoint[];
  manifest: ArtifactManifest;
};

export const domainVersions = {
  domainSchemaVersion: DOMAIN_SCHEMA_VERSION,
  artifactFormatVersion: ARTIFACT_FORMAT_VERSION,
  checkpointModelVersion: CHECKPOINT_MODEL_VERSION,
  redactionPolicyVersion: REDACTION_POLICY_VERSION,
  diagnosisRuleCatalogVersion: DIAGNOSIS_RULE_CATALOG_VERSION,
} as const;
