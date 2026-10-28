const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function validateEntry(input, { minimumFillSeconds = 2, now = Date.now() } = {}) {
  const entry = {
    fullName: cleanText(input.fullName, 120),
    email: cleanText(input.email, 160).toLowerCase(),
    phone: cleanText(input.phone, 40),
    address: cleanText(input.address, 240),
    website: cleanText(input.website, 200),
    startedAt: Number(input.startedAt || 0)
  };

  const errors = {};
  if (entry.fullName.length < 2) errors.fullName = "Enter your full name.";
  if (!EMAIL_PATTERN.test(entry.email)) errors.email = "Enter a valid email address.";

  const phoneDigits = digitsOnly(entry.phone);
  if (phoneDigits.length < 10 || phoneDigits.length > 15) {
    errors.phone = "Enter a valid phone number.";
  }

  if (entry.address.length < 5) errors.address = "Enter your home address.";
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
