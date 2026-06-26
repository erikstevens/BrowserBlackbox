import { beforeEach, describe, expect, it } from 'vitest';
import type { BrowserRuntimeUpdate } from '@browser-blackbox/runtime-browser';
import {
  createInitialWorkspaceState,
  getSelectedRecordedStep,
  getRecordingUndoAvailability,
  useWorkspaceStore,
} from './index';

describe('workspace recording review state', () => {
  beforeEach(() => {
    useWorkspaceStore.setState(createInitialWorkspaceState());
  });

  it('boots with a seeded recording review session', () => {
    const state = useWorkspaceStore.getState();

    expect(state.recordingSession.present.steps).toHaveLength(4);
    expect(getSelectedRecordedStep(state.recordingSession)?.id).toBe('step-open-login');
    expect(getRecordingUndoAvailability(state.recordingSession)).toEqual({
      canUndo: false,
      canRedo: false,
    });
  });

  it('updates the selected step through the review store actions', () => {
    const state = useWorkspaceStore.getState();
    const selected = getSelectedRecordedStep(state.recordingSession);

    if (!selected) {
      throw new Error('expected a selected step');
    }

    state.replaceRecordedStepInReview(selected.id, {
      ...selected,
      title: 'Open login route',
      updatedAt: '2026-06-25T12:05:00.000Z',
    });

    const updatedSession = useWorkspaceStore.getState().recordingSession;

    expect(updatedSession.present.steps[0]?.title).toBe('Open login route');
    expect(updatedSession.present.steps.every((step) => step.evidenceState === 'stale')).toBe(true);
    expect(updatedSession.present.checkpoints[0]?.status).toBe('stale');
    expect(getRecordingUndoAvailability(updatedSession).canUndo).toBe(true);
  });

  it('supports insert, move, disable, undo, and redo from the workspace store', () => {
    const state = useWorkspaceStore.getState();

    state.selectRecordedStep('step-fill-email');
    state.insertStepAfterSelection('reload');

    let session = useWorkspaceStore.getState().recordingSession;
    const insertedStep = session.present.steps.find((step) => step.title === 'Reload current page');

    expect(insertedStep).toBeTruthy();

    if (!insertedStep) {
      throw new Error('expected inserted step');
    }

    useWorkspaceStore.getState().moveRecordedStep(insertedStep.id, 'down');
    useWorkspaceStore.getState().disableRecordedStepInReview(insertedStep.id);

    session = useWorkspaceStore.getState().recordingSession;
    expect(session.present.steps.find((step) => step.id === insertedStep.id)?.status).toBe('disabled');

    useWorkspaceStore.getState().undoRecordingEdit();
    expect(
      useWorkspaceStore.getState().recordingSession.present.steps.find(
        (step) => step.id === insertedStep.id,
      )?.status,
    ).toBe('active');

    useWorkspaceStore.getState().redoRecordingEdit();
    expect(
      useWorkspaceStore.getState().recordingSession.present.steps.find(
        (step) => step.id === insertedStep.id,
      )?.status,
    ).toBe('disabled');
  });

  it('replaces the seeded review flow with live captured steps', () => {
    const state = useWorkspaceStore.getState();
    state.beginRuntimeCapture('https://example.test/login', 'session-live-001');

    const update: BrowserRuntimeUpdate = {
      state: {
        phase: 'running',
        targetUrl: 'https://example.test/login',
        pageUrl: 'https://example.test/login',
        sessionId: 'session-live-001',
        playwrightAttached: true,
        cdpAttached: true,
        lastError: null,
      },
      health: {
        status: 'healthy',
        lastEventAt: '2026-06-25T12:10:00.000Z',
        lastError: null,
        recentEventCount: 1,
        subscriberCount: 1,
      },
      event: {
        id: 'capture-001',
        timestamp: '2026-06-25T12:10:00.000Z',
        category: 'replay',
        code: 'recording.step.captured',
        level: 'info',
        message: 'Click Sign in',
        source: 'electron_shell',
        data: {
          capturedAt: '2026-06-25T12:10:00.000Z',
          capture: {
            kind: 'click',
            title: 'Click Sign in',
            selector: 'page.getByRole("button", { name: "Sign in" })',
            previousCaptureEventId: null,
          },
        },
      },
    };

    state.pushRuntimeUpdate(update);

    const session = useWorkspaceStore.getState().recordingSession;
    expect(session.present.steps).toHaveLength(1);
    expect(session.present.steps[0]?.title).toBe('Click Sign in');
    expect(session.present.steps[0]?.kind).toBe('action');
  });

  it('creates a metadata-only checkpoint after a captured navigation step', () => {
    const state = useWorkspaceStore.getState();
    state.beginRuntimeCapture('https://example.test/login', 'session-live-001');

    state.pushRuntimeUpdate({
      state: {
        phase: 'running',
        targetUrl: 'https://example.test/login',
        pageUrl: 'https://example.test/login',
        sessionId: 'session-live-001',
        playwrightAttached: true,
        cdpAttached: true,
        lastError: null,
      },
      health: {
        status: 'healthy',
        lastEventAt: '2026-06-25T12:10:00.000Z',
        lastError: null,
        recentEventCount: 1,
        subscriberCount: 1,
      },
      event: {
        id: 'capture-nav-001',
        timestamp: '2026-06-25T12:10:00.000Z',
        category: 'replay',
        code: 'recording.step.captured',
        level: 'info',
        message: 'Navigate to login',
        source: 'electron_shell',
        data: {
          capturedAt: '2026-06-25T12:10:00.000Z',
          capture: {
            kind: 'navigate',
            title: 'Navigate to login',
            url: 'https://example.test/login',
            previousCaptureEventId: null,
          },
        },
      },
    });

    const session = useWorkspaceStore.getState().recordingSession;
    expect(session.present.checkpoints).toHaveLength(1);
    expect(session.present.checkpoints[0]).toMatchObject({
      kind: 'step-boundary',
      stepId: 'step-captured-capture-nav-001',
      status: 'valid',
      snapshot: undefined,
    });
  });

  it('exports and rehydrates the working copy snapshot', () => {
    const state = useWorkspaceStore.getState();
    state.beginRuntimeCapture('https://example.test/login', 'session-live-001');
    state.pushRuntimeUpdate({
      state: {
        phase: 'running',
        targetUrl: 'https://example.test/login',
        pageUrl: 'https://example.test/login',
        sessionId: 'session-live-001',
        playwrightAttached: true,
        cdpAttached: true,
        lastError: null,
      },
      health: {
        status: 'healthy',
        lastEventAt: '2026-06-25T12:11:00.000Z',
        lastError: null,
        recentEventCount: 1,
        subscriberCount: 1,
      },
      event: {
        id: 'capture-002',
        timestamp: '2026-06-25T12:11:00.000Z',
        category: 'replay',
        code: 'recording.step.captured',
        level: 'info',
        message: 'Fill Email',
        source: 'electron_shell',
        data: {
          capturedAt: '2026-06-25T12:11:00.000Z',
          capture: {
            kind: 'fill',
            title: 'Fill Email',
            selector: 'page.getByLabel("Email")',
            value: 'qa@example.test',
            sensitive: false,
            previousCaptureEventId: null,
          },
        },
      },
    });

    const snapshot = useWorkspaceStore.getState().exportWorkingCopySnapshot();

    useWorkspaceStore.setState(createInitialWorkspaceState());
    useWorkspaceStore.getState().hydrateWorkingCopySnapshot(snapshot);

    const hydrated = useWorkspaceStore.getState();
    expect(hydrated.targetUrl).toBe('https://example.test/login');
    expect(hydrated.recordingSession.present.steps).toHaveLength(1);
    expect(hydrated.recordingSession.present.steps[0]?.title).toBe('Fill Email');
    expect(hydrated.captures).toHaveLength(0);
    expect(hydrated.timeline).toHaveLength(1);
  });

  it('derives request captures, timeline events, and diagnosis from runtime events', () => {
    const state = useWorkspaceStore.getState();
    state.beginRuntimeCapture('https://example.test/login', 'session-live-001');

    state.pushRuntimeUpdate({
      state: {
        phase: 'running',
        targetUrl: 'https://example.test/login',
        pageUrl: 'https://example.test/login',
        sessionId: 'session-live-001',
        playwrightAttached: true,
        cdpAttached: true,
        lastError: null,
      },
      health: {
        status: 'healthy',
        lastEventAt: '2026-06-25T12:12:00.000Z',
        lastError: null,
        recentEventCount: 1,
        subscriberCount: 1,
      },
      event: {
        id: 'capture-click-003',
        timestamp: '2026-06-25T12:12:00.000Z',
        category: 'replay',
        code: 'recording.step.captured',
        level: 'info',
        message: 'Click Sign in',
        source: 'electron_shell',
        data: {
          capturedAt: '2026-06-25T12:12:00.000Z',
          capture: {
            kind: 'click',
            title: 'Click Sign in',
            selector: 'page.getByRole("button", { name: "Sign in" })',
            previousCaptureEventId: null,
          },
        },
      },
    });
    state.pushRuntimeUpdate({
      state: {
        phase: 'running',
        targetUrl: 'https://example.test/login',
        pageUrl: 'https://example.test/login',
        sessionId: 'session-live-001',
        playwrightAttached: true,
        cdpAttached: true,
        lastError: null,
      },
      health: {
        status: 'healthy',
        lastEventAt: '2026-06-25T12:12:01.000Z',
        lastError: null,
        recentEventCount: 2,
        subscriberCount: 1,
      },
      event: {
        id: 'network-start-001',
        timestamp: '2026-06-25T12:12:01.000Z',
        category: 'network',
        code: 'network.request.started',
        level: 'info',
        message: 'POST https://example.test/api/login',
        source: 'cdp',
        data: {
          body: {
            state: 'redacted',
            contentType: 'application/json',
            text: '{"password":"[REDACTED]"}',
            redactionRuleIds: ['rule-password'],
          },
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'req-123',
          },
          method: 'POST',
          requestId: 'request-001',
          url: 'https://example.test/api/login',
        },
      },
    });
    state.pushRuntimeUpdate({
      state: {
        phase: 'running',
        targetUrl: 'https://example.test/login',
        pageUrl: 'https://example.test/login',
        sessionId: 'session-live-001',
        playwrightAttached: true,
        cdpAttached: true,
        lastError: null,
      },
      health: {
        status: 'degraded',
        lastEventAt: '2026-06-25T12:12:02.000Z',
        lastError: 'net::ERR_CONNECTION_REFUSED',
        recentEventCount: 3,
        subscriberCount: 1,
      },
      event: {
        id: 'network-fail-001',
        timestamp: '2026-06-25T12:12:02.000Z',
        category: 'network',
        code: 'network.request.failed',
        level: 'error',
        message: 'Network loading failed for https://example.test/api/login.',
        source: 'cdp',
        detail: 'net::ERR_CONNECTION_REFUSED',
        data: {
          errorText: 'net::ERR_CONNECTION_REFUSED',
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'req-123',
          },
          method: 'POST',
          requestId: 'request-001',
          url: 'https://example.test/api/login',
        },
      },
    });

    const evidence = useWorkspaceStore.getState();
    expect(evidence.captures).toHaveLength(1);
    expect(evidence.captures[0]).toMatchObject({
      id: 'request-001',
      triggeringStepId: 'step-captured-capture-click-003',
      request: {
        body: {
          state: 'redacted',
          text: '{"password":"[REDACTED]"}',
        },
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-123',
        },
        method: 'POST',
        url: 'https://example.test/api/login',
      },
      failure: {
        code: 'network.request.failed',
      },
    });
    expect(evidence.timeline.map((event) => event.kind)).toEqual(['user-action', 'request']);
    expect(evidence.diagnosis?.findings[0]?.ruleId).toBe(
      'navigation_blocked_by_request_failure',
    );
  });

  it('persists enriched response metadata into the evidence ledger', () => {
    const state = useWorkspaceStore.getState();
    state.beginRuntimeCapture('https://example.test/login', 'session-live-001');

    state.pushRuntimeUpdate({
      state: {
        phase: 'running',
        targetUrl: 'https://example.test/login',
        pageUrl: 'https://example.test/login',
        sessionId: 'session-live-001',
        playwrightAttached: true,
        cdpAttached: true,
        lastError: null,
      },
      health: {
        status: 'healthy',
        lastEventAt: '2026-06-25T12:15:00.000Z',
        lastError: null,
        recentEventCount: 1,
        subscriberCount: 1,
      },
      event: {
        id: 'network-start-002',
        timestamp: '2026-06-25T12:15:00.000Z',
        category: 'network',
        code: 'network.request.started',
        level: 'info',
        message: 'GET https://example.test/api/profile',
        source: 'cdp',
        data: {
          headers: {
            accept: 'application/json',
          },
          method: 'GET',
          requestId: 'request-002',
          url: 'https://example.test/api/profile',
        },
      },
    });
    state.pushRuntimeUpdate({
      state: {
        phase: 'running',
        targetUrl: 'https://example.test/login',
        pageUrl: 'https://example.test/login',
        sessionId: 'session-live-001',
        playwrightAttached: true,
        cdpAttached: true,
        lastError: null,
      },
      health: {
        status: 'healthy',
        lastEventAt: '2026-06-25T12:15:01.000Z',
        lastError: null,
        recentEventCount: 2,
        subscriberCount: 1,
      },
      event: {
        id: 'network-response-002',
        timestamp: '2026-06-25T12:15:01.000Z',
        category: 'network',
        code: 'network.response.received',
        level: 'info',
        message: 'Response 200 from https://example.test/api/profile',
        source: 'cdp',
        data: {
          correlationIds: ['x-request-id:req-456'],
          durationMs: 48,
          fromCache: true,
          fromServiceWorker: false,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'req-456',
          },
          responseBody: {
            state: 'full',
            contentType: 'application/json',
            text: '{"id":"user-1","name":"QA"}',
          },
          method: 'GET',
          protocol: 'h2',
          requestId: 'request-002',
          status: 200,
          timings: {
            dnsMs: 5,
            connectMs: 7,
            requestMs: 8,
            responseMs: 28,
          },
          url: 'https://example.test/api/profile',
        },
      },
    });

    expect(useWorkspaceStore.getState().captures[0]).toMatchObject({
      correlationIds: ['x-request-id:req-456'],
      durationMs: 48,
      origin: {
        fromCache: true,
        fromServiceWorker: false,
      },
      response: {
        body: {
          state: 'full',
          text: '{"id":"user-1","name":"QA"}',
        },
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-456',
        },
      },
      timings: {
        dnsMs: 5,
        connectMs: 7,
        requestMs: 8,
        responseMs: 28,
      },
    });
  });

  it('derives failed-assertion diagnosis from blocking request and console evidence', () => {
    const state = useWorkspaceStore.getState();
    state.beginRuntimeCapture('https://example.test/login', 'session-live-001');

    state.pushRuntimeUpdate({
      state: {
        phase: 'running',
        targetUrl: 'https://example.test/login',
        pageUrl: 'https://example.test/login',
        sessionId: 'session-live-001',
        playwrightAttached: true,
        cdpAttached: true,
        lastError: null,
      },
      health: {
        status: 'healthy',
        lastEventAt: '2026-06-25T12:20:00.000Z',
        lastError: null,
        recentEventCount: 1,
        subscriberCount: 1,
      },
      event: {
        id: 'network-start-003',
        timestamp: '2026-06-25T12:20:00.000Z',
        category: 'network',
        code: 'network.request.started',
        level: 'info',
        message: 'POST https://example.test/api/login',
        source: 'cdp',
        data: {
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
          requestId: 'request-003',
          url: 'https://example.test/api/login',
        },
      },
    });
    state.pushRuntimeUpdate({
      state: {
        phase: 'running',
        targetUrl: 'https://example.test/login',
        pageUrl: 'https://example.test/login',
        sessionId: 'session-live-001',
        playwrightAttached: true,
        cdpAttached: true,
        lastError: null,
      },
      health: {
        status: 'degraded',
        lastEventAt: '2026-06-25T12:20:01.000Z',
        lastError: '500 Internal Server Error',
        recentEventCount: 2,
        subscriberCount: 1,
      },
      event: {
        id: 'network-response-003',
        timestamp: '2026-06-25T12:20:01.000Z',
        category: 'network',
        code: 'network.response.received',
        level: 'info',
        message: 'Response 500 from https://example.test/api/login',
        source: 'cdp',
        data: {
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
          requestId: 'request-003',
          status: 500,
          url: 'https://example.test/api/login',
        },
      },
    });
    state.pushRuntimeUpdate({
      state: {
        phase: 'running',
        targetUrl: 'https://example.test/login',
        pageUrl: 'https://example.test/login',
        sessionId: 'session-live-001',
        playwrightAttached: true,
        cdpAttached: true,
        lastError: 'ReferenceError: loginFailed is not defined',
      },
      health: {
        status: 'error',
        lastEventAt: '2026-06-25T12:20:02.000Z',
        lastError: 'ReferenceError: loginFailed is not defined',
        recentEventCount: 3,
        subscriberCount: 1,
      },
      event: {
        id: 'console-error-003',
        timestamp: '2026-06-25T12:20:02.000Z',
        category: 'console',
        code: 'console.message',
        level: 'error',
        message: 'ReferenceError: loginFailed is not defined',
        source: 'electron_shell',
      },
    });
    state.pushRuntimeUpdate({
      state: {
        phase: 'running',
        targetUrl: 'https://example.test/login',
        pageUrl: 'https://example.test/login',
        sessionId: 'session-live-001',
        playwrightAttached: true,
        cdpAttached: true,
        lastError: 'waitFor heading timed out',
      },
      health: {
        status: 'error',
        lastEventAt: '2026-06-25T12:20:03.000Z',
        lastError: 'waitFor heading timed out',
        recentEventCount: 4,
        subscriberCount: 1,
      },
      event: {
        id: 'assertion-failed-003',
        timestamp: '2026-06-25T12:20:03.000Z',
        category: 'replay',
        code: 'replay.assertion.failed',
        level: 'error',
        message: 'Replay failed at Assert dashboard heading.',
        source: 'runtime_manager',
        detail: 'waitFor heading timed out',
        data: {
          assertionKind: 'element-visible',
          stepId: 'step-assert-dashboard',
          stepKind: 'assertion',
        },
      },
    });

    const evidence = useWorkspaceStore.getState();
    expect(evidence.timeline.map((event) => event.kind)).toEqual([
      'request',
      'exception',
      'assertion',
      'timeout',
    ]);
    expect(evidence.diagnosis?.findings.map((finding) => finding.ruleId)).toEqual([
      'assertion_blocked_by_failed_request',
      'assertion_blocked_by_console_error',
    ]);
  });

  it('derives popup-missing diagnosis from failed wait-for-popup replay steps', () => {
    const state = useWorkspaceStore.getState();
    state.beginRuntimeCapture('https://example.test/login', 'session-live-001');

    state.pushRuntimeUpdate({
      state: {
        phase: 'running',
        targetUrl: 'https://example.test/login',
        pageUrl: 'https://example.test/login',
        sessionId: 'session-live-001',
        playwrightAttached: true,
        cdpAttached: true,
        lastError: 'popup timed out',
      },
      health: {
        status: 'error',
        lastEventAt: '2026-06-25T12:21:00.000Z',
        lastError: 'popup timed out',
        recentEventCount: 1,
        subscriberCount: 1,
      },
      event: {
        id: 'popup-failed-001',
        timestamp: '2026-06-25T12:21:00.000Z',
        category: 'replay',
        code: 'replay.step.failed',
        level: 'error',
        message: 'Replay failed at Wait for popup.',
        source: 'runtime_manager',
        detail: 'popup timed out',
        data: {
          actionType: 'wait-for-popup',
          stepId: 'step-wait-popup',
          stepKind: 'action',
        },
      },
    });

    expect(useWorkspaceStore.getState().diagnosis?.findings[0]).toMatchObject({
      ruleId: 'popup_missing_without_trigger',
      confidence: 'low',
    });
  });

  it('builds a replay plan for the selected step and marks replayed evidence pending', () => {
    const state = useWorkspaceStore.getState();

    state.replaceRecordedStepInReview('step-fill-email', {
      ...useWorkspaceStore.getState().recordingSession.present.steps[1]!,
      title: 'Fill primary email',
      updatedAt: '2026-06-25T12:12:00.000Z',
    });
    useWorkspaceStore.getState().selectRecordedStep('step-assert-dashboard');
    useWorkspaceStore.getState().previewReplayToSelectedStep();

    const planned = useWorkspaceStore.getState();
    expect(planned.replayPlan?.startStrategy).toBe('start');
    expect(planned.replayPlan?.targetStepId).toBe('step-assert-dashboard');

    useWorkspaceStore.getState().prepareReplayExecution();

    expect(useWorkspaceStore.getState().recordingSession.present.steps.map((step) => step.evidenceState)).toEqual([
      'current',
      'pending-regeneration',
      'pending-regeneration',
      'pending-regeneration',
    ]);
  });

  it('marks replayed evidence current again after replay completes', () => {
    const state = useWorkspaceStore.getState();

    state.replaceRecordedStepInReview('step-fill-email', {
      ...useWorkspaceStore.getState().recordingSession.present.steps[1]!,
      title: 'Fill primary email',
      updatedAt: '2026-06-25T12:12:00.000Z',
    });
    useWorkspaceStore.getState().selectRecordedStep('step-assert-dashboard');
    useWorkspaceStore.getState().previewReplayToSelectedStep();
    useWorkspaceStore.getState().prepareReplayExecution();
    useWorkspaceStore.getState().completeReplayExecution([
      'step-open-login',
      'step-fill-email',
      'step-submit-login',
      'step-assert-dashboard',
    ]);

    const session = useWorkspaceStore.getState().recordingSession;
    expect(session.present.steps.map((step) => step.evidenceState)).toEqual([
      'current',
      'current',
      'current',
      'current',
    ]);
    expect(session.present.checkpoints[0]?.status).toBe('valid');
    expect(useWorkspaceStore.getState().replayPlan).toBeNull();
  });

  it('reuses a valid checkpoint when replaying to a later selected step', () => {
    const state = useWorkspaceStore.getState();
    state.selectRecordedStep('step-assert-dashboard');
    state.previewReplayToSelectedStep();

    expect(useWorkspaceStore.getState().replayPlan).toMatchObject({
      startStrategy: 'checkpoint',
      checkpointId: 'checkpoint-post-login-review',
      targetStepId: 'step-assert-dashboard',
    });
  });

  it('falls back to start when a checkpoint is valid but has no snapshot payload', () => {
    const state = useWorkspaceStore.getState();
    const checkpoint = state.recordingSession.present.checkpoints[0];

    if (!checkpoint) {
      throw new Error('expected a checkpoint');
    }

    state.hydrateWorkingCopySnapshot({
      ...state.exportWorkingCopySnapshot(),
      checkpoints: [
        {
          ...checkpoint,
          snapshot: undefined,
        },
      ],
    });
    useWorkspaceStore.getState().selectRecordedStep('step-assert-dashboard');
    useWorkspaceStore.getState().previewReplayToSelectedStep();

    expect(useWorkspaceStore.getState().replayPlan).toMatchObject({
      startStrategy: 'start',
      checkpointId: null,
    });
  });
});
