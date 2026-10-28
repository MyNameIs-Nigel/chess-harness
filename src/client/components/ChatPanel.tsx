import { useEffect, useRef, useState } from "react";
import type { Color, GameSnapshot } from "../../shared/types";

export function ChatPanel({
  game,
  me,
  onSend,
}: {
  game: GameSnapshot;
  me: Color | null;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [game.chat.length]);

  const canChat = me !== null && game.status === "playing";
  return (
    <div className="panel chat-panel">
      <h3>💬 Table talk</h3>
      <div className="chat" ref={scroller}>
        {game.chat.length === 0 && (
          <p className="muted small pad">Quiet so far. Say something provocative.</p>
        )}
        {game.chat.map((m, i) => (
          <div key={i} className={`msg ${m.color === me ? "mine" : ""}`}>
            <span className="msg-who">{game.players[m.color].label}</span>
            <span className="msg-text">{m.text}</span>
          </div>
        ))}
      </div>
      {canChat && (
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            onSend(text);
            setText("");
          }}
        >
          <input
            value={text}
            maxLength={500}
            placeholder="The AI reads this on its next turn…"
            onChange={(e) => setText(e.target.value)}
          />
          <button className="button" type="submit">
            Send
          </button>
        </form>
      )}
    </div>
  );
}
