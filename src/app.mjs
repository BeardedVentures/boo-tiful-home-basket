import {
  buildMailto,
  createPayload,
  deliverEntry,
  fingerprintEntry,
  isRecentDuplicate,
  validateEntry
} from "./entry-core.mjs?v=20261030a";

const config = window.BASKET_CONFIG || {};
const localPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname) && new URLSearchParams(window.location.search).get("preview") === "1";
const mockupMode = new URLSearchParams(window.location.search).get("mockup") === "1";
const storageKey = "bootiful-home-basket-entry";
const startedAt = Date.now();

const get = id => document.getElementById(id);
const form = get("entryForm");
const entryState = get("entryState");
const closedState = get("closedState");
const successState = get("successState");
const duplicateState = get("duplicateState");
const submitButton = get("submitButton");
const submitLabel = get("submitLabel");
const errorMessage = get("errorMessage");
const errorText = get("errorText");
const retryButton = get("retryButton");
const emailFallback = get("emailFallback");
let pendingEntry = null;
let isSubmitting = false;

get("eventLabel").textContent = config.eventLabel || "Prince of Peace Christian School Trunk-or-Treat";

if (localPreview && !mockupMode) {
  get("previewBanner").hidden = false;
}

if (config.entriesOpen || localPreview) {
  entryState.hidden = false;
} else {
  closedState.hidden = false;
}

function readForm() {
  return {
    fullName: get("fullName").value,
    email: get("email").value,
    phone: get("phone").value,
    address: get("address").value,
    website: get("website").value,
    startedAt
  };
}

function clearErrors() {
  ["fullName", "email", "phone", "address"].forEach(name => {
    get(`${name}Error`).textContent = "";
    const control = get(name);
    control.removeAttribute("aria-invalid");
    control.removeAttribute("aria-describedby");
  });
  errorMessage.hidden = true;
}

function showValidationErrors(errors) {
  const fields = ["fullName", "email", "phone", "address"];
  const firstInvalid = fields.find(name => errors[name]);
  fields.forEach(name => {
    if (!errors[name]) return;
    get(`${name}Error`).textContent = errors[name];
    get(name).setAttribute("aria-invalid", "true");
    get(name).setAttribute("aria-describedby", `${name}Error`);
  });
  get(firstInvalid)?.focus();
}

function setSubmitting(value) {
  isSubmitting = value;
  submitButton.disabled = value;
  submitLabel.textContent = value ? "Submitting…" : "Enter the drawing";
}

function readDuplicateRecord() {
  try { return JSON.parse(localStorage.getItem(storageKey)); } catch { return null; }
}

function saveDuplicateRecord(fingerprint) {
  try { localStorage.setItem(storageKey, JSON.stringify({ fingerprint, submittedAt: Date.now() })); } catch { /* Storage is optional. */ }
}

function showState(element) {
  entryState.hidden = true;
  successState.hidden = true;
  duplicateState.hidden = true;
  element.hidden = false;
  element.focus();
}

function showDeliveryError(entry, message) {
  pendingEntry = entry;
  errorText.textContent = message;
  errorMessage.hidden = false;
  if (config.notificationEmail) {
    emailFallback.href = buildMailto(entry, config.notificationEmail);
    emailFallback.hidden = false;
  }
  errorMessage.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function submit(entry) {
  if (isSubmitting) return;
  setSubmitting(true);
  errorMessage.hidden = true;

  try {
    const fingerprint = await fingerprintEntry(entry);
    if (isRecentDuplicate(readDuplicateRecord(), fingerprint, config)) {
      showState(duplicateState);
      return;
    }

    const payload = createPayload(entry);
    if (localPreview) {
      await new Promise(resolve => setTimeout(resolve, 320));
    } else {
      await deliverEntry(payload, {
        endpoint: config.formEndpoint,
        timeoutMs: config.requestTimeoutMs
      });
    }

    saveDuplicateRecord(fingerprint);
    form.reset();
    showState(successState);
  } catch (error) {
    const isConfigError = error?.message === "ENTRY_ENDPOINT_NOT_CONFIGURED";
    showDeliveryError(entry, isConfigError
      ? "Entries have not opened yet. Please check with Mallory."
      : "Please check your connection and try again.");
  } finally {
    setSubmitting(false);
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  clearErrors();
  const result = validateEntry(readForm(), {
    minimumFillSeconds: localPreview ? 0 : config.minimumFillSeconds
  });

  if (result.isLikelyBot) return;
  if (!result.valid) {
    showValidationErrors(result.errors);
    return;
  }

  pendingEntry = result.entry;
  submit(result.entry);
});

retryButton.addEventListener("click", () => {
  if (pendingEntry) submit(pendingEntry);
});
