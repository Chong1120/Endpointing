/**
 * Mock back office of "Northwind Mobile", the fictional carrier the live agent
 * works for. The agent's tool calls run here, in the caller's browser, so what
 * the caller tells a tool (phone numbers, emails, addresses) never reaches
 * SafeCall's servers. Only the finished recording does, and it is redacted
 * before anything is stored. Tool names and parameters mirror
 * backend/src/services/assemblyai/liveAgent.ts.
 */

export const ESCALATION_REASONS = ['customer_requested', 'upset_customer', 'out_of_scope', 'payment_issue'] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

export const ESCALATION_LABELS: Record<EscalationReason, string> = {
  customer_requested: 'Caller asked for a person',
  upset_customer: 'Caller was still upset',
  out_of_scope: 'Outside what the agent can do',
  payment_issue: 'Payment matter',
};

export interface AgentAction {
  id: number;
  tool: string;
  label: string;
  /** Never personal data: ids, amounts and counts only. */
  detail?: string;
  ok: boolean;
  at: Date;
}

export interface ToolOutcome {
  result: unknown;
  isError: boolean;
  action: Omit<AgentAction, 'id' | 'at'>;
  /** Set when the agent hands the call to a person. */
  escalation?: EscalationReason;
}

interface Charge {
  charge_id: string;
  /** Days before today, so charges always look recent. */
  daysAgo: number;
  amount_usd: number;
  description: string;
  /** Some charges a support agent has to look at; the agent must say so and offer a person. */
  refundable?: false;
}

interface Account {
  plan: string;
  monthly_price_usd: number;
  account_status: 'active' | 'past_due' | 'suspended';
  customer_since: number;
  charges: Charge[];
}

/**
 * Four accounts, so two people trying the demo do not hear the same call.
 * The mobile number picks one, always the same one for the same number.
 */
const ACCOUNTS: Account[] = [
  {
    // The classic: billed twice on the same day.
    plan: 'Unlimited Plus',
    monthly_price_usd: 45,
    account_status: 'active',
    customer_since: 2021,
    charges: [
      { charge_id: 'CHG-2041', daysAgo: 12, amount_usd: 45, description: 'Monthly plan, Unlimited Plus' },
      { charge_id: 'CHG-2043', daysAgo: 12, amount_usd: 45, description: 'Monthly plan, Unlimited Plus, charged a second time on the same day' },
      { charge_id: 'CHG-2019', daysAgo: 26, amount_usd: 12.5, description: 'International roaming day pass' },
    ],
  },
  {
    // Roaming the caller says they never used.
    plan: 'Unlimited Family, 3 lines',
    monthly_price_usd: 95,
    account_status: 'active',
    customer_since: 2019,
    charges: [
      { charge_id: 'CHG-5510', daysAgo: 8, amount_usd: 95, description: 'Monthly plan, Unlimited Family' },
      { charge_id: 'CHG-5533', daysAgo: 6, amount_usd: 60, description: 'International roaming, 4 day passes on line 2' },
      { charge_id: 'CHG-5540', daysAgo: 3, amount_usd: 9.99, description: 'Device protection, line 3' },
    ],
  },
  {
    // A late fee after a missed payment: the plan change is out of scope, the fee is not.
    plan: 'Essential 20 GB',
    monthly_price_usd: 30,
    account_status: 'past_due',
    customer_since: 2023,
    charges: [
      { charge_id: 'CHG-7702', daysAgo: 18, amount_usd: 30, description: 'Monthly plan, Essential 20 GB' },
      { charge_id: 'CHG-7715', daysAgo: 11, amount_usd: 10, description: 'Late payment fee' },
      { charge_id: 'CHG-7721', daysAgo: 4, amount_usd: 25, description: 'Data top-up, 10 GB' },
    ],
  },
  {
    // Suspended after a failed payment: a person has to restore the line.
    plan: 'Prepaid 10 GB',
    monthly_price_usd: 20,
    account_status: 'suspended',
    customer_since: 2024,
    charges: [
      { charge_id: 'CHG-9104', daysAgo: 21, amount_usd: 20, description: 'Monthly plan, Prepaid 10 GB' },
      { charge_id: 'CHG-9119', daysAgo: 9, amount_usd: 20, description: 'Retry of the failed monthly payment', refundable: false },
    ],
  },
];

/** Same number, same account, every time. The demo number in the UI picks the duplicate-charge account. */
function accountFor(digits: string): Account {
  if (digits.endsWith('5550142')) return ACCOUNTS[0]!;
  const sum = [...digits].reduce((total, digit) => total + Number(digit), 0);
  return ACCOUNTS[sum % ACCOUNTS.length]!;
}

const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const usd = (amount: number) => `$${amount.toFixed(2)}`;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function failure(tool: string, label: string, error: string): ToolOutcome {
  // The agent reads `error` verbatim, so it says what to ask for next.
  return { isError: true, result: { error }, action: { tool, label, ok: false } };
}

