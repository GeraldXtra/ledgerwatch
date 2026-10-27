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
  if (wantEmail && email && !email.automatic) {
    lines.push({
      channel: "email",
      text: email.reason || "Email reminders cannot be sent automatically: email sending is not set up.",
    });
  }
  if (wantWhatsapp && whatsapp && (!whatsapp.automatic || whatsapp.reason)) {
    lines.push({
      channel: "whatsapp",
      text: whatsapp.reason || "WhatsApp reminders cannot be sent automatically: WhatsApp sending is not set up.",
    });
  }
  return lines;
}

export function deliveryNotes(deliveries) {
  return (deliveries || [])
    .filter((d) => deliveryNote(d))
    .map((d) => `${channelName(d.channel)}: ${deliveryNote(d)}`);
}
