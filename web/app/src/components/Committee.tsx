interface Props {
  validators: string[]; // 5 short labels (live committee or demo)
  locked: boolean;
}

// Committee list — ported from mockup 1999–2023. `✓ locked` once the verdict is in.
export function Committee({ validators, locked }: Props) {
  return (
    <div className="committee-list">
      {validators.slice(0, 5).map((addr, i) => (
        <div className="committee-row" key={i}>
          <span className="committee-addr">{addr}</span>
          <span className={`committee-status${locked ? " locked" : ""}`}>
            {locked ? "✓ locked" : "· pending"}
          </span>
        </div>
      ))}
    </div>
  );
}
