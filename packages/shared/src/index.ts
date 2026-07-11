export const appName = 'QA Browser Shell';

export const DEFAULT_RESPONSE_BODY_CAPTURE_LIMIT_BYTES = 262_144;

export type ResponseBodyCaptureMode = 'safe-default' | 'full-with-warning';

export type ProjectCapturePolicy = {
  captureRequestBodies: boolean;
  captureResponseBodies: boolean;
  responseBodyCaptureMode: ResponseBodyCaptureMode;
  responseBodySizeLimitBytes: number;
  sensitiveEndpointPatterns: string[];
};

export type ProjectSettings = {
  capturePolicy: ProjectCapturePolicy;
};

export function createDefaultProjectSettings(): ProjectSettings {
  return {
    capturePolicy: {
      captureRequestBodies: true,
      captureResponseBodies: true,
      responseBodyCaptureMode: 'safe-default',
      responseBodySizeLimitBytes: DEFAULT_RESPONSE_BODY_CAPTURE_LIMIT_BYTES,
      sensitiveEndpointPatterns: [],
    },
  };
}

const BUILTIN_SENSITIVE_ENDPOINT_PATTERN = /\/(auth|login|oauth|password|session|token)(?:[/?#]|$)/i;

export function isSensitiveEndpointUrl(
  targetUrl: string | undefined,
  patterns: string[] = [],
): boolean {
  if (!targetUrl) {
    return false;
  }

  if (BUILTIN_SENSITIVE_ENDPOINT_PATTERN.test(targetUrl)) {
    return true;
  }

  return patterns.some((pattern) => matchesEndpointPattern(targetUrl, pattern));
}

function matchesEndpointPattern(targetUrl: string, pattern: string): boolean {
  const normalized = pattern.trim();
  if (normalized.length === 0) {
    return false;
  }

  if (normalized.includes('*')) {
    const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(escaped, 'i').test(targetUrl);
  }

  return targetUrl.toLowerCase().includes(normalized.toLowerCase());
}
