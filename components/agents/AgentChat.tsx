"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button, Textarea } from "@/components/ui";
import { approveContactDraft } from "@/components/outreach/client";
import { cn } from "@/lib/ui/cn";

const POLL_MS = 8000;
const MAX_LEN = 1000;
const SUGGESTIONS = ["What did they say?", "When will you follow up?", "Email only, please"];

type ApproveCard = { kind: "approve_send"; contactId: string; draftId: string; preview: string };

export type ChatMsg = {
  id: string;
  role: "user" | "agent";
  body: string;
  via: "app" | "email";
  createdAt: string;
  data: null | { card?: ApproveCard; instruction?: { type: string } };
};

type Variant = "patient" | "judge";

function ApproveCardView({ card }: { card: ApproveCard }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [reasons, setReasons] = useState<string[]>([]);

  async function approve() {
    setState("sending");
    setReasons([]);
    try {
      const result = await approveContactDraft(card.contactId, card.draftId);
      if (result.ok) {
        setState("sent");
      } else {
        setState("idle");
        setReasons(result.reasons.length ? result.reasons : ["The message was not approved."]);
      }
    } catch {
      setState("idle");
      setReasons(["Could not reach the server."]);
    }
  }

  return (
    <div className="mt-2 grid gap-2 rounded-md border border-line bg-paper-2 p-2">
      <p className="m-0 whitespace-pre-wrap text-small text-ink [overflow-wrap:anywhere]">{card.preview}</p>
      <div>
        <Button
          size="sm"
          disabled={state === "sent"}
          loading={state === "sending"}
          loadingText="Sending"
          onClick={() => void approve()}
        >
          {state === "sent" ? "Sent" : "Approve and send"}
        </Button>
      </div>
      {reasons.length > 0 ? (
        <ul role="alert" className="m-0 grid list-none gap-0.5 p-0 text-small text-ink-2">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Bubble({ msg, variant }: { msg: ChatMsg; variant: Variant }) {
  const mine = msg.role === "user";
  return (
    <div className={cn("m-0 flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3.5 py-2.5 leading-relaxed",
          variant === "patient" ? "text-body" : "text-body sm:max-w-[min(85%,62ch)]",
          mine ? "bg-teal-soft text-ink" : "border border-line bg-card text-ink",
        )}
      >
        <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{msg.body}</p>
        {msg.via === "email" ? <span className="text-small text-ink-3">via email</span> : null}
        {msg.data?.card ? <ApproveCardView card={msg.data.card} /> : null}
        {variant === "judge" && !mine && msg.data?.instruction?.type ? (
          <p className="m-0 mt-1 text-small text-ink-3">
            Parsed instruction: <code className="font-mono">{msg.data.instruction.type}</code>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function AgentChat({
  caseId,
  agentId,
  agentName,
  variant,
}: {
  caseId: string;
  agentId: string;
  agentName: string;
  variant: Variant;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const pendingSeq = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const url = `/api/cases/${caseId}/agents/${agentId}/chat`;

  const load = useCallback(async () => {
    if (sendingRef.current) return;
    try {
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { messages?: ChatMsg[] };
      if (Array.isArray(data.messages) && !sendingRef.current) setMessages(data.messages);
    } catch {
      // Polling is best-effort; the next tick retries.
    }
  }, [url]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages.length]);

  async function send(raw: string) {
    const message = raw.trim().slice(0, MAX_LEN);
    if (!message || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    const optimistic: ChatMsg = {
      id: `pending-${++pendingSeq.current}`,
      role: "user",
      body: message,
      via: "app",
      createdAt: new Date(0).toISOString(),
      data: null,
    };
    setMessages((current) => [...current, optimistic]);
    setText("");
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: unknown; messages?: ChatMsg[] };
      if (!response.ok) {
        setMessages((current) => current.filter((m) => m.id !== optimistic.id));
        setText(message);
        setError(typeof data.error === "string" ? data.error : "Message could not be sent.");
      } else if (Array.isArray(data.messages)) {
        setMessages(data.messages);
      }
    } catch {
      setMessages((current) => current.filter((m) => m.id !== optimistic.id));
      setText(message);
      setError("Could not reach the server.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  const patient = variant === "patient";

  return (
    <div className="grid gap-2" data-variant={variant}>
      <div
        role="log"
        aria-live="polite"
        aria-label={`Conversation with ${agentName}`}
        className={cn(
          "grid content-start gap-2.5 overflow-y-auto",
          patient ? "max-h-80" : "max-h-[26rem]",
          !patient && messages.length > 0 && "min-h-40 rounded-md bg-paper-2 p-3",
        )}
      >
        {messages.map((msg) => (
          <Bubble key={msg.id} msg={msg} variant={variant} />
        ))}
        <div ref={endRef} aria-hidden />
      </div>
      {messages.length === 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Suggestions">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={sending}
              onClick={() => void send(suggestion)}
              className={cn(
                "rounded-pill border border-line-strong bg-paper-2 px-3 text-small font-semibold text-ink-2 hover:text-ink disabled:opacity-50",
                patient ? "min-h-11" : "min-h-8",
              )}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-small text-ink-2">
          {error}
        </p>
      ) : null}
      <form
        className={cn("grid gap-2", !patient && "sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end")}
        onSubmit={(event) => {
          event.preventDefault();
          void send(text);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Message to {agentName}
        </label>
        <Textarea
          id={inputId}
          value={text}
          rows={patient ? 3 : 2}
          maxLength={MAX_LEN}
          disabled={sending}
          placeholder="Ask a question or tell me something (e.g. 'email only')"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send(text);
            }
          }}
        />
        <div>
          <Button
            type="submit"
            size={patient ? "lg" : "sm"}
            disabled={sending || !text.trim()}
            loading={sending}
            loadingText="Sending"
            aria-label={`Send message to ${agentName}`}
          >
            <Send aria-hidden />
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
