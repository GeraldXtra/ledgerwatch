import { useState } from "react";
import { SendHorizontal } from "lucide-react";
import http from "../../api/http";
import { Button, Card, Input } from "../../components/ui";

const SUGGESTIONS = ["watch BTC drop 5%", "watch ETH, SOL", "how is my portfolio?"];

// onAction is called after a message that may have changed watches/portfolio,
// so the parent can refresh its data.
export default function ChatBox({ onAction }) {
  const [messages, setMessages] = useState([
    {
      role: "agent",
      text: 'Ask me to watch a coin (e.g. "watch BTC drop 5%") or ask how your portfolio is doing.',
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(text) {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setMessages((m) => [...m, { role: "user", text: message }]);
    setInput("");
    setBusy(true);
    try {
      const { data } = await http.post("/api/ai/chat", { message });
      setMessages((m) => [...m, { role: "agent", text: data.reply }]);
      if (data.createdWatches && data.createdWatches.length && onAction) onAction();
      else if (onAction) onAction();
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "agent", text: err?.response?.data?.error || "Something went wrong." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      eyebrow="Agent"
      title="Market agent"
      subtitle="Watches, alerts and portfolio questions in plain language."
    >
      <div className="stack">
        <div className="chat-log">
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              {m.text}
            </div>
          ))}
          {busy && (
            <div className="chat-msg agent muted" aria-live="polite">
              Thinking...
            </div>
          )}
        </div>

        <div className="row wrap">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>

        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Input
            className="grow"
            placeholder="Message the agent..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="Message the agent"
          />
          <Button variant="primary" type="submit" disabled={busy}>
            <SendHorizontal size={14} />
            {busy ? "Sending" : "Send"}
          </Button>
        </form>
      </div>
    </Card>
  );
}
