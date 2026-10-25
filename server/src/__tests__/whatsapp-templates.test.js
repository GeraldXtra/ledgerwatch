const axios = require("axios");
const Module = require("module");

const twilioCalls = [];
const twilioPath = require.resolve("twilio");
const realTwilio = require.cache[twilioPath];
require.cache[twilioPath] = Object.assign(new Module(twilioPath), {
  id: twilioPath,
  filename: twilioPath,
  loaded: true,
  exports: () => ({
    messages: {
      create: async (message) => {
        twilioCalls.push(message);
        return { sid: `SM${twilioCalls.length}` };
      },
    },
  }),
});

const notify = require("../services/notify.service");

const ENV = [
  "WHATSAPP_PROVIDER",
  "WHATSAPP_CLOUD_TOKEN",
  "WHATSAPP_CLOUD_PHONE_ID",
  "WHATSAPP_CLOUD_TEMPLATE",
  "WHATSAPP_CLOUD_TEMPLATE_LANG",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_WHATSAPP_FROM",
  "TWILIO_WHATSAPP_CONTENT_SID",
];
let saved;

const TEMPLATE = {
  debtorName: "Ngozi Ventures",
  businessName: "Chidi Electrics",
  amount: "₦50,000.00",
  dueDate: "15 January 2031",
  payUrl: "https://www.useledgerwatch.co/pay/abc",
};

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  twilioCalls.length = 0;
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

afterAll(() => {
  if (realTwilio) require.cache[twilioPath] = realTwilio;
  else delete require.cache[twilioPath];
});

function cloud(extra = {}) {
  Object.assign(process.env, { WHATSAPP_PROVIDER: "cloud", WHATSAPP_CLOUD_TOKEN: "token", WHATSAPP_CLOUD_PHONE_ID: "123", ...extra });
}

describe("WhatsApp reminders through the Cloud API", () => {
  it("sends an approved template with the five reminder values when one is named", async () => {
    cloud({ WHATSAPP_CLOUD_TEMPLATE: "payment_reminder", WHATSAPP_CLOUD_TEMPLATE_LANG: "en_GB" });
    const post = vi.spyOn(axios, "post").mockResolvedValue({ data: { messages: [{ id: "wamid.1" }] } });
    const res = await notify.sendWhatsApp("08031234567", "free text", TEMPLATE);
    expect(res).toMatchObject({ ok: true, provider: "cloud", template: true, providerId: "wamid.1" });
    const [url, payload] = post.mock.calls[0];
    expect(url).toContain("/123/messages");
    expect(payload).toMatchObject({ type: "template", to: "2348031234567", template: { name: "payment_reminder", language: { code: "en_GB" } } });
    expect(payload.template.components[0].parameters.map((p) => p.text)).toEqual([
      "Ngozi Ventures",
      "Chidi Electrics",
      "₦50,000.00",
      "15 January 2031",
      "https://www.useledgerwatch.co/pay/abc",
    ]);
  });

  it("sends free text when no template is named, and says why a reply window refusal happened", async () => {
    cloud();
    vi.spyOn(axios, "post").mockRejectedValue({ response: { data: { error: { code: 131047, message: "Re-engagement message" } } } });
    const res = await notify.sendWhatsApp("08031234567", "free text", TEMPLATE);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/set WHATSAPP_CLOUD_TEMPLATE/);
    expect(notify.whatsappConfigStatus()).toMatchObject({ provider: "cloud", automatic: true, template: false });
    expect(notify.whatsappConfigStatus().reason).toMatch(/WHATSAPP_CLOUD_TEMPLATE/);
  });

  it("explains a template Meta does not recognise", async () => {
    cloud({ WHATSAPP_CLOUD_TEMPLATE: "missing_one" });
    vi.spyOn(axios, "post").mockRejectedValue({ response: { data: { error: { code: 132001, message: "Template name does not exist" } } } });
    const res = await notify.sendWhatsApp("08031234567", "free text", TEMPLATE);
    expect(res.error).toMatch(/could not use the template "missing_one"/);
  });

  it("flattens values WhatsApp would refuse inside a template", async () => {
    cloud({ WHATSAPP_CLOUD_TEMPLATE: "payment_reminder" });
    const post = vi.spyOn(axios, "post").mockResolvedValue({ data: { messages: [{ id: "wamid.2" }] } });
    await notify.sendWhatsApp("08031234567", "x", { ...TEMPLATE, debtorName: "Line one\nLine\ttwo      spaced", dueDate: "" });
    const texts = post.mock.calls[0][1].template.components[0].parameters.map((p) => p.text);
    expect(texts[0]).toBe("Line one Line two   spaced");
    expect(texts[3]).toBe("-");
  });
});

describe("WhatsApp reminders through Twilio", () => {
  it("uses the approved content template when one is named", async () => {
    Object.assign(process.env, {
      WHATSAPP_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC1",
      TWILIO_AUTH_TOKEN: "t",
      TWILIO_WHATSAPP_FROM: "whatsapp:+14155238886",
      TWILIO_WHATSAPP_CONTENT_SID: "HX123",
    });
    const res = await notify.sendWhatsApp("08031234567", "free text", TEMPLATE);
    expect(res).toMatchObject({ ok: true, provider: "twilio", template: true });
    expect(twilioCalls[0]).toMatchObject({ contentSid: "HX123", to: "whatsapp:+2348031234567" });
    expect(JSON.parse(twilioCalls[0].contentVariables)).toEqual({
      1: "Ngozi Ventures",
      2: "Chidi Electrics",
      3: "₦50,000.00",
      4: "15 January 2031",
      5: "https://www.useledgerwatch.co/pay/abc",
    });
  });
});
