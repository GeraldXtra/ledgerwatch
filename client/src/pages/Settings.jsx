import { useSearchParams } from "react-router-dom";
import { Field, PageHeader, Select, ToastProvider } from "../components/ui";
import { Tabs } from "../components/ui/Tabs";
import ProfileSection from "../features/settings/ProfileSection";
import PayoutSection from "../features/settings/PayoutSection";
import CryptoSection from "../features/settings/CryptoSection";
import SecuritySection from "../features/settings/SecuritySection";
import WalletBackupSection from "../features/settings/WalletBackupSection";
import NotificationsSection from "../features/settings/NotificationsSection";
import DangerSection from "../features/settings/DangerSection";

const SECTIONS = [
  { id: "profile", label: "Profile", Component: ProfileSection },
  { id: "payout", label: "Payout details", Component: PayoutSection },
  { id: "crypto", label: "Crypto payments", Component: CryptoSection },
  { id: "security", label: "Security", Component: SecuritySection },
  { id: "wallet-backup", label: "Wallet backup", Component: WalletBackupSection },
  { id: "notifications", label: "Notifications", Component: NotificationsSection },
  { id: "danger", label: "Danger zone", Component: DangerSection },
];

function SettingsInner() {
  const [params, setParams] = useSearchParams();
  const wanted = params.get("section");
  const active = SECTIONS.some((s) => s.id === wanted) ? wanted : "profile";
  const Section = (SECTIONS.find((s) => s.id === active) || SECTIONS[0]).Component;

  function choose(id) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("section", id);
        return next;
      },
      { replace: true }
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Settings"
        support="Your profile, how you get paid, and how LedgerWatch reaches your clients."
      />

      <div className="settings-view">
        <div className="settings-tabs">
          <Tabs
            tabs={SECTIONS}
            value={active}
            onChange={choose}
            label="Settings sections"
            idPrefix="settings"
          />
        </div>
        <div className="settings-picker">
          <Field label="Section" htmlFor="settings-section">
            <Select id="settings-section" value={active} onChange={(e) => choose(e.target.value)}>
              {SECTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <section
          key={active}
          className="card settings-panel"
          role="tabpanel"
          id={`settings-${active}-panel`}
          aria-labelledby={`settings-${active}`}
        >
          <Section />
        </section>
      </div>
    </>
  );
}

export default function SettingsPage() {
  return (
    <ToastProvider>
      <SettingsInner />
    </ToastProvider>
  );
}
