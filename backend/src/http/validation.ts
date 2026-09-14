import { z } from 'zod';
import type { CallFilters } from '../db/types.js';
import { CALL_STATUSES, SENTIMENTS } from '../domain/types.js';
import { badRequest, notFound } from '../errors.js';

const UUID = z.uuid();

/** Invalid IDs are reported as "not found" so the API does not reveal ID formats. */
export function parseId(value: unknown): string {
  const result = UUID.safeParse(value);
  if (!result.success) throw notFound('Call not found.');
  return result.data;
}

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const CallQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(CALL_STATUSES).optional(),
  department: z.string().trim().max(60).optional(),
  sentiment: z.enum(SENTIMENTS).optional(),
  pii_type: z.string().regex(/^[A-Z][A-Z0-9_]{1,40}$/).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type CallQuery = z.infer<typeof CallQuerySchema>;

/** Parses query/body input; empty strings are treated as "not provided". */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const cleaned =
    input && typeof input === 'object'
      ? Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([, v]) => v !== '' && v !== undefined))
      : input;
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || 'input'))];
    throw badRequest(`Invalid value for: ${fields.join(', ')}.`, { fields });
  }
  return result.data;
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export function toCallFilters(query: CallQuery): CallFilters {
  return {
    status: query.status,
    department: query.department,
    sentiment: query.sentiment,
    piiType: query.pii_type,
    from: query.from ? `${query.from}T00:00:00.000Z` : undefined,
    to: query.to ? nextDay(query.to) : undefined,
    limit: query.page_size,
    offset: (query.page - 1) * query.page_size,
  };
}
