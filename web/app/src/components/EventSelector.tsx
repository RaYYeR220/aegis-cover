interface Props {
  eventId: string; // "1368376"
  protocol: string; // "DemoVault" | "ZenVault"
  typeName: string; // "Exploit" | "Depeg"
  badge: string; // "CONFIRMED" | "NOT CONFIRMED" | "LIVE" | "RUNNING…"
  confirmed: boolean; // controls the confirmed-badge styling
  timer: string; // "T+1m 32s" (live elapsed or demo static)
  onPrev: () => void;
  onNext: () => void;
}

// Guardian top bar with the ◀ Event #… ▶ selector — ported from mockup 1797–1809.
export function EventSelector({ eventId, protocol, typeName, badge, confirmed, timer, onPrev, onNext }: Props) {
  return (
    <div className="guardian-topbar">
      <div className="event-selector">
        <button className="event-nav-btn" onClick={onPrev} aria-label="Previous event">◀</button>
        <span className="event-label">Event #{eventId}</span>
        <span style={{ color: "var(--text3)", fontSize: "10px" }}>·</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "var(--text2)" }}>{protocol}</span>
        <span style={{ color: "var(--text3)", fontSize: "10px" }}>·</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "var(--text2)" }}>{typeName}</span>
        <span className={`event-type-badge${confirmed ? " confirmed-badge" : ""}`}>{badge}</span>
        <button className="event-nav-btn" onClick={onNext} aria-label="Next event">▶</button>
      </div>
      <div className="guardian-timer">{timer}</div>
    </div>
  );
}
