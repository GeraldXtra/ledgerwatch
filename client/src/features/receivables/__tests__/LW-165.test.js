import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { channelStatusLines } from "../reminderDelivery";

const SERVER_SETTING = /[A-Z]{2,}_[A-Z_]{2,}/;

describe("LW-165 — the reminder settings speak to the owner, not to whoever runs the server", () => {
  it("says nothing about a channel that sends by itself", () => {
    const lines = channelStatusLines(
      {
        email: { automatic: true, reason: null },
        whatsapp: { provider: "cloud", automatic: true, template: true, reason: null },
      },
      { wantEmail: true, wantWhatsapp: true }
    );
    expect(lines).toEqual([]);
  });

  it("states a limit in plain words, one line per channel, naming no server setting", () => {
    const lines = channelStatusLines(
      {
        email: { automatic: false, reason: "Email reminders cannot be sent automatically: email sending is not set up." },
        whatsapp: {
          provider: "twilio",
          automatic: true,
          template: false,
          reason:
            "WhatsApp reminders are sent automatically, but reach only clients who have messaged you in the last 24 hours until a message template is approved.",
        },
      },
      { wantEmail: true, wantWhatsapp: true }
    );
    expect(lines.map((l) => l.channel)).toEqual(["email", "whatsapp"]);
    for (const line of lines) {
      expect(line.text).not.toMatch(SERVER_SETTING);
      expect(line.text).not.toMatch(/server/i);
    }
  });

  it("reports only the channels the owner switched on, and has words when the server gave none", () => {
    const lines = channelStatusLines(
      { email: { automatic: false, reason: null }, whatsapp: { automatic: false, reason: null } },
      { wantEmail: false, wantWhatsapp: true }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].channel).toBe("whatsapp");
    expect(lines[0].text).toMatch(/cannot be sent automatically/);
  });

  it("the notification settings carry no setup talk and no advice to install the app from a browser", () => {
    const src = fs.readFileSync(
      fileURLToPath(new URL("../../settings/NotificationsSection.jsx", import.meta.url)),
      "utf8"
    );
    expect(src).not.toMatch(/README|configured on the server|install the app first|spam folders|home screen/i);
    expect(src).not.toMatch(/VAPID_|SMTP_|MAIL_FROM|WHATSAPP_|TWILIO_|FIREBASE_/);
  });
});
