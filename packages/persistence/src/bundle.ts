import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import {
  ARTIFACT_FORMAT_VERSION,
  DomainValidationError,
  parseArtifactManifest,
} from '@browser-blackbox/domain';
import type {
  ArtifactBundleReadResult,
  ArtifactBundleWriteInput,
  ArtifactCompatibilityAssessment,
} from './contracts';
import {
  deserializeSnapshotEnvelope,
  parseStoredRunSnapshot,
  serializeSnapshotEnvelope,
} from './serialization';

const SNAPSHOT_FILE_NAME = 'snapshot.json';
const MANIFEST_FILE_NAME = 'manifest.json';

export async function writeArtifactBundle(input: ArtifactBundleWriteInput): Promise<void> {
  const snapshot = parseStoredRunSnapshot(input.snapshot);
  const manifest = snapshot.manifest;
  const artifactContents = input.artifactContents ?? {};

  await mkdir(input.rootDirectory, { recursive: true });
  await writeBundleFile(
    input.rootDirectory,
    MANIFEST_FILE_NAME,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeBundleFile(
    input.rootDirectory,
    SNAPSHOT_FILE_NAME,
    `${serializeSnapshotEnvelope(snapshot)}\n`,
  );

  for (const artifact of manifest.artifacts) {
    const content = artifactContents[artifact.path];

    if (artifact.present) {
      if (content === undefined) {
        throw new DomainValidationError('ArtifactBundle', [
          `present artifact ${artifact.path} is missing file content`,
        ]);
      }

      await writeBundleFile(input.rootDirectory, artifact.path, content);
      continue;
    }

    if (artifact.required) {
      throw new DomainValidationError('ArtifactBundle', [
        `required artifact ${artifact.path} cannot be marked missing`,
      ]);
    }
  }
}

export async function readArtifactBundle(rootDirectory: string): Promise<ArtifactBundleReadResult> {
  const manifest = parseArtifactManifest(
    JSON.parse(await readBundleFile(rootDirectory, MANIFEST_FILE_NAME)),
  );
  const compatibility = assessArtifactManifestCompatibility(manifest);

  if (!compatibility.ok) {
    throw new DomainValidationError('ArtifactBundle', [
      `unsupported artifact format version ${compatibility.manifestVersion}`,
    ]);
  }

  const envelope = deserializeSnapshotEnvelope(
    await readBundleFile(rootDirectory, SNAPSHOT_FILE_NAME),
  );
  const snapshot = parseStoredRunSnapshot(envelope.snapshot);

  if (snapshot.manifest.runId !== manifest.runId) {
    throw new DomainValidationError('ArtifactBundle', [
      'snapshot manifest runId does not match bundle manifest runId',
    ]);
  }

  const missingOptionalArtifacts: string[] = [];

  for (const artifact of manifest.artifacts) {
    const exists = await bundlePathExists(rootDirectory, artifact.path);

    if (artifact.required && artifact.present && !exists) {
      throw new DomainValidationError('ArtifactBundle', [
        `required artifact file is missing: ${artifact.path}`,
      ]);
    }

    if (!artifact.required && !exists) {
      missingOptionalArtifacts.push(artifact.path);
    }
  }

  return {
    manifest,
    snapshot,
    missingOptionalArtifacts,
  };
}

export function assessArtifactManifestCompatibility(
  manifest: ReturnType<typeof parseArtifactManifest>,
  currentArtifactFormatVersion: string = ARTIFACT_FORMAT_VERSION,
): ArtifactCompatibilityAssessment {
  const supportedMajorVersions = getSupportedArtifactMajorVersions(currentArtifactFormatVersion);
  const manifestMajor = getSemanticVersionMajor(manifest.artifactFormatVersion);

  if (!supportedMajorVersions.includes(manifestMajor)) {
    return {
      ok: false,
      reason: 'unsupported-version',
      manifestVersion: manifest.artifactFormatVersion,
      supportedMajorVersions,
    };
  }

  return {
    ok: true,
    supportedMajorVersions,
  };
}

export function getSupportedArtifactMajorVersions(version: string): number[] {
  const currentMajor = getSemanticVersionMajor(version);
  return currentMajor > 1 ? [currentMajor - 1, currentMajor] : [currentMajor];
}

function getSemanticVersionMajor(version: string): number {
  const match = /^(\d+)\.\d+\.\d+$/.exec(version);

  if (!match) {
    throw new DomainValidationError('ArtifactBundle', [`invalid semantic version: ${version}`]);
  }

  return Number(match[1]);
}

async function readBundleFile(rootDirectory: string, relativePath: string): Promise<string> {
  return readFile(resolveBundlePath(rootDirectory, relativePath), 'utf8');
}

async function writeBundleFile(
  rootDirectory: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = resolveBundlePath(rootDirectory, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

async function bundlePathExists(rootDirectory: string, relativePath: string): Promise<boolean> {
  try {
    await stat(resolveBundlePath(rootDirectory, relativePath));
    return true;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function resolveBundlePath(rootDirectory: string, relativePath: string): string {
  const absoluteRoot = resolve(rootDirectory);
  const candidate = normalize(join(absoluteRoot, relativePath));

  if (!candidate.startsWith(absoluteRoot)) {
    throw new DomainValidationError('ArtifactBundle', [
      `artifact path escapes bundle root: ${relativePath}`,
    ]);
  }

  return candidate;
}
