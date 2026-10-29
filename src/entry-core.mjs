const EMAIL_LOCAL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
const EMAIL_DOMAIN_LABEL_PATTERN = /^[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?$/i;
const HAS_LETTER = /\p{L}/u;
const STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "PR", "VI", "GU", "AS", "MP"
]);

export function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function isValidEmail(value) {
  const email = cleanText(value, 160).toLowerCase();
  if (!email || email.length > 160 || /\s/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;

  const [local, domain] = parts;
  if (!local || local.length > 64 || !EMAIL_LOCAL_PATTERN.test(local)) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (!domain || domain.length > 253 || domain.startsWith(".") || domain.endsWith(".")) return false;

  const labels = domain.split(".");
  if (labels.length < 2 || labels.some(label => !EMAIL_DOMAIN_LABEL_PATTERN.test(label))) return false;
  const topLevelDomain = labels.at(-1);
  return /^[A-Z]{2,63}$/i.test(topLevelDomain) || /^XN--[A-Z0-9-]{2,59}$/i.test(topLevelDomain);
}

export function normalizeUsPhone(value) {
  const raw = cleanText(value, 40);
  if (!raw || !/^\+?[0-9().\-\s]+$/.test(raw)) return null;

  let digits = digitsOnly(raw);
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;

  const areaCode = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);
  if (!/^[2-9]\d{2}$/.test(areaCode) || !/^[2-9]\d{2}$/.test(exchange)) return null;
  if (areaCode.endsWith("11") || exchange.endsWith("11")) return null;
  if (/^(\d)\1{9}$/.test(digits)) return null;

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function normalizeAddress(value) {
  return cleanText(value, 240)
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ");
}

export function isValidStreetAddress(value) {
  const address = normalizeAddress(value);
  const parts = address.split(",").map(part => part.trim()).filter(Boolean);
  if (parts.length < 3) return false;

  const stateZip = parts.at(-1).match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (!stateZip || !STATE_CODES.has(stateZip[1].toUpperCase())) return false;

  const city = parts.at(-2);
  if (city.length < 2 || !HAS_LETTER.test(city) || !/^[\p{L} .'-]+$/u.test(city)) return false;

  const street = parts.slice(0, -2).join(", ");
  if (/^P\.?\s*O\.?\s+BOX\b/i.test(street)) return false;
  const streetMatch = street.match(/^\d+[A-Z]?(?:-\d+[A-Z]?)?(?:\s+1\/2)?\s+(.+)$/i);
  if (!streetMatch || !HAS_LETTER.test(streetMatch[1])) return false;
  return true;
}

export function validateEntry(input, { minimumFillSeconds = 2, now = Date.now() } = {}) {
  const entry = {
    fullName: cleanText(input.fullName, 120),
    email: cleanText(input.email, 160).toLowerCase(),
    phone: cleanText(input.phone, 40),
    address: normalizeAddress(input.address),
    website: cleanText(input.website, 200),
    startedAt: Number(input.startedAt || 0)
  };

  const errors = {};
  if (entry.fullName.length < 2) errors.fullName = "Enter your full name.";
  if (!isValidEmail(entry.email)) errors.email = "Enter a valid email address.";

  const normalizedPhone = normalizeUsPhone(entry.phone);
  if (!normalizedPhone) {
    errors.phone = "Enter a valid 10-digit US phone number.";
  } else {
    entry.phone = normalizedPhone;
  }

  if (!isValidStreetAddress(entry.address)) {
    errors.address = "Use street, city, state, and ZIP (for example: 123 Main St, Dallas, TX 75201).";
  }
  const elapsedSeconds = entry.startedAt ? (now - entry.startedAt) / 1000 : 0;
  const isLikelyBot = Boolean(entry.website) || elapsedSeconds < minimumFillSeconds;

  return { entry, errors, isLikelyBot, valid: Object.keys(errors).length === 0 && !isLikelyBot };
}

export function createIdempotencyKey(randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)) {
  if (randomUUID) return randomUUID();
  return `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createPayload(entry, { idempotencyKey, submittedAt = new Date().toISOString() } = {}) {
  return {
    fullName: entry.fullName,
    email: entry.email,
    phone: entry.phone,
    address: entry.address,
    website: entry.website,
    source: "boo-tiful-home-basket-qr",
    idempotency_key: idempotencyKey || createIdempotencyKey(),
    submitted_at: submittedAt
  };
}

function stableIdentity(entry) {
  return [entry.email.toLowerCase(), digitsOnly(entry.phone), entry.address.toLowerCase().replace(/\s+/g, " ")].join("|");
}

export async function fingerprintEntry(entry, cryptoImpl = globalThis.crypto) {
  const identity = stableIdentity(entry);
  if (cryptoImpl?.subtle && globalThis.TextEncoder) {
    const digest = await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(identity));
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  }

  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${(hash >>> 0).toString(16)}`;
}

export function isRecentDuplicate(record, fingerprint, { now = Date.now(), duplicateWindowHours = 24 } = {}) {
  if (!record || record.fingerprint !== fingerprint) return false;
  const age = now - Number(record.submittedAt || 0);
  return age >= 0 && age < duplicateWindowHours * 60 * 60 * 1000;
}

export async function deliverEntry(payload, {
  endpoint,
  fetchImpl = globalThis.fetch,
  timeoutMs = 12000,
  AbortControllerImpl = globalThis.AbortController
} = {}) {
  if (!endpoint) throw new Error("ENTRY_ENDPOINT_NOT_CONFIGURED");
  if (typeof fetchImpl !== "function") throw new Error("FETCH_UNAVAILABLE");

  const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller?.signal
    });
    if (!response.ok) throw new Error(`ENTRY_DELIVERY_FAILED_${response.status}`);
    return response;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function buildMailto(entry, destination) {
  const subject = `Boo-tiful Home Basket Entry: ${entry.fullName}`;
  const body = [
    "Boo-tiful Home Basket giveaway entry:",
    "",
    `Name: ${entry.fullName}`,
    `Email: ${entry.email}`,
    `Phone: ${entry.phone}`,
    `Address: ${entry.address}`
  ].join("\n");
  return `mailto:${destination}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
