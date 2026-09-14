import type { PiiCounts } from '../domain/types.js';
import { ASSEMBLYAI_PII_POLICIES } from './assemblyai/policies.js';

// With `redact_pii_sub: "entity_name"`, AssemblyAI replaces each detected
// entity with a marker such as `[PHONE_NUMBER]`. Only markers that match a
// known policy name are counted, so ordinary bracketed text is ignored.
const KNOWN_ENTITIES: ReadonlySet<string> = new Set(ASSEMBLYAI_PII_POLICIES.map((policy) => policy.toUpperCase()));
const MARKER_PATTERN = /\[([A-Z][A-Z0-9_]*)\]/g;
// AssemblyAI replaces PII word by word, so one address can come back as
// "[LOCATION_ADDRESS] [LOCATION_ADDRESS], [LOCATION_ADDRESS]". Markers of the
// same type separated only by spaces, commas or dashes belong to one entity.
const SAME_ENTITY_GAP = /^[\s,\-–]*$/;

/**
 * Counts PII entities in a redacted transcript from its redaction markers.
 * The result contains entity types and counts only — the underlying values
 * were never received.
 */
export function countPiiMarkers(redactedText: string | null | undefined): PiiCounts {
  const counts: PiiCounts = {};
  if (!redactedText) return counts;
  let previous: { entity: string; end: number } | null = null;
  for (const match of redactedText.matchAll(MARKER_PATTERN)) {
    const entity = match[1];
    const start = match.index ?? 0;
    if (!entity || !KNOWN_ENTITIES.has(entity)) {
      previous = null;
      continue;
    }
    const continuesEntity =
      previous !== null && previous.entity === entity && SAME_ENTITY_GAP.test(redactedText.slice(previous.end, start));
    if (!continuesEntity) counts[entity] = (counts[entity] ?? 0) + 1;
    previous = { entity, end: start + match[0].length };
  }
  return counts;
}

/** Number of individual redaction markers (words replaced), before grouping into entities. */
export function countRedactionMarkers(redactedText: string | null | undefined): number {
  if (!redactedText) return 0;
  let total = 0;
  for (const match of redactedText.matchAll(MARKER_PATTERN)) {
    if (match[1] && KNOWN_ENTITIES.has(match[1])) total += 1;
  }
  return total;
}

export function summarizePii(counts: PiiCounts): { total: number; types: string[] } {
  const types = Object.keys(counts)
    .filter((type) => (counts[type] ?? 0) > 0)
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || a.localeCompare(b));
  const total = types.reduce((sum, type) => sum + (counts[type] ?? 0), 0);
  return { total, types };
}

export function isKnownEntity(entity: string): boolean {
  return KNOWN_ENTITIES.has(entity);
}
