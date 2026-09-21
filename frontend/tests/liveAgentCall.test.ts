import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveAgentCall, type LiveCallEvents } from '../src/voice/liveAgentCall';

/**
 * The tool-result handshake, driven by hand. These are the event orders the
 * Voice Agent API produces around a tool call; the one in the first test is
 * what left the agent silent until the caller prompted it again.
 */

class FakeSocket {
  readyState = WebSocket.OPEN;
  readonly sent: Array<Record<string, unknown>> = [];
  send(raw: string) {
    this.sent.push(JSON.parse(raw) as Record<string, unknown>);
  }
}

const TOOL_CALL = { type: 'tool.call', call_id: 'call_77', name: 'lookup_account', arguments: { phone_number: '415 555 0142' } };

let call: LiveAgentCall;
let socket: FakeSocket;
let events: LiveCallEvents;

/** The class talks to the socket and the clock through these two only. */
function drive(...messages: Array<Record<string, unknown>>) {
  for (const message of messages) (call as unknown as { handle(raw: string): void }).handle(JSON.stringify(message));
}

const toolResults = () => socket.sent.filter((message) => message.type === 'tool.result');

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  events = { onLive: vi.fn(), onSpeaking: vi.fn(), onAction: vi.fn(), onLevel: vi.fn(), onError: vi.fn() };
  call = new LiveAgentCall(events);
  socket = new FakeSocket();
  (call as unknown as { ws: FakeSocket }).ws = socket;
  drive({ type: 'session.ready', session_id: 'sess_1' });
});

describe('answering a tool call', () => {
  it('sends the result even when the caller made a sound after the reply ended', () => {
    // The agent says "let me look that up", finishes, and only then asks for the
    // tool. If the caller breathes or says "sure" in that gap, the result still
    // has to go out - this is the case that used to hang the call.
    drive(
      { type: 'reply.started' },
      { type: 'reply.done', status: 'completed' },
      { type: 'input.speech.started' },
      TOOL_CALL,
    );

    expect(toolResults()).toEqual([{ type: 'tool.result', call_id: 'call_77', result: expect.any(String), is_error: false }]);
    expect(JSON.parse(String(toolResults()[0]!.result))).toMatchObject({ found: true, plan: 'Unlimited Plus' });
    expect(events.onAction).toHaveBeenCalledWith(expect.objectContaining({ label: 'Found the account', ok: true }));
  });

  it('waits for the reply to finish when the tool is called mid-sentence', () => {
    drive({ type: 'reply.started' }, TOOL_CALL);
    expect(toolResults()).toEqual([]); // still speaking

    drive({ type: 'reply.done', status: 'completed' });
    expect(toolResults()).toHaveLength(1);
  });

  it('drops the result when the caller interrupts the reply', () => {
    drive({ type: 'reply.started' }, TOOL_CALL, { type: 'reply.done', status: 'interrupted' });
    expect(toolResults()).toEqual([]);

    // The dropped result must not resurface on the next reply.
    drive({ type: 'reply.started' }, { type: 'reply.done', status: 'completed' });
    expect(toolResults()).toEqual([]);
  });

  it('sends a stranded result rather than leaving the agent waiting in silence', () => {
    vi.useFakeTimers();
    try {
      drive({ type: 'reply.started' }, TOOL_CALL);
      expect(toolResults()).toEqual([]);

      vi.advanceTimersByTime(6_000); // reply.done never arrived
      expect(toolResults()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never sends the same result twice', () => {
    drive({ type: 'reply.started' }, TOOL_CALL, { type: 'reply.done', status: 'completed' });
    drive({ type: 'reply.started' }, { type: 'reply.done', status: 'completed' });
    expect(toolResults()).toHaveLength(1);
  });
});
