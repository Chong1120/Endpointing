import type { PolicyPreset } from '../../domain/types.js';

/**
 * PII policy names accepted by AssemblyAI's `redact_pii_policies`.
 * Verified against https://www.assemblyai.com/docs/guardrails/redact-pii-from-transcripts
 * (PII policies table) on 2026-09-14. Re-check the docs before adding names.
 */
export const ASSEMBLYAI_PII_POLICIES = [
  'account_number',
  'banking_information',
  'blood_type',
  'credit_card_cvv',
  'credit_card_expiration',
  'credit_card_number',
  'date',
  'date_interval',
  'date_of_birth',
  'drivers_license',
  'drug',
  'duration',
  'email_address',
  'event',
  'filename',
  'gender_sexuality',
  'healthcare_number',
  'injury',
  'ip_address',
  'language',
  'location',
  'location_address',
  'location_address_street',
  'location_city',
  'location_coordinate',
  'location_country',
  'location_state',
  'location_zip',
  'marital_status',
  'medical_condition',
  'medical_process',
  'money_amount',
  'nationality',
  'number_sequence',
  'occupation',
  'organization',
  'passport_number',
  'password',
  'person_age',
  'person_name',
  'phone_number',
  'physical_attribute',
  'political_affiliation',
  'religion',
  'statistics',
  'time',
  'url',
  'us_social_security_number',
  'username',
  'vehicle_id',
  'zodiac_sign',
] as const;

export type PiiPolicyName = (typeof ASSEMBLYAI_PII_POLICIES)[number];

const POLICY_SET: ReadonlySet<string> = new Set(ASSEMBLYAI_PII_POLICIES);

export function isPiiPolicy(value: string): value is PiiPolicyName {
  return POLICY_SET.has(value);
}

/** UI grouping for the policy editor. */
export const POLICY_CATEGORIES: Record<string, PiiPolicyName[]> = {
  Identity: ['person_name', 'date_of_birth', 'person_age', 'gender_sexuality', 'marital_status', 'nationality',
    'physical_attribute', 'political_affiliation', 'religion', 'occupation', 'language', 'zodiac_sign'],
  Contact: ['phone_number', 'email_address', 'username', 'url', 'ip_address'],
  Location: ['location_address', 'location_address_street', 'location_zip', 'location_city', 'location_state',
    'location_country', 'location_coordinate', 'location'],
  Financial: ['credit_card_number', 'credit_card_cvv', 'credit_card_expiration', 'account_number',
    'banking_information', 'money_amount'],
  'Government IDs': ['us_social_security_number', 'drivers_license', 'passport_number', 'vehicle_id'],
  Security: ['password'],
  Health: ['healthcare_number', 'medical_condition', 'medical_process', 'drug', 'injury', 'blood_type', 'statistics'],
  Other: ['organization', 'event', 'filename', 'date', 'date_interval', 'duration', 'time', 'number_sequence'],
};

// Core identifiers every preset protects.
const CORE: PiiPolicyName[] = [
  'person_name',
  'phone_number',
  'email_address',
  'location_address',
  'location_address_street',
  'location_zip',
  'date_of_birth',
  'password',
  'us_social_security_number',
];

const PAYMENT: PiiPolicyName[] = [
  'credit_card_number',
  'credit_card_cvv',
  'credit_card_expiration',
  'account_number',
  'banking_information',
];

export interface PresetDefinition {
  preset: PolicyPreset;
  label: string;
  description: string;
  policies: PiiPolicyName[];
}

// `number_sequence` is included as extra coverage for numeric identifiers that
// don't fit a specific policy. It is not a guarantee: in testing, the spoken
// "the security code is 123" was caught by neither credit_card_cvv nor
// number_sequence (see README → Limitations).
export const PRESET_DEFINITIONS: Record<PolicyPreset, PresetDefinition> = {
  CONTACT_CENTER: {
    preset: 'CONTACT_CENTER',
    label: 'Contact Center',
    description:
      'General customer-support calls: identity, contact details, addresses, payment cards, account and banking details, credentials, healthcare IDs and other numeric identifiers.',
    policies: unique([...CORE, ...PAYMENT, 'healthcare_number', 'drivers_license', 'passport_number', 'number_sequence']),
  },
  FINANCIAL: {
    preset: 'FINANCIAL',
    label: 'Financial',
    description:
      'Banking, collections and payments: everything in Contact Center plus usernames, IP addresses and other numeric identifiers.',
    policies: unique([...CORE, ...PAYMENT, 'drivers_license', 'passport_number', 'username', 'ip_address', 'number_sequence']),
  },
  HEALTHCARE: {
    preset: 'HEALTHCARE',
    label: 'Healthcare',
    description:
      'Patient conversations: identity and contact details plus healthcare numbers, conditions, procedures, medications, injuries and ages.',
    policies: unique([...CORE, ...PAYMENT, 'healthcare_number', 'medical_condition', 'medical_process', 'drug', 'injury',
      'blood_type', 'person_age', 'number_sequence']),
  },
  CUSTOM: {
    preset: 'CUSTOM',
    label: 'Custom',
    description: 'Your own selection of entity types. Starts from the Contact Center preset.',
    policies: unique([...CORE, ...PAYMENT, 'healthcare_number', 'drivers_license', 'passport_number', 'number_sequence']),
  },
};

/** Effective policy list for a preset, applying an organization's saved override if any. */
export function resolvePolicies(preset: PolicyPreset, override?: readonly string[] | null): PiiPolicyName[] {
  if (override && override.length > 0) {
    const valid = override.filter(isPiiPolicy);
    if (valid.length > 0) return unique(valid);
  }
  return [...PRESET_DEFINITIONS[preset].policies];
}

/** `PHONE_NUMBER` -> `Phone number` */
export function entityLabel(entity: string): string {
  const words = entity.toLowerCase().split('_');
  const label = words
    .join(' ')
    .replace(/\bus\b/, 'US')
    .replace(/\bip\b/, 'IP')
    .replace(/\bcvv\b/, 'CVV')
    .replace(/\burl\b/, 'URL');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
