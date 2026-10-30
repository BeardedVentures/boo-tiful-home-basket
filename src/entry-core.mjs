const EMAIL_LOCAL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
const EMAIL_DOMAIN_LABEL_PATTERN = /^[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?$/i;
const HAS_LETTER = /\p{L}/u;
const STATE_NAME_TO_CODE = new Map([
  ["alabama", "AL"], ["alaska", "AK"], ["arizona", "AZ"], ["arkansas", "AR"],
  ["california", "CA"], ["colorado", "CO"], ["connecticut", "CT"], ["delaware", "DE"],
  ["florida", "FL"], ["georgia", "GA"], ["hawaii", "HI"], ["idaho", "ID"],
  ["illinois", "IL"], ["indiana", "IN"], ["iowa", "IA"], ["kansas", "KS"],
  ["kentucky", "KY"], ["louisiana", "LA"], ["maine", "ME"], ["maryland", "MD"],
  ["massachusetts", "MA"], ["michigan", "MI"], ["minnesota", "MN"], ["mississippi", "MS"],
  ["missouri", "MO"], ["montana", "MT"], ["nebraska", "NE"], ["nevada", "NV"],
  ["new hampshire", "NH"], ["new jersey", "NJ"], ["new mexico", "NM"], ["new york", "NY"],
  ["north carolina", "NC"], ["north dakota", "ND"], ["ohio", "OH"], ["oklahoma", "OK"],
  ["oregon", "OR"], ["pennsylvania", "PA"], ["rhode island", "RI"], ["south carolina", "SC"],
  ["south dakota", "SD"], ["tennessee", "TN"], ["texas", "TX"], ["utah", "UT"],
  ["vermont", "VT"], ["virginia", "VA"], ["washington", "WA"], ["west virginia", "WV"],
  ["wisconsin", "WI"], ["wyoming", "WY"], ["district of columbia", "DC"],
  ["puerto rico", "PR"], ["virgin islands", "VI"], ["guam", "GU"],
  ["american samoa", "AS"], ["northern mariana islands", "MP"]
]);
const STATE_CODES = new Set(STATE_NAME_TO_CODE.values());
const STATE_NAME_PATTERN = [...STATE_NAME_TO_CODE.keys()]
  .sort((left, right) => right.length - left.length)
  .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const STATE_OR_CODE_PATTERN = `(?:${[...STATE_CODES].join("|")}|${STATE_NAME_PATTERN})`;
const STREET_SUFFIX_PATTERN = "(?:Aly|Alley|Ave|Avenue|Blvd|Boulevard|Cir|Circle|Ct|Court|Cv|Cove|Cres|Crescent|Dr|Drive|Expy|Expressway|Hwy|Highway|Ln|Lane|Loop|Pkwy|Parkway|Pl|Place|Plz|Plaza|Rd|Road|Sq|Square|St|Street|Ter|Terrace|Trl|Trail|Way)";
const TRAILING_COUNTRY_PATTERN = /(?:,\s*|\s+)(?:USA|U\.?\s*S\.?\s*A\.?|US|U\.?\s*S\.?|United States(?: of America)?)\.?$/i;

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
  const address = normalizeAddress(value)
    .replace(TRAILING_COUNTRY_PATTERN, "")
    .replace(/,\s*$/, "")
    .trim();
  const stateZipPattern = new RegExp(`(?:,\\s*|\\s+)(${STATE_OR_CODE_PATTERN})\\s+(\\d{5}(?:-\\d{4})?)$`, "i");
  const stateZip = address.match(stateZipPattern);
  if (!stateZip) return false;

  const stateValue = stateZip[1].toLowerCase();
  const stateCode = stateValue.length === 2 ? stateValue.toUpperCase() : STATE_NAME_TO_CODE.get(stateValue);
  if (!stateCode || !STATE_CODES.has(stateCode)) return false;

  const remainder = address.slice(0, stateZip.index).replace(/,\s*$/, "").trim();
  let street;
  let city;
  if (remainder.includes(",")) {
    const parts = remainder.split(",").map(part => part.trim()).filter(Boolean);
    if (parts.length < 2) return false;
    city = parts.pop();
    street = parts.join(", ");
  } else {
    const noCommaPattern = new RegExp(
      `^(\\d+[A-Z]?(?:-\\d+[A-Z]?)?(?:\\s+1\\/2)?\\s+.+?\\b${STREET_SUFFIX_PATTERN}\\b(?:\\s+(?:Apt|Apartment|Unit|Suite|Ste|#)\\s*[A-Z0-9-]+)?)\\s+([\\p{L} .'-]+)$`,
      "iu"
    );
    const noComma = remainder.match(noCommaPattern);
    if (!noComma) return false;
    [, street, city] = noComma;
  }

  if (city.length < 2 || !HAS_LETTER.test(city) || !/^[\p{L} .'-]+$/u.test(city)) return false;
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
    errors.address = "Enter a complete address with street, city, state, and ZIP.";
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
