"""SafeCall's live agent in Python: the same Voice Agent API flow the app uses.

In SafeCall the flow is split in two, because the API key must stay on the server:
  backend/src/services/assemblyai/liveAgent.ts   the agent (prompt, voice, tools)
  backend/src/services/assemblyai/voiceAgent.ts  token, session lookup, delete
  frontend/src/voice/liveAgentCall.ts            microphone, playback, tool calls
  backend/src/pipeline/voiceSession.ts           recording -> redaction -> archive

This single file does all of it in one process, which makes it easy to read and
to demo. It uses the API key directly (server-side); a browser would instead get
a single-use token from GET /v1/token.

    pip install websockets requests
    python live_agent.py --wav caller.wav      # stream a recording as the caller
    python live_agent.py --mic                 # talk to it (pip install sounddevice)
    python live_agent.py --wav caller.wav --archive   # also redact and print the transcript
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import struct
import time
import wave

import requests
import websockets

AGENTS_API = "https://agents.assemblyai.com"
AGENTS_WS = "wss://agents.assemblyai.com/v1/ws"
TRANSCRIPT_API = "https://api.assemblyai.com/v2"
RATE = 24_000  # PCM16 mono, 24 kHz: the Voice Agent default
CHUNK_SAMPLES = 1_200  # 50 ms per input.audio message

# --------------------------------------------------------------------------- #
# 1. The agent: who it is, how it sounds, and what it can do
# --------------------------------------------------------------------------- #

SYSTEM_PROMPT = """You are Sam, a billing support agent for Northwind Mobile, a mobile phone carrier. You are on a live phone call.

Most important rule: keep every reply to one or two short sentences, then let the caller talk.

Sound like a calm, friendly person on the phone. Never say "Great question", "Certainly", "Absolutely" or "I'd be happy to help". Everything you write is spoken aloud, so no lists, markdown or emoji. Say amounts like "forty-five dollars" and dates like "September first".

What you can do, always through your tools: find the caller's account from the mobile number on it, check the charges from the last 30 days, refund a duplicate or incorrect charge after the caller confirms which one, and update the email address or mailing address on the account. Ask for the mobile number on the account before anything else. Call a tool instead of guessing, and say something short like "One moment" while it runs.

What you cannot do: change plans, take payments, or help with anything outside Northwind Mobile billing. Offer a callback from a specialist instead.

Privacy: never ask for a full card number, security code, password or PIN. If the caller starts reading one out, stop them politely and say you don't need it. Don't read a phone number, card number or address back in full; confirm the last few digits or the street name only.

