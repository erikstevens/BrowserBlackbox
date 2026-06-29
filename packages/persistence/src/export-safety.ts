import type { CaptureBody, RequestResponseCapture } from '@browser-blackbox/domain';
import type {
  ArtifactExportMode,
  ArtifactExportSafetyAssessment,
  ArtifactExportWarning,
  StoredRunSnapshot,
} from './contracts';

const SENSITIVE_PATTERNS: Array<{
  reason: ArtifactExportWarning['reason'];
  pattern: RegExp;
}> = [
  {
    reason: 'email-like-content',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  },
  {
    reason: 'credential-keyword',
    pattern: /\b(password|passcode|secret|api[_-]?key)\b/i,
  },
  {
    reason: 'authorization-token-pattern',
    pattern: /\b(bearer\s+[a-z0-9\-._~+/]+=*|access[_-]?token|refresh[_-]?token|authorization)\b/i,
  },
  {
    reason: 'session-identifier-pattern',
    pattern: /\b(session(id)?|set-cookie)\b/i,
  },
];

export function assessArtifactExportSafety(
  snapshot: StoredRunSnapshot,
): ArtifactExportSafetyAssessment {
  const findings = snapshot.captures.flatMap((capture) => collectCaptureWarnings(capture));

  return {
    warningCount: findings.length,
    findings,
  };
}

export function prepareSnapshotForArtifactExport(
  snapshot: StoredRunSnapshot,
  mode: ArtifactExportMode,
): {
  assessment: ArtifactExportSafetyAssessment;
  snapshot: StoredRunSnapshot;
} {
  const assessment = assessArtifactExportSafety(snapshot);

  if (mode === 'unsafe-unredacted' || assessment.warningCount === 0) {
    return {
      assessment,
      snapshot,
    };
  }

  const warningKeys = new Set(
    assessment.findings.map((finding) => `${finding.captureId}:${finding.side}`),
  );

  return {
    assessment,
    snapshot: {
      ...snapshot,
      captures: snapshot.captures.map((capture) => {
        const requestKey = `${capture.id}:request`;
        const responseKey = `${capture.id}:response`;

        return {
          ...capture,
          request: {
            ...capture.request,
            body: warningKeys.has(requestKey)
              ? createExportExcludedBody(capture.request.body)
              : capture.request.body,
          },
          response: capture.response
            ? {
                ...capture.response,
                body: warningKeys.has(responseKey)
                  ? createExportExcludedBody(capture.response.body)
                  : capture.response.body,
              }
            : undefined,
        };
      }),
    },
  };
}

function collectCaptureWarnings(capture: RequestResponseCapture): ArtifactExportWarning[] {
  return [
    ...collectBodyWarnings(capture.id, capture.request.url, 'request', capture.request.body),
    ...collectBodyWarnings(capture.id, capture.request.url, 'response', capture.response?.body),
  ];
}

function collectBodyWarnings(
  captureId: string,
  url: string,
  side: 'request' | 'response',
  body: CaptureBody | undefined,
): ArtifactExportWarning[] {
  if (!body || body.state !== 'full') {
    return [];
  }

  for (const entry of SENSITIVE_PATTERNS) {
    if (entry.pattern.test(body.text)) {
      return [
        {
          captureId,
          side,
          url,
          reason: entry.reason,
          preview: `Detected ${entry.reason} in a visible ${side} body.`,
        },
      ];
    }
  }

  return [];
}

function createExportExcludedBody(body: CaptureBody): CaptureBody {
  return {
    state: 'excluded',
    contentType: body.contentType,
    reason:
      'Excluded from default artifact export because the payload matched the export safety heuristic and no explicit visible-body override was chosen.',
  };
}
