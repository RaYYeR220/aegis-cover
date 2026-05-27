import { NavLink } from "react-router-dom";
import { WalletButton } from "./WalletButton";

const LINKS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/guardian", label: "Claims" },
  { to: "/policies", label: "My Cover" },
  { to: "/underwrite", label: "Earn" },
  { to: "/activity", label: "Activity" },
];

export function Nav() {
  return (
    <nav>
      <span className="nav-brand">
        <svg className="nav-brand-mark" viewBox="0 0 64 64" aria-hidden="true">
          <polygon points="32,18 45.31,27.67 40.23,43.32 23.77,43.32 18.69,27.67"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <g stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.2">
            <line x1="32" y1="32" x2="32" y2="18" />
            <line x1="32" y1="32" x2="45.31" y2="27.67" />
            <line x1="32" y1="32" x2="40.23" y2="43.32" />
            <line x1="32" y1="32" x2="23.77" y2="43.32" />
            <line x1="32" y1="32" x2="18.69" y2="27.67" />
          </g>
          <g fill="currentColor">
            <circle cx="32" cy="18" r="2.6" />
            <circle cx="45.31" cy="27.67" r="2.6" />
            <circle cx="40.23" cy="43.32" r="2.6" />
            <circle cx="23.77" cy="43.32" r="2.6" />
            <circle cx="18.69" cy="27.67" r="2.6" />
          </g>
          <circle className="nav-brand-core" cx="32" cy="32" r="3.8" />
        </svg>
        AEGIS
      </span>
      <span className="nav-sep" />
      <div className="nav-links">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}
            className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            {l.label}
          </NavLink>
        ))}
      </div>
      <div className="nav-right"><WalletButton /></div>
    </nav>
  );
}
