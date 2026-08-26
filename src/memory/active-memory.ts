import { EntityManager, IsNull } from 'typeorm';
import { MemoryEntryEntity, MemoryEntryType } from './memory-entry.entity';
import type { MemoryOwnerType } from './memory.service';

export const ACTIVE_MEMORY_SCHEMA = 'active-memory/1';
const MAX_CANDIDATES = 50;
const MAX_ACTIVE_ENTRIES = 8;
const MAX_ACTIVE_CHARS = 6_000;
const MAX_ENTRY_CHARS = 2_000;

export interface ActiveMemoryContext {
  schemaVersion: typeof ACTIVE_MEMORY_SCHEMA;
  owner: { type: MemoryOwnerType; id: number };
  policy: {
    selector: 'lexical-overlap/1';
    maximumCandidates: number;
    maximumActiveEntries: number;
    maximumActiveChars: number;
  };
  candidates: Array<{
    entryId: string;
    contentHash: string;
    type: MemoryEntryType;
    scoreBasisPoints: number;
    selected: boolean;
  }>;
  activeEntries: Array<{
    entryId: string;
    name: string;
    type: MemoryEntryType;
    body: string;
    contentHash: string;
    scoreBasisPoints: number;
    provenance: {
      sourceKind: string;
      executionId: string | null;
      turnId: string | null;
      messageId: number | null;
      artifactId: string | null;
      artifactRevision: number | null;
    };
    consent: {
      status: 'granted';
      basis: string;
      consentedAt: string;
    };
    dataPolicy: {
      classification: 'workspace';
      purpose: 'conversation_memory';
      allowedDestinations: string[];
    };
  }>;
}

interface ScoredMemory {
  entry: MemoryEntryEntity;
  scoreBasisPoints: number;
}

export async function buildActiveMemoryContext(
  manager: EntityManager,
  ownerType: MemoryOwnerType,
  ownerId: number,
  query: string,
): Promise<ActiveMemoryContext> {
  const entries = await manager.getRepository(MemoryEntryEntity).find({
    where:
      ownerType === 'assistant'
        ? { assistantId: ownerId, agentId: IsNull(), consentStatus: 'granted' }
        : { assistantId: IsNull(), agentId: ownerId, consentStatus: 'granted' },
    order: { updatedAt: 'DESC', id: 'ASC' },
    take: MAX_CANDIDATES,
  });
  const queryTokens = tokens(query);
  const scored = entries
    .map((entry) => ({
      entry,
      scoreBasisPoints: relevance(entry, queryTokens),
    }))
    .sort(compareScored);
  const active: ScoredMemory[] = [];
  let usedChars = 0;
  for (const candidate of scored) {
    if (candidate.scoreBasisPoints <= 0 || active.length >= MAX_ACTIVE_ENTRIES)
      break;
    const bodyLength = Math.min(candidate.entry.body.length, MAX_ENTRY_CHARS);
    if (usedChars + bodyLength > MAX_ACTIVE_CHARS) continue;
    active.push(candidate);
    usedChars += bodyLength;
  }
  const selectedIds = new Set(active.map(({ entry }) => entry.id));
  return {
    schemaVersion: ACTIVE_MEMORY_SCHEMA,
    owner: { type: ownerType, id: ownerId },
    policy: {
      selector: 'lexical-overlap/1',
      maximumCandidates: MAX_CANDIDATES,
      maximumActiveEntries: MAX_ACTIVE_ENTRIES,
      maximumActiveChars: MAX_ACTIVE_CHARS,
    },
    candidates: scored.map(({ entry, scoreBasisPoints }) => ({
      entryId: entry.id,
      contentHash: entry.contentHash,
      type: entry.type,
      scoreBasisPoints,
      selected: selectedIds.has(entry.id),
    })),
    activeEntries: active.map(({ entry, scoreBasisPoints }) => ({
      entryId: entry.id,
      name: entry.name,
      type: entry.type,
      body: clip(entry.body, MAX_ENTRY_CHARS),
      contentHash: entry.contentHash,
      scoreBasisPoints,
      provenance: {
        sourceKind: entry.sourceKind,
        executionId: entry.sourceExecutionId,
        turnId: entry.sourceTurnId,
        messageId: entry.sourceMessageId,
        artifactId: entry.sourceArtifactId,
        artifactRevision: entry.sourceArtifactRevision,
      },
      consent: {
        status: entry.consentStatus,
        basis: entry.consentBasis,
        consentedAt: entry.consentedAt.toISOString(),
      },
      dataPolicy: {
        classification: entry.dataClassification,
        purpose: entry.purpose,
        allowedDestinations: [...entry.allowedDestinations].sort(),
      },
    })),
  };
}

function relevance(entry: MemoryEntryEntity, queryTokens: Set<string>): number {
  const entryTokens = tokens(`${entry.name} ${entry.body}`);
  let matches = 0;
  for (const token of queryTokens) if (entryTokens.has(token)) matches += 1;
  const lexical = queryTokens.size
    ? Math.round((matches * 10_000) / queryTokens.size)
    : 0;
  const preferenceFloor = entry.type === 'preference' ? 250 : 0;
  return Math.max(lexical, preferenceFloor);
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3),
  );
}

function compareScored(a: ScoredMemory, b: ScoredMemory): number {
  return (
    b.scoreBasisPoints - a.scoreBasisPoints ||
    b.entry.updatedAt.getTime() - a.entry.updatedAt.getTime() ||
    a.entry.id.localeCompare(b.entry.id)
  );
}

function clip(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum - 24)}\n[...memory clipped...]`;
}
