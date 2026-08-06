import { useState } from "react";
import {
  BellRing,
  Coins,
  KeyRound,
  Landmark,
  ShieldCheck,
  TriangleAlert,
  User as UserIcon,
} from "lucide-react";
import { PageHeader, ToastProvider } from "../components/ui";
import ProfileSection from "../features/settings/ProfileSection";
import PayoutSection from "../features/settings/PayoutSection";
import CryptoSection from "../features/settings/CryptoSection";
import SecuritySection from "../features/settings/SecuritySection";
import WalletBackupSection from "../features/settings/WalletBackupSection";
import NotificationsSection from "../features/settings/NotificationsSection";
import DangerSection from "../features/settings/DangerSection";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: <UserIcon size={16} />, Component: ProfileSection },
  { id: "payout", label: "Payout details", icon: <Landmark size={16} />, Component: PayoutSection },
  { id: "crypto", label: "Crypto payments", icon: <Coins size={16} />, Component: CryptoSection },
  { id: "security", label: "Security", icon: <ShieldCheck size={16} />, Component: SecuritySection },
  // Its own tab rather than buried inside Security: this is the screen that
  // stops the wallet being a one-browser trap, so it needs to be findable by
  // someone who does not already know it exists.
  { id: "wallet-backup", label: "Wallet backup", icon: <KeyRound size={16} />, Component: WalletBackupSection },
  { id: "notifications", label: "Notifications", icon: <BellRing size={16} />, Component: NotificationsSection },
  { id: "danger", label: "Danger zone", icon: <TriangleAlert size={16} />, Component: DangerSection },
];

function SettingsInner() {
  /**
   * Honour `?section=` so other screens can link straight to a tab — the wallet
   * page's "Back up now" points here. Without this the link lands on Profile and
   * the user has to hunt for the thing they were just told was urgent.
   * Falls back to Profile for an unknown or absent value.
   */
  const [active, setActive] = useState(() => {
    const wanted = new URLSearchParams(window.location.search).get("section");
    return SECTIONS.some((s) => s.id === wanted) ? wanted : "profile";
  });
  const Section = (SECTIONS.find((s) => s.id === active) || SECTIONS[0]).Component;

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Settings"
        support="Your profile, how you get paid, and how LedgerWatch reaches your clients."
      />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={active === s.id ? "nav-item active" : "nav-item"}
              aria-current={active === s.id ? "page" : undefined}
              onClick={() => setActive(s.id)}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </nav>

        <div key={active} className="settings-panel">
          <Section />
        </div>
      </div>
    </>
  );
}

// Own ToastProvider so settings feedback works independently of the other tabs.
export default function SettingsPage() {
  return (
    <ToastProvider>
      <SettingsInner />
    </ToastProvider>
  );
}