/** One back office per call: it remembers the account and refunds for that call only. */
export function createNorthwindBackOffice(now = new Date()) {
  const refunds = new Map<string, string>();
  let account: Account | null = null;

  const dated = (charge: Charge) => {
    const date = new Date(now);
    date.setDate(date.getDate() - charge.daysAgo);
    return { charge_id: charge.charge_id, date: isoDate(date), amount_usd: charge.amount_usd, description: charge.description };
  };

  const noAccount = (tool: string) =>
    failure(tool, 'Asked for the account first', 'No account is selected yet. Ask for the mobile number on the account and call lookup_account first.');

  return function runTool(name: string, args: Record<string, unknown>): ToolOutcome {
    switch (name) {
      case 'lookup_account': {
        const digits = String(args.phone_number ?? '').replace(/\D/g, '');
        if (digits.length < 7) {
          return failure(name, 'Account lookup needs the full number', 'The number seems incomplete. Ask the caller for the full mobile number on the account.');
        }
        account = accountFor(digits);
        return {
          isError: false,
          result: {
            found: true,
            account_status: account.account_status,
            plan: account.plan,
            monthly_price_usd: account.monthly_price_usd,
            customer_since: account.customer_since,
          },
          action: { tool: name, label: 'Found the account', detail: `${account.plan} · ${account.account_status.replace('_', ' ')}`, ok: true },
        };
      }
      case 'list_recent_charges': {
        if (!account) return noAccount(name);
        return {
          isError: false,
          result: { charges: account.charges.map((charge) => ({ ...dated(charge), refunded: refunds.has(charge.charge_id) })) },
          action: { tool: name, label: 'Checked recent charges', detail: `${account.charges.length} charges in the last 30 days`, ok: true },
        };
      }
      case 'issue_refund': {
        if (!account) return noAccount(name);
        const id = String(args.charge_id ?? '').trim().toUpperCase();
        const charge = account.charges.find((candidate) => candidate.charge_id === id);
        if (!charge) {
          return failure(
            name,
            'Refund needs a valid charge',
            `There is no charge ${id || 'with that id'}. The charge ids are ${account.charges.map((c) => c.charge_id).join(', ')}. Ask the caller which charge to refund.`,
          );
        }
        if (charge.refundable === false) {
          return failure(
            name,
            'Charge needs a person',
            'This charge cannot be refunded from your tools. Tell the caller a specialist has to review it, and use transfer_to_human with reason payment_issue.',
          );
        }
        const existing = refunds.get(charge.charge_id);
        if (existing) {
          return {
            isError: false,
            result: { refunded: true, already_refunded: true, refund_reference: existing },
            action: { tool: name, label: 'Refund already issued', detail: existing, ok: true },
          };
        }
        const reference = `RF-${7731 + refunds.size}`;
        refunds.set(charge.charge_id, reference);
        return {
          isError: false,
          result: { refunded: true, refund_reference: reference, amount_usd: charge.amount_usd, arrives_in: '3 to 5 business days', to: 'the original payment method' },
          action: { tool: name, label: `Refunded ${usd(charge.amount_usd)}`, detail: `${reference} · ${String(args.reason ?? 'refund').replace(/_/g, ' ')}`, ok: true },
        };
      }
      case 'update_contact_details': {
        if (!account) return noAccount(name);
        const field = args.field === 'email' || args.field === 'mailing_address' ? args.field : null;
        const value = String(args.value ?? '').trim();
        if (!field) return failure(name, 'Contact update needs a field', 'Say whether the email address or the mailing address should change.');
        if (field === 'email' && !EMAIL.test(value)) {
          return failure(name, 'Email needs another try', "That doesn't look like a complete email address. Ask the caller to spell it out.");
        }
        if (field === 'mailing_address' && value.length < 8) {
          return failure(name, 'Address needs another try', 'The address seems incomplete. Ask for the street, city and postcode.');
        }
        return {
          isError: false,
          result: { updated: true, field },
          action: { tool: name, label: field === 'email' ? 'Updated the email address' : 'Updated the mailing address', detail: 'New value not shown', ok: true },
        };
      }
      case 'transfer_to_human': {
        // Only the reason travels with the call: no free text, so nothing the
        // caller said can ride along into the follow-up queue.
        const asked = String(args.reason ?? '');
        const reason = (ESCALATION_REASONS as readonly string[]).includes(asked) ? (asked as EscalationReason) : 'customer_requested';
        return {
          isError: false,
          escalation: reason,
          result: { transferred: true, callback_within: 'one business hour', tell_caller: 'A specialist will call you back within the hour.' },
          action: { tool: name, label: 'Handed the call to a human', detail: ESCALATION_LABELS[reason], ok: true },
        };
      }
      default:
        return failure(name, `Unknown tool ${name}`, `There is no tool called ${name}.`);
    }
  };
}
