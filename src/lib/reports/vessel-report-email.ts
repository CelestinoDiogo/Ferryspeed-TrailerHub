import "server-only";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const MAX_BODY_LENGTH = 120_000;
const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export class VesselReportEmailError extends Error {
  status: number;
  kind: "configuration" | "invalid_request" | "provider";

  constructor(message: string, status: number, kind: "configuration" | "invalid_request" | "provider") {
    super(message);
    this.name = "VesselReportEmailError";
    this.status = status;
    this.kind = kind;
  }
}

type SendVesselReportEmailInput = {
  subject: string;
  body: string;
  recipients: string[];
  cc: string[];
  vesselName?: string | null;
  voyageReference?: string | null;
  reportDate?: string | null;
  metrics?: {
    expectedTrailers?: number;
    arrivedTrailers?: number;
    inspectedTrailers?: number;
    pendingInspections?: number;
    damagedTrailers?: number;
    temperatureAlertTrailers?: number;
    notDischargedTrailers?: number;
  };
};

const sanitizeHeader = (value: string) => {
  const normalized = value.replace(/[\r\n]/g, " ").trim();
  if (!normalized) {
    return "";
  }

  if (/[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new VesselReportEmailError("Invalid header content.", 400, "invalid_request");
  }

  return normalized;
};

const normalizeAndValidateEmails = (values: string[]) => {
  const deduped = new Set<string>();

  for (const rawValue of values) {
    const value = rawValue.trim().toLowerCase();
    if (!value) {
      continue;
    }

    if (!EMAIL_PATTERN.test(value)) {
      throw new VesselReportEmailError("One or more recipient email addresses are invalid.", 400, "invalid_request");
    }

    deduped.add(value);
  }

  return [...deduped];
};

const getGmailConfig = () => {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const fromEmailRaw = process.env.GMAIL_FROM_EMAIL;
  const fromNameRaw = process.env.GMAIL_FROM_NAME;

  if (!clientId || !clientSecret || !refreshToken || !fromEmailRaw || !fromNameRaw) {
    throw new VesselReportEmailError("Email delivery is not configured yet.", 412, "configuration");
  }

  const fromEmail = fromEmailRaw.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(fromEmail)) {
    throw new VesselReportEmailError("Email delivery is not configured yet.", 412, "configuration");
  }

  const fromName = sanitizeHeader(fromNameRaw);
  if (!fromName) {
    throw new VesselReportEmailError("Email delivery is not configured yet.", 412, "configuration");
  }

  return {
    clientId,
    clientSecret,
    refreshToken,
    fromEmail,
    fromName,
  };
};