When the caller has what they need, sum up what you did in one sentence and say goodbye."""

GREETING = (
    "Thanks for calling Northwind Mobile, this is Sam. This call is recorded, "
    "and your personal details are removed before it's stored. How can I help?"
)

TOOLS = [
    {
        "type": "function",
        "name": "lookup_account",
        "description": "Find the caller's account. Use once the caller gives the mobile number on the account. Returns the account status, plan and monthly price in US dollars.",
        "parameters": {
            "type": "object",
            "properties": {"phone_number": {"type": "string", "description": "Mobile number on the account, digits only, e.g. 4155550142."}},
            "required": ["phone_number"],
        },
    },
    {
        "type": "function",
        "name": "list_recent_charges",
        "description": "List the charges from the last 30 days on the account found with lookup_account. Use when the caller asks about their bill or a charge. Returns charge_id, date, amount_usd and description for each charge.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "type": "function",
        "name": "issue_refund",
        "description": "Refund one charge. Use only after the caller confirms which charge. Returns a refund reference and when the money arrives.",
        "parameters": {
            "type": "object",
            "properties": {
                "charge_id": {"type": "string", "description": "Charge id from list_recent_charges, e.g. CHG-2043."},
                "reason": {"type": "string", "enum": ["duplicate_charge", "incorrect_amount", "service_issue"], "description": "Why the charge is being refunded."},
            },
            "required": ["charge_id", "reason"],
        },
    },
    {
        "type": "function",
        "name": "update_contact_details",
        "description": "Change the email address or mailing address on the account. Use when the caller asks to update contact details. Returns whether the change was saved.",
        "parameters": {
            "type": "object",
            "properties": {
                "field": {"type": "string", "enum": ["email", "mailing_address"], "description": "Which detail to change."},
                "value": {"type": "string", "description": "The new email address or full mailing address, e.g. jane.doe@example.com."},
            },
            "required": ["field", "value"],
        },
    },
]


def session_config() -> dict:
    """The first `session.update`: everything that shapes the conversation."""
    return {
        "system_prompt": SYSTEM_PROMPT,
        "greeting": GREETING,
        "tools": TOOLS,
        "input": {
            "format": {"encoding": "audio/pcm"},
            "language_codes": ["en"],
            "keyterms": ["Northwind", "Northwind Mobile", "refund", "duplicate charge", "mailing address"],
            # Factory defaults cut callers off; these are AssemblyAI's recommended values.
            "turn_detection": {"vad_threshold": 0.5, "min_silence": 1400, "max_silence": 4000, "interrupt_response": True},
        },
        "output": {"voice": "alba", "format": {"encoding": "audio/pcm"}},
    }


# --------------------------------------------------------------------------- #
# 2. The tools: a mock back office, the same one the browser runs
# --------------------------------------------------------------------------- #


class NorthwindBackOffice:
    """Fake account data for one call. Nothing here leaves the process."""

    def __init__(self) -> None:
        self.account_found = False
        self.refunds: dict[str, str] = {}
        self.charges = [
            {"charge_id": "CHG-2041", "date": "2026-09-01", "amount_usd": 45, "description": "Monthly plan, Unlimited Plus"},
            {"charge_id": "CHG-2043", "date": "2026-09-01", "amount_usd": 45, "description": "Monthly plan, charged a second time on the same day"},
            {"charge_id": "CHG-2019", "date": "2026-08-14", "amount_usd": 12.5, "description": "International roaming day pass"},
        ]

    def run(self, name: str, args: dict) -> tuple[dict, bool]:
        """Returns (result, is_error). The agent reads `error` aloud in its own words."""
        if name == "lookup_account":
            digits = "".join(ch for ch in str(args.get("phone_number", "")) if ch.isdigit())
            if len(digits) < 7:
                return {"error": "The number seems incomplete. Ask the caller for the full mobile number on the account."}, True
            self.account_found = True
            return {"found": True, "account_status": "active", "plan": "Unlimited Plus", "monthly_price_usd": 45}, False

        if not self.account_found:
            return {"error": "No account is selected yet. Ask for the mobile number on the account and call lookup_account first."}, True

        if name == "list_recent_charges":
            return {"charges": [{**c, "refunded": c["charge_id"] in self.refunds} for c in self.charges]}, False

        if name == "issue_refund":
            charge_id = str(args.get("charge_id", "")).strip().upper()
            charge = next((c for c in self.charges if c["charge_id"] == charge_id), None)
            if charge is None:
                ids = ", ".join(c["charge_id"] for c in self.charges)
                return {"error": f"There is no charge {charge_id or 'with that id'}. The charge ids are {ids}. Ask which charge to refund."}, True
            if charge_id in self.refunds:
                return {"refunded": True, "already_refunded": True, "refund_reference": self.refunds[charge_id]}, False
            reference = f"RF-{7731 + len(self.refunds)}"
            self.refunds[charge_id] = reference
            return {"refunded": True, "refund_reference": reference, "amount_usd": charge["amount_usd"], "arrives_in": "3 to 5 business days"}, False

        if name == "update_contact_details":
            field, value = args.get("field"), str(args.get("value", "")).strip()
            if field == "email" and "@" not in value:
                return {"error": "That doesn't look like a complete email address. Ask the caller to spell it out."}, True
            if field == "mailing_address" and len(value) < 8:
                return {"error": "The address seems incomplete. Ask for the street, city and postcode."}, True
            return {"updated": True, "field": field}, False

        return {"error": f"There is no tool called {name}."}, True


# --------------------------------------------------------------------------- #
# 3. Audio in and out
# --------------------------------------------------------------------------- #


def wav_to_pcm24k(path: str) -> bytes:
    """Reads a 16-bit WAV and returns PCM16 mono at 24 kHz."""
    with wave.open(path, "rb") as f:
        if f.getsampwidth() != 2:
            raise SystemExit("The WAV file must be 16-bit PCM.")
        channels, rate, frames = f.getnchannels(), f.getframerate(), f.readframes(f.getnframes())
    samples = struct.unpack(f"<{len(frames) // 2}h", frames)
    if channels > 1:  # average the channels down to mono
        samples = [sum(samples[i : i + channels]) // channels for i in range(0, len(samples) - channels + 1, channels)]
    if rate == RATE:
        out = samples
    else:  # linear resample to 24 kHz
        step, out = rate / RATE, []
        for i in range(int(len(samples) / step)):
            pos = i * step
            left = int(pos)
            a = samples[left]
            b = samples[min(left + 1, len(samples) - 1)]
            out.append(int(a + (b - a) * (pos - left)))
    return struct.pack(f"<{len(out)}h", *out)


async def stream_file(ws, pcm: bytes, tail_seconds: float = 12.0) -> None:
    """Sends the caller audio in real time, holds the line open, then hangs up."""
    frame = CHUNK_SAMPLES * 2  # bytes per 50 ms
    silence = base64.b64encode(bytes(frame)).decode()
    for i in range(0, len(pcm), frame):
        chunk = pcm[i : i + frame].ljust(frame, b"\x00")
        await ws.send(json.dumps({"type": "input.audio", "audio": base64.b64encode(chunk).decode()}))
        await asyncio.sleep(0.05)
    for _ in range(int(tail_seconds / 0.05)):  # a real microphone never stops: turn detection needs the silence
        await ws.send(json.dumps({"type": "input.audio", "audio": silence}))
        await asyncio.sleep(0.05)
    # session.end stops the session immediately; just closing the socket would
    # leave it billable for another 30 seconds of resume window.
    await ws.send(json.dumps({"type": "session.end"}))


async def stream_microphone(ws) -> None:
    """Sends live microphone audio. Needs: pip install sounddevice"""
    import sounddevice as sd  # imported here so the file runs without it

    queue: asyncio.Queue[bytes] = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def on_audio(indata, _frames, _time, _status):
        loop.call_soon_threadsafe(queue.put_nowait, bytes(indata))

    with sd.InputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=CHUNK_SAMPLES, callback=on_audio):
        while True:
            chunk = await queue.get()
            await ws.send(json.dumps({"type": "input.audio", "audio": base64.b64encode(chunk).decode()}))


class Speaker:
    """Plays the agent's audio, if sounddevice is installed."""

    def __init__(self) -> None:
        try:
            import sounddevice as sd

            self.stream = sd.RawOutputStream(samplerate=RATE, channels=1, dtype="int16")
            self.stream.start()
        except Exception:  # no audio device (or no sounddevice): keep going silently
            self.stream = None

    def play(self, pcm: bytes) -> None:
        if self.stream:
            self.stream.write(pcm)

    def flush(self) -> None:
        """Barge-in: drop what is queued so the caller isn't talked over."""
        if self.stream:
            self.stream.stop()
            self.stream.start()


