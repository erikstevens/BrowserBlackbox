import { describe, expect, it } from 'vitest';
import {
  artifactManifestFixture,
  assertionFixture,
  checkpointFixture,
  deterministicSerialize,
  diagnosisResultFixture,
  DomainValidationError,
  domainVersions,
  inspectionMetadataFixture,
  invalidateCheckpoint,
  parseArtifactManifest,
  parseAssertion,
  parseCheckpoint,
  parseDiagnosisResult,
  parseInspectionMetadata,
  parseRecordedStep,
  parseRedactionRule,
  parseRequestResponseCapture,
  parseSelectorCandidate,
  parseSimulationRule,
  parseTimelineEvent,
  productSummary,
  recordedStepFixture,
  redactionRuleFixture,
  requestResponseCaptureFixture,
  selectorCandidateFixture,
  simulationRuleFixture,
  timelineEventFixture,
  transitionEvidenceState,
} from './index';

describe('productSummary', () => {
  it('keeps Playwright export central to the product promise', () => {
    expect(productSummary).toContain('Playwright');
  });
});

describe('domain parsing', () => {
  it('accepts the canonical phase 1 fixtures', () => {
    expect(parseSelectorCandidate(selectorCandidateFixture)).toEqual(selectorCandidateFixture);
    expect(parseAssertion(assertionFixture)).toEqual(assertionFixture);
    expect(parseRecordedStep(recordedStepFixture)).toEqual(recordedStepFixture);
    expect(parseInspectionMetadata(inspectionMetadataFixture)).toEqual(
      inspectionMetadataFixture,
    );
    expect(parseRequestResponseCapture(requestResponseCaptureFixture)).toEqual(
      requestResponseCaptureFixture,
    );
    expect(parseRedactionRule(redactionRuleFixture)).toEqual(redactionRuleFixture);
    expect(parseSimulationRule(simulationRuleFixture)).toEqual(simulationRuleFixture);
    expect(parseTimelineEvent(timelineEventFixture)).toEqual(timelineEventFixture);
    expect(parseDiagnosisResult(diagnosisResultFixture)).toEqual(diagnosisResultFixture);
    expect(parseCheckpoint(checkpointFixture)).toEqual(checkpointFixture);
    expect(parseArtifactManifest(artifactManifestFixture)).toEqual(artifactManifestFixture);
  });

  it('rejects invalid boundary data', () => {
    expect(() =>
      parseSelectorCandidate({
        ...selectorCandidateFixture,
        stabilityScore: 120,
      }),
    ).toThrow(DomainValidationError);

    expect(() =>
      parseRecordedStep({
        ...recordedStepFixture,
        action: {
          type: 'navigate',
        },
      }),
    ).toThrow('action.url must be a non-empty string');

    expect(() =>
      parseSimulationRule({
        ...simulationRuleFixture,
        match: {},
      }),
    ).toThrow('match must define at least one routePattern, domain, method, or flowContext');

    expect(() =>
      parseCheckpoint({
        ...checkpointFixture,
        status: 'stale',
        invalidationReasons: [],
      }),
    ).toThrow('stale checkpoints must include at least one invalidation reason');

    expect(() =>
      parseArtifactManifest({
        ...artifactManifestFixture,
        artifactFormatVersion: '2.0.0',
      }),
    ).toThrow(`artifactFormatVersion must equal ${domainVersions.artifactFormatVersion}`);
  });
});

describe('deterministic serialization', () => {
  it('sorts object keys recursively', () => {
    const left = {
      z: 1,
      nested: {
        b: true,
        a: false,
      },
      array: [{ y: 2, x: 1 }],
    };

    const right = {
      array: [{ x: 1, y: 2 }],
      nested: {
        a: false,
        b: true,
      },
      z: 1,
    };

    expect(deterministicSerialize(left)).toBe(deterministicSerialize(right));
  });
});

describe('domain state transitions', () => {
  it('allows only explicit evidence freshness transitions', () => {
    expect(transitionEvidenceState('current', 'stale')).toBe('stale');
    expect(transitionEvidenceState('stale', 'pending-regeneration')).toBe(
      'pending-regeneration',
    );
    expect(transitionEvidenceState('pending-regeneration', 'current')).toBe('current');
    expect(() => transitionEvidenceState('current', 'current')).toThrow(
      'cannot transition evidence state from current to current',
    );
  });

  it('marks checkpoints stale with preserved reasons', () => {
    const staleCheckpoint = invalidateCheckpoint(
      checkpointFixture,
      'Authentication input changed before checkpoint.',
    );

    expect(staleCheckpoint.status).toBe('stale');
    expect(staleCheckpoint.invalidationReasons).toEqual([
      'Authentication input changed before checkpoint.',
    ]);
  });
});
