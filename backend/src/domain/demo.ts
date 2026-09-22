import { createHmac } from 'node:crypto';
import type { UserRole } from './types.js';

/**
 * The demo workspace: three accounts in one organization, so a visitor can see
 * the same call from all three sides — the customer who made it, the support
 * agent it was handed to, and the admin who audits it.
 *
 * Passwords are derived from the API's own secret rather than stored or
 * shipped to the browser: the sign-in happens on the server, and rotating the
 * secret changes them all.
 */
export const DEMO_ORG_NAME = 'Northwind Mobile (demo)';

export interface DemoPersona {
  key: 'customer' | 'agent' | 'admin';
  role: UserRole;
  email: string;
  label: string;
  /** One line shown on the login page, so a judge knows what this persona is for. */
  blurb: string;
}

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    key: 'customer',
    role: 'customer',
    email: 'customer@demo.safecall.app',
    label: 'Customer',
    blurb: 'Call the AI agent about a bill, and see only your own calls.',
  },
  {
    key: 'agent',
    role: 'agent',
    email: 'agent@demo.safecall.app',
    label: 'Support agent',
    blurb: 'Pick up the calls the AI hands over, with the recording already redacted.',
  },
  {
    key: 'admin',
    role: 'admin',
    email: 'admin@demo.safecall.app',
    label: 'Admin',
    blurb: 'The whole workspace: archive, analytics, PII policies, audit trail and team.',
  },
];

export const findPersona = (key: unknown): DemoPersona | null =>
  DEMO_PERSONAS.find((persona) => persona.key === key) ?? null;

/** Deterministic, never stored, never sent to the browser. */
export function demoPassword(secret: string, email: string): string {
  return `Demo-${createHmac('sha256', secret).update(`safecall-demo:${email}`).digest('hex').slice(0, 24)}!1`;
}
