import type {
  ArtifactManifest,
  Assertion,
  Checkpoint,
  DiagnosisResult,
  InspectionMetadata,
  RecordedStep,
  RedactionRule,
  RequestResponseCapture,
  SelectorCandidate,
  SimulationRule,
  TimelineEvent,
} from './contracts';
import { domainVersions } from './contracts';

export const selectorCandidateFixture: SelectorCandidate = {
  schemaVersion: domainVersions.domainSchemaVersion,
  locator: 'page.getByRole("button", { name: "Sign in" })',
  strategy: 'role-name',
  uniqueness: 'unique',
  stability: 'excellent',
  stabilityScore: 96,
  reasoning: ['Unique accessible role and name', 'No structural selector fallback required'],
  fallback: false,
};

export const assertionFixture: Assertion = {
  schemaVersion: domainVersions.domainSchemaVersion,
  kind: 'element-visible',
  selector: 'page.getByRole("heading", { name: "Dashboard" })',
};

export const recordedStepFixture: RecordedStep = {
  schemaVersion: domainVersions.domainSchemaVersion,
  id: 'step-login-submit',
  title: 'Submit login form',
  kind: 'action',
  status: 'active',
  evidenceState: 'current',
  createdAt: '2026-06-24T12:00:00.000Z',
  updatedAt: '2026-06-24T12:00:00.000Z',
  dependencyStepIds: ['step-fill-username', 'step-fill-password'],
  invalidatesEvidenceAfter: true,
  action: {
    type: 'click',
    selector: 'page.getByRole("button", { name: "Sign in" })',
  },
};

export const inspectionMetadataFixture: InspectionMetadata = {
  schemaVersion: domainVersions.domainSchemaVersion,
  target: {
    tagName: 'button',
    textContent: 'Sign in',
    attributes: {
      type: 'submit',
      'data-testid': 'login-submit',
    },
    role: 'button',
    accessibleName: 'Sign in',
    interactiveType: 'button',
  },
  recommendations: {
    primary: selectorCandidateFixture,
    fallbacks: [
      {
        ...selectorCandidateFixture,
        locator: 'page.getByTestId("login-submit")',
        strategy: 'test-id',
        fallback: true,
      },
    ],
  },
  stableParent: {
    locator: 'page.getByTestId("login-form")',
    strategy: 'test-id',
    reasoning: ['Parent form exposes a stable test contract attribute.'],
  },
  context: {
    testId: 'login-submit',
    iframeDepth: 0,
    inShadowDom: false,
    visible: true,
    enabled: true,
    obscured: false,
  },
  relatedRequestIds: ['request-auth-login'],
};

export const requestResponseCaptureFixture: RequestResponseCapture = {
  schemaVersion: domainVersions.domainSchemaVersion,
  id: 'request-auth-login',
  timestamp: '2026-06-24T12:00:02.000Z',
  triggeringStepId: 'step-login-submit',
  protocol: 'http',
  request: {
    url: 'https://example.test/api/login',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: {
      state: 'redacted',
      contentType: 'application/json',
      text: '{"email":"qa@example.test","password":"[REDACTED]"}',
      redactionRuleIds: ['rule-password'],
    },
  },
  response: {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
    body: {
      state: 'full',
      contentType: 'application/json',
      text: '{"token":"opaque","user":{"id":"u-1"}}',
    },
  },
  durationMs: 412,
  correlationIds: ['x-request-id:abc-123'],
  origin: {
    fromCache: false,
    fromServiceWorker: false,
  },
  retryCount: 0,
  blocked: false,
  timings: {
    dnsMs: 6,
    connectMs: 18,
    tlsMs: 29,
    requestMs: 30,
    responseMs: 329,
  },
};

export const redactionRuleFixture: RedactionRule = {
  schemaVersion: domainVersions.domainSchemaVersion,
  id: 'rule-password',
  kind: 'json-path',
  target: '$.password',
  scope: 'request',
  mode: 'always',
};

