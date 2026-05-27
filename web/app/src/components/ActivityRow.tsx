import { txUrl } from "../chain/config";
import type { ActivityItem } from "../data/demo";

interface ActivityRowProps {
  item: ActivityItem;
}

export function ActivityRow({ item }: ActivityRowProps) {
  const typeKey = item.type.toLowerCase();
  const hash = item.tx;

  return (
    <div className="activity-row" data-type={typeKey}>
      <div className="act-time">{item.ts}</div>
      <div className="act-type-tag">{item.type.toLowerCase()}</div>
      <div>
        <div className="act-event">{item.label}</div>
      </div>
      <div className="act-val">{item.value}</div>
      <div className="act-tx">
        {hash ? (
          <a href={txUrl(hash)} target="_blank" rel="noopener noreferrer">
            {hash.slice(0, 6)}…{hash.slice(-4)}
          </a>
        ) : (
          <span>—</span>
        )}
      </div>
    </div>
  );
}
