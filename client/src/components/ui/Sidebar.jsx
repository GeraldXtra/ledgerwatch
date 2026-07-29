import { useRef } from "react";
import { NavLink } from "react-router-dom";
import { LogOut, Settings as SettingsIcon } from "lucide-react";
import Avatar from "./Avatar";
import LogoMark from "../LogoMark";
import useSlidingIndicator from "../../hooks/useSlidingIndicator";

/**
 * App sidebar: logo mark + wordmark, a "Workspace" nav group, an "Account" group
 * (Settings + Sign out), and the user block pinned at the bottom. Nav rows are
 * real routes, and one indicator bar slides between them rather than each row
 * lighting its own marker. `items`: [{ id, label, icon, to }].
 */
export default function Sidebar({ items, activeId, user, onLogout }) {
  const navRef = useRef(null);
  const bar = useSlidingIndicator(navRef, activeId);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <LogoMark size={30} />
        <span className="wordmark">
          Ledger<span className="tick">Watch</span>
        </span>
      </div>

      <nav className="sidebar-nav" ref={navRef}>
        <span className="overline nav-group-label">Workspace</span>
        {bar && (
          <span
            className="nav-indicator"
            aria-hidden="true"
            style={{ transform: `translateY(${bar.top}px)`, height: bar.height }}
          />
        )}
        {items.map((item) => (
          <NavLink
            key={item.id}
            to={item.to}
            data-navitem={item.id}
            className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-group sidebar-nav">
        <span className="overline nav-group-label">Account</span>
        <NavLink
          to="/app/settings"
          className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
        >
          <SettingsIcon size={16} />
          Settings
        </NavLink>
        <button type="button" className="nav-item" onClick={onLogout}>
          <LogOut size={16} />
          Sign out
        </button>
      </div>

      <div className="sidebar-spacer" />

      <NavLink to="/app/settings" className="sidebar-user">
        <Avatar name={user.name} src={user.avatarUrl} size="lg" />
        <div className="who">
          <div className="name">{user.name}</div>
          <div className="mail">{user.email}</div>
        </div>
      </NavLink>
    </aside>
  );
}