export const simulationRuleFixture: SimulationRule = {
  schemaVersion: domainVersions.domainSchemaVersion,
  id: 'sim-login-latency',
  enabled: true,
  title: 'Slow login API',
  appliesTo: 'scenario',
  match: {
    routePattern: '**/api/login',
    method: 'POST',
  },
  action: {
    kind: 'fixed-latency',
    valueMsOrKbps: 750,
  },
};

export const timelineEventFixture: TimelineEvent = {
  schemaVersion: domainVersions.domainSchemaVersion,
  id: 'timeline-assertion-dashboard',
  timestamp: '2026-06-24T12:00:03.000Z',
  kind: 'assertion',
  stepId: 'step-dashboard-visible',
  summary: 'Dashboard heading became visible',
  assertionKind: 'element-visible',
  outcome: 'passed',
};

export const diagnosisResultFixture: DiagnosisResult = {
  schemaVersion: domainVersions.domainSchemaVersion,
  catalogVersion: domainVersions.diagnosisRuleCatalogVersion,
  findings: [
    {
      schemaVersion: domainVersions.domainSchemaVersion,
      ruleId: 'assertion_blocked_by_failed_request',
      confidence: 'high',
      evidenceEventIds: ['timeline-request-auth-login', 'timeline-assertion-dashboard'],
      affectedWindow: {
        startedAt: '2026-06-24T12:00:02.000Z',
        endedAt: '2026-06-24T12:00:08.000Z',
      },
      summary: 'The login assertion failed after a blocking API request returned an error.',
    },
  ],
};

export const checkpointFixture: Checkpoint = {
  schemaVersion: domainVersions.domainSchemaVersion,
  checkpointModelVersion: domainVersions.checkpointModelVersion,
  id: 'checkpoint-post-login',
  label: 'Post-login dashboard',
  kind: 'browser-context',
  createdAt: '2026-06-24T12:00:04.000Z',
  stepId: 'step-dashboard-visible',
  dependencyStepIds: ['step-fill-username', 'step-fill-password', 'step-login-submit'],
  status: 'valid',
  invalidationReasons: [],
  captures: {
    cookies: true,
    localStorage: true,
    sessionStorage: true,
  },
  snapshot: {
    capturedAt: '2026-06-24T12:00:04.000Z',
    pageUrl: 'https://example.test/dashboard',
    cookies: [
      {
        name: 'session',
        value: 'opaque-session',
        domain: 'example.test',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ],
    origins: [
      {
        origin: 'https://example.test',
        localStorage: {
          auth_state: 'signed-in',
        },
        sessionStorage: {
          dashboard_tab: 'overview',
        },
      },
    ],
  },
};

export const artifactManifestFixture: ArtifactManifest = {
  schemaVersion: domainVersions.domainSchemaVersion,
  artifactFormatVersion: domainVersions.artifactFormatVersion,
  appVersion: '0.1.0',
  createdAt: '2026-06-24T12:00:10.000Z',
  targetUrl: 'https://example.test/login',
  runId: 'run-001',
  replayEngine: {
    id: 'playwright',
    version: '1.54.1',
    browserTarget: 'chromium',
  },
  redactionPolicyVersion: domainVersions.redactionPolicyVersion,
  checkpointModelVersion: domainVersions.checkpointModelVersion,
  compatibility: {
    minimumAppVersion: '0.1.0',
    supportedArtifactMajorVersions: [1],
  },
  artifacts: [
    {
      path: 'generated/test.spec.ts',
      kind: 'generated-test',
      required: true,
      present: true,
    },
    {
      path: 'logs/timeline.json',
      kind: 'timeline',
      required: true,
      present: true,
    },
    {
      path: 'network/api-capture.json',
      kind: 'api-capture',
      required: true,
      present: true,
    },
    {
      path: 'media/video/session.webm',
      kind: 'video',
      required: false,
      present: false,
    },
  ],
};