type GmailTokenResponse = {
  access_token?: string;
  scope?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

const requestGmailAccessToken = async () => {
  const { clientId, clientSecret, refreshToken } = getGmailConfig();

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  let response: Response;
  try {
    response = await fetch(GMAIL_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } catch {
    throw new VesselReportEmailError("The report could not be sent. Please try again.", 502, "provider");
  }

  let payload: GmailTokenResponse = {};
  try {
    payload = (await response.json()) as GmailTokenResponse;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    if (payload.error === "invalid_grant") {
      throw new VesselReportEmailError("Email delivery is not configured yet.", 412, "configuration");
    }

    throw new VesselReportEmailError("The report could not be sent. Please try again.", 502, "provider");
  }

  if (!payload.access_token) {
    throw new VesselReportEmailError("The report could not be sent. Please try again.", 502, "provider");
  }

  if (payload.scope && !payload.scope.split(/\s+/).includes(GMAIL_SEND_SCOPE)) {
    throw new VesselReportEmailError("Email delivery is not configured yet.", 412, "configuration");
  }

  return payload.access_token;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildSummaryMetricRows = (input: SendVesselReportEmailInput) => {
  const metrics = input.metrics;
  if (!metrics) {
    return "";
  }

  const items = [
    ["Expected trailers", metrics.expectedTrailers],
    ["Arrived trailers", metrics.arrivedTrailers],
    ["Inspected trailers", metrics.inspectedTrailers],
    ["Pending inspections", metrics.pendingInspections],
    ["Damage alerts", metrics.damagedTrailers],
    ["Temperature alerts", metrics.temperatureAlertTrailers],
    ["Not discharged", metrics.notDischargedTrailers],
  ].filter((item) => typeof item[1] === "number") as Array<[string, number]>;

  if (items.length === 0) {
    return "";
  }

  return items
    .map(([label, value]) => `<tr><td style=\"padding:6px 10px;border:1px solid #d1d5db;font-weight:600;\">${escapeHtml(label)}</td><td style=\"padding:6px 10px;border:1px solid #d1d5db;\">${value}</td></tr>`)
    .join("");
};

const splitSections = (body: string) => {
  const lines = body.split(/\r?\n/);
  const sections: Record<string, string[]> = {};
  const knownHeadings = new Set([
    "Operation Overview",
    "Trailer Discharge Summary",
    "Inspection Summary",
    "Damage Findings",
    "Temperature Findings",
    "Outstanding Items",
    "Final Operational Status",
  ]);
  let current = "Report";
  sections[current] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (knownHeadings.has(trimmed)) {
      current = trimmed;
      if (!sections[current]) {
        sections[current] = [];
      }
      continue;
    }

    sections[current].push(line);
  }

  return sections;
};

const buildHtmlBody = (input: SendVesselReportEmailInput) => {
  const vesselName = escapeHtml((input.vesselName ?? "Not specified").trim() || "Not specified");
  const voyage = escapeHtml((input.voyageReference ?? "Not specified").trim() || "Not specified");
  const reportDate = escapeHtml((input.reportDate ?? new Date().toLocaleString()).trim() || new Date().toLocaleString());
  const sections = splitSections(input.body);
  const metricsRows = buildSummaryMetricRows(input);

  const sectionOrder = [
    "Operation Overview",
    "Trailer Discharge Summary",
    "Inspection Summary",
    "Damage Findings",
    "Temperature Findings",
    "Outstanding Items",
    "Final Operational Status",
  ];

  const renderedSections = sectionOrder
    .filter((name) => (sections[name] ?? []).join("\n").trim().length > 0)
    .map((name) => {
      const content = (sections[name] ?? []).join("\n").trim();
      return `<section style=\"margin-top:18px;\"><h3 style=\"margin:0 0 8px 0;font-size:16px;color:#0f172a;\">${escapeHtml(name)}</h3><pre style=\"margin:0;white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2937;\">${escapeHtml(content)}</pre></section>`;
    })
    .join("");

  return [
    "<!doctype html>",
    "<html>",
    "<body style=\"margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;\">",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:840px;margin:0 auto;background:#ffffff;border:1px solid #d1d5db;border-radius:12px;overflow:hidden;\">",
    "<tr><td style=\"padding:20px 24px;background:#0f172a;color:#ffffff;\"><p style=\"margin:0;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;\">Ferryspeed TrailerHub</p><h1 style=\"margin:8px 0 0 0;font-size:22px;\">Vessel Operations Report</h1></td></tr>",
    `<tr><td style=\"padding:18px 24px;\"><p style=\"margin:0 0 8px 0;\"><strong>Vessel:</strong> ${vesselName}</p><p style=\"margin:0 0 8px 0;\"><strong>Voyage:</strong> ${voyage}</p><p style=\"margin:0;\"><strong>Report Date:</strong> ${reportDate}</p></td></tr>`,
    metricsRows
      ? `<tr><td style=\"padding:0 24px 8px 24px;\"><h2 style=\"font-size:16px;margin:0 0 10px 0;color:#0f172a;\">Operational Metrics</h2><table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;width:100%;font-size:14px;color:#1f2937;\">${metricsRows}</table></td></tr>`
      : "",
    `<tr><td style=\"padding:8px 24px 24px 24px;\">${renderedSections || `<pre style=\"margin:0;white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2937;\">${escapeHtml(input.body)}</pre>`}</td></tr>`,
    "</table>",
    "</body>",
    "</html>",
  ].join("");
};

const toBase64Url = (value: string) => {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const buildMimeMessage = (input: SendVesselReportEmailInput) => {
  const { fromEmail, fromName } = getGmailConfig();

  const to = normalizeAndValidateEmails(input.recipients);
  const cc = normalizeAndValidateEmails(input.cc);

  if (to.length === 0) {
    throw new VesselReportEmailError("Add at least one valid recipient before sending this report.", 400, "invalid_request");
  }

  const subject = sanitizeHeader(input.subject);
  if (!subject) {
    throw new VesselReportEmailError("Subject cannot be empty.", 400, "invalid_request");
  }

  const plainBody = input.body.replace(/\r/g, "").trim();
  if (!plainBody) {
    throw new VesselReportEmailError("Report body cannot be empty.", 400, "invalid_request");
  }

  if (plainBody.length > MAX_BODY_LENGTH) {
    throw new VesselReportEmailError("Report content is too large to send by email.", 413, "invalid_request");
  }

  const boundary = `ferryspeed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const htmlBody = buildHtmlBody(input);

  const headers = [
    `From: ${fromName} <${fromEmail}>`,
    `To: ${to.join(", ")}`,
    cc.length > 0 ? `Cc: ${cc.join(", ")}` : null,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary=\"${boundary}\"`,
  ].filter(Boolean);

  const mime = [
    ...headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    plainBody,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    htmlBody,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return {
    raw: toBase64Url(mime),
    recipients: to,
    cc,
    subject,
    body: plainBody,
  };
};

type GmailSendResponse = {
  id?: string;
  threadId?: string;
};

export async function sendVesselReportEmail(input: SendVesselReportEmailInput) {
  const accessToken = await requestGmailAccessToken();
  const built = buildMimeMessage(input);

  let response: Response;
  try {
    response = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: built.raw }),
    });
  } catch {
    throw new VesselReportEmailError("The report could not be sent. Please try again.", 502, "provider");
  }

  if (!response.ok) {
    throw new VesselReportEmailError("The report could not be sent. Please try again.", 502, "provider");
  }

  let payload: GmailSendResponse = {};
  try {
    payload = (await response.json()) as GmailSendResponse;
  } catch {
    payload = {};
  }

  return {
    gmailMessageId: payload.id ?? null,
    recipients: built.recipients,
    cc: built.cc,
    subject: built.subject,
    body: built.body,
  };
}
