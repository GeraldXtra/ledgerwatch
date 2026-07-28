import { Landmark, LogOut } from "lucide-react";
import Avatar from "./Avatar";
import LogoMark from "../LogoMark";

/**
 * App sidebar: logo mark + wordmark, a "Workspace" nav group (accent-active
 * rows), an "Account" group (Payout details + Sign out), a simulated-workspace
 * badge, and the user block pinned at the bottom. `items`: [{ id, label, icon }].
 */
export default function Sidebar({ items, value, onChange, user, onLogout, onOpenPayout }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <LogoMark size={30} />
        <span className="wordmark">
          Ledger<span className="tick">Watch</span>
        </span>
      </div>

      <nav className="sidebar-nav">
        <span className="overline nav-group-label">Workspace</span>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={value === item.id ? "nav-item active" : "nav-item"}
            onClick={() => onChange(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-group sidebar-nav">
        <span className="overline nav-group-label">Account</span>
        <button type="button" className="nav-item" onClick={onOpenPayout}>
          <Landmark size={16} />
          Payout details
        </button>
        <button type="button" className="nav-item" onClick={onLogout}>
          <LogOut size={16} />
          Sign out
        </button>
      </div>

      <div className="sidebar-spacer" />

      <div className="sidebar-badge">
        <span className="dot" />
        Simulated workspace
      </div>

      <div className="sidebar-user">
        <Avatar name={user.name} size="lg" />
        <div className="who">
          <div className="name">{user.name}</div>
          <div className="mail">{user.email}</div>
        </div>
      </div>
    </aside>
  );
}