# --------------------------------------------------------------------------- #
# 4. The call itself
# --------------------------------------------------------------------------- #


async def run_call(api_key: str, wav: str | None) -> str | None:
    """Runs one conversation and returns the session id."""
    office, speaker = NorthwindBackOffice(), Speaker()
    pending: list[dict] = []
    last_event = ""
    session_id = None
    started = time.time()

    def log(message: str) -> None:
        print(f"{time.time() - started:6.1f}s  {message}")

    async with websockets.connect(AGENTS_WS, additional_headers={"Authorization": f"Bearer {api_key}"}, max_size=None) as ws:
        await ws.send(json.dumps({"type": "session.update", "session": session_config()}))
        sender: asyncio.Task | None = None

        async def flush_tool_results() -> None:
            # Send results the moment the agent is idle: when reply.done was the last event.
            if last_event == "reply.done" and pending:
                for item in pending:
                    await ws.send(json.dumps({"type": "tool.result", **item}))
                log(f"-> tool.result x{len(pending)}")
                pending.clear()

        async for raw in ws:
            event = json.loads(raw)
            kind = event.get("type")

            if kind == "session.ready":
                session_id = event["session_id"]
                log(f"session.ready ({session_id})")
                if not wav:  # a live caller speaks whenever they like
                    sender = asyncio.create_task(stream_microphone(ws))

            elif kind == "reply.audio":
                speaker.play(base64.b64decode(event["data"]))

            elif kind == "transcript.user":
                log(f"caller: {event['text']}")

            elif kind == "transcript.agent":
                log(f"Sam{' (interrupted)' if event.get('interrupted') else ''}: {event['text']}")

            elif kind == "tool.call":
                result, is_error = office.run(event["name"], event.get("arguments") or {})
                log(f"tool {event['name']}({json.dumps(event.get('arguments') or {})}) -> {json.dumps(result)}")
                pending.append({"call_id": event["call_id"], "result": json.dumps(result), "is_error": is_error})
                await flush_tool_results()

            elif kind in ("reply.started", "input.speech.started"):
                last_event = kind
                if kind == "input.speech.started":
                    speaker.flush()  # the caller barged in

            elif kind == "reply.done":
                last_event = kind
                if event.get("status") == "interrupted":
                    pending.clear()
                    speaker.flush()
                else:
                    await flush_tool_results()
                if wav and sender is None:  # play the recorded caller once the greeting is over
                    sender = asyncio.create_task(stream_file(ws, wav_to_pcm24k(wav)))

            elif kind == "session.error":
                log(f"error {event.get('code')}: {event.get('message')}")

            elif kind == "session.ended":
                log(f"session.ended after {event.get('session_duration_seconds')}s")
                break

        if sender:
            sender.cancel()
    return session_id


