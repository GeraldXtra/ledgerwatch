export function channelName(channel) {
  return channel === "email" ? "Email" : "WhatsApp";
}

export function deliveryNote(delivery) {
  if (!delivery) return "";
  if (delivery.status === "sent") return delivery.warning || "";
  return delivery.error || "";
}

export function channelStatusLines(channels, { wantEmail = false, wantWhatsapp = false } = {}) {
  const lines = [];
  const email = channels && channels.email;
  const whatsapp = channels && channels.whatsapp;
  if (wantEmail && email) {
    lines.push(
      email.automatic
        ? { channel: "email", ok: true, text: "Email: this server sends reminder emails by itself." }
        : {
            channel: "email",
            ok: false,
            text: `Email reminders cannot be sent automatically: ${email.reason || "email is not set up on the server."}`,
          }
    );
  }
  if (wantWhatsapp && whatsapp) {
    if (whatsapp.automatic && !whatsapp.reason) {
      lines.push({ channel: "whatsapp", ok: true, text: "WhatsApp: this server sends reminder messages by itself." });
    } else {
      lines.push({
        channel: "whatsapp",
        ok: false,
        text: whatsapp.automatic
          ? `WhatsApp reminders are sent automatically, with a limit: ${whatsapp.reason}`
          : `WhatsApp reminders cannot be sent automatically: ${whatsapp.reason || "no WhatsApp provider is set up on the server."}`,
      });
    }
  }
  return lines;
}

export function deliveryNotes(deliveries) {
  return (deliveries || [])
    .filter((d) => deliveryNote(d))
    .map((d) => `${channelName(d.channel)}: ${deliveryNote(d)}`);
}