# --------------------------------------------------------------------------- #
# 5. After the call: fetch the recording, redact it, delete AssemblyAI's copy
# --------------------------------------------------------------------------- #


def download_recording(api_key: str, session_id: str, path: str) -> str | None:
    """The stereo OGG recording appears a few seconds after the call ends."""
    headers = {"Authorization": api_key}
    for _ in range(24):
        session = requests.get(f"{AGENTS_API}/v1/sessions/{session_id}", headers=headers, timeout=20).json()
        audio = next((a for a in session.get("artifacts", []) if a["type"] == "audio"), None)
        if audio:  # pre-signed link: no key needed, and it expires quickly
            with open(path, "wb") as f:
                f.write(requests.get(audio["url"], timeout=60).content)
            return path
        time.sleep(1.5)
    return None


def redact_and_transcribe(api_key: str, path: str) -> dict:
    """The same request SafeCall sends: redacted transcript plus redacted audio."""
    headers = {"Authorization": api_key}
    with open(path, "rb") as f:
        upload_url = requests.post(f"{TRANSCRIPT_API}/upload", headers=headers, data=f, timeout=120).json()["upload_url"]
    job = requests.post(
        f"{TRANSCRIPT_API}/transcript",
        headers=headers,
        json={
            "audio_url": upload_url,
            "speech_models": ["universal-3-5-pro", "universal-2"],
            "speaker_labels": True,
            "redact_pii": True,
            "redact_pii_policies": ["person_name", "phone_number", "email_address", "location_address", "credit_card_number", "credit_card_expiration", "date_of_birth", "banking_information"],
            "redact_pii_sub": "entity_name",
            "redact_pii_audio": True,
            "redact_pii_audio_quality": "mp3",
            "redact_pii_audio_options": {"override_audio_redaction_method": "silence"},
        },
        timeout=60,
    ).json()
    while True:
        result = requests.get(f"{TRANSCRIPT_API}/transcript/{job['id']}", headers=headers, timeout=30).json()
        if result["status"] in ("completed", "error"):
            return result
        time.sleep(3)


def delete_session(api_key: str, session_id: str) -> None:
    """The voice session holds the unredacted recording, so SafeCall deletes it."""
    requests.delete(f"{AGENTS_API}/v1/sessions/{session_id}", headers={"Authorization": api_key}, timeout=20)


def main() -> None:
    parser = argparse.ArgumentParser(description="Talk to SafeCall's live agent")
    parser.add_argument("--wav", help="16-bit WAV to stream as the caller (otherwise use --mic)")
    parser.add_argument("--mic", action="store_true", help="use the microphone")
    parser.add_argument("--archive", action="store_true", help="after the call, redact the recording and print the safe transcript")
    parser.add_argument("--keep-session", action="store_true", help="do not delete the session at AssemblyAI")
    args = parser.parse_args()
    if not args.wav and not args.mic:
        parser.error("choose --wav FILE or --mic")

    api_key = os.environ.get("ASSEMBLYAI_API_KEY", "")
    if not api_key:
        raise SystemExit("Set ASSEMBLYAI_API_KEY first.")

    session_id = asyncio.run(run_call(api_key, args.wav))
    if not session_id:
        return

    if args.archive:
        recording = download_recording(api_key, session_id, "call-recording.ogg")
        print(f"\nrecording: {recording}")
        if recording:
            result = redact_and_transcribe(api_key, recording)
            print(f"transcription: {result['status']}")
            for utterance in result.get("utterances") or []:
                print(f"  [{utterance['speaker']}] {utterance['text']}")
            print(f"redacted audio: {result.get('redacted_audio_url') or 'requested, ready shortly'}")

    if not args.keep_session:
        delete_session(api_key, session_id)
        print(f"deleted session {session_id} at AssemblyAI")


if __name__ == "__main__":
    main()
