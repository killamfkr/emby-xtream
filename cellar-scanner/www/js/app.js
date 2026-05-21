/**
 * Cellar Scanner — camera barcode + OCR date sticker + CSV export.
 * Dependencies loaded from esm.sh (requires network on first load).
 */

import { BrowserMultiFormatReader } from "https://esm.sh/@zxing/browser@0.1.5";
import Tesseract from "https://esm.sh/tesseract.js@5.1.0";

const $ = (id) => document.getElementById(id);

const previewVideo = $("previewVideo");
const videoWrap = $("videoWrap");
const cameraSelect = $("cameraSelect");
const camStatus = $("camStatus");
const fieldBarcode = $("fieldBarcode");
const fieldMfgDate = $("fieldMfgDate");
const fieldBrand = $("fieldBrand");
const fieldBlend = $("fieldBlend");
const fieldQty = $("fieldQty");
const fieldSize = $("fieldSize");
const fieldNotes = $("fieldNotes");
const cellarBody = $("cellarBody");
const emptyHint = $("emptyHint");
const ocrProgress = $("ocrProgress");
const dateCandidates = $("dateCandidates");
const cellarBarcodeMatches = $("cellarBarcodeMatches");

let torchOn = false;

let mediaStream = null;
let barcodeReader = null;
let barcodeScanning = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let cellarMatchTimer = null;

const STORAGE_KEY = "cellar-scanner-rows-v1";

/** @type {Array<{id:string,brand:string,blend:string,barcode:string,mfgDate:string,qty:number,size:string,notes:string}>} */
let rows = [];

function loadRows() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) rows = JSON.parse(raw);
  } catch {
    rows = [];
  }
}

function saveRows() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

function setCamStatus(msg, kind) {
  camStatus.textContent = msg || "";
  camStatus.classList.remove("error", "ok");
  if (kind === "error") camStatus.classList.add("error");
  if (kind === "ok") camStatus.classList.add("ok");
}

/** Prefer rear / “environment” cameras in the dropdown (labels appear after permission). */
function sortVideoInputs(devices) {
  const copy = [...devices];
  const score = (d) => {
    const l = (d.label || "").toLowerCase();
    if (
      /\b(back|rear|world|environment|wide|ultra|telephoto)\b/.test(l) ||
      l.includes("facing back")
    ) {
      return 0;
    }
    if (/\b(front|user|selfie|face|iris)\b/.test(l) || l.includes("facing front")) {
      return 2;
    }
    return 1;
  };
  copy.sort((a, b) => score(a) - score(b) || (a.label || "").localeCompare(b.label || ""));
  return copy;
}

function fillCameraSelect(devices) {
  cameraSelect.innerHTML = "";
  if (!devices.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No camera found";
    cameraSelect.appendChild(opt);
    return;
  }
  devices.forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Camera ${i + 1}`;
    cameraSelect.appendChild(opt);
  });
}

async function populateCameras() {
  try {
    const devices = await BrowserMultiFormatReader.listVideoInputDevices();
    fillCameraSelect(sortVideoInputs(devices));
  } catch (e) {
    setCamStatus("Could not list cameras: " + (e.message || String(e)), "error");
  }
}

/** After the stream is running, labels are available — rebuild list and match the active lens. */
async function syncCameraDropdownToStream() {
  const track = mediaStream?.getVideoTracks?.()?.[0];
  if (!track) return;
  const currentId = track.getSettings?.()?.deviceId;
  try {
    const devices = await BrowserMultiFormatReader.listVideoInputDevices();
    if (!devices.length) return;
    const sorted = sortVideoInputs(devices);
    fillCameraSelect(sorted);
    if (currentId && [...cameraSelect.options].some((o) => o.value === currentId)) {
      cameraSelect.value = currentId;
    }
  } catch {
    /* keep existing dropdown */
  }
}

function cameraHintForError(err) {
  const name = err && err.name;
  if (typeof location !== "undefined" && !window.isSecureContext) {
    return " Open this app over https:// or http://localhost — insecure http pages cannot use the camera on most phones.";
  }
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return " Allow camera permission for this site in browser settings.";
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return " Try another camera in the list, or leave the default camera selected.";
  }
  return "";
}

async function startCamera() {
  stopBarcodeScan();
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setCamStatus("Camera not supported in this browser or WebView.", "error");
    refreshCaptureButtons();
    $("btnOcrDate").disabled = true;
    return;
  }

  if (!window.isSecureContext) {
    setCamStatus(
      "Camera needs a secure page (https:// or http://localhost). This URL is not a secure context.",
      "error"
    );
    refreshCaptureButtons();
    $("btnOcrDate").disabled = true;
    return;
  }

  const deviceId = cameraSelect.value || undefined;

  const attempts = [];
  if (deviceId) {
    attempts.push({ video: { deviceId: { ideal: deviceId } }, audio: false });
    attempts.push({ video: { deviceId: { exact: deviceId } }, audio: false });
  }
  attempts.push({ video: { facingMode: { ideal: "environment" } }, audio: false });
  attempts.push({ video: { facingMode: { ideal: "user" } }, audio: false });
  attempts.push({ video: true, audio: false });

  let lastErr = null;
  for (const constraints of attempts) {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        break;
      }
      if (e.name === "OverconstrainedError" || e.name === "ConstraintNotSatisfiedError") {
        continue;
      }
      break;
    }
  }

  if (!mediaStream) {
    const base = lastErr ? lastErr.message || String(lastErr) : "Unknown error";
    setCamStatus("Camera failed: " + base + cameraHintForError(lastErr), "error");
    refreshCaptureButtons();
    $("btnOcrDate").disabled = true;
    return;
  }

  try {
    previewVideo.srcObject = mediaStream;
    await previewVideo.play();
    await syncCameraDropdownToStream();
    setCamStatus("Camera on.", "ok");
    refreshCaptureButtons();
    $("btnOcrDate").disabled = false;
  } catch (e) {
    setCamStatus("Camera preview failed: " + (e.message || String(e)), "error");
    refreshCaptureButtons();
    $("btnOcrDate").disabled = true;
  }
}

function stopCamera() {
  stopBarcodeScan();
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  previewVideo.srcObject = null;
  setCamStatus("Camera stopped.");
  refreshCaptureButtons();
  $("btnOcrDate").disabled = true;
}

function setScanHudVisible(visible) {
  const hud = $("scanHud");
  if (!hud) return;
  if (visible) hud.removeAttribute("hidden");
  else hud.setAttribute("hidden", "");
}

function closeScannerShell() {
  document.body.classList.remove("scanner-focus");
  setScanHudVisible(false);
  if (torchOn) {
    torchOn = false;
    applyTorch(false);
  }
}

function applyTorch(on) {
  const track = mediaStream?.getVideoTracks?.()?.[0];
  if (!track?.applyConstraints) return;
  try {
    track.applyConstraints({ advanced: [{ torch: !!on }] });
  } catch {
    /* ignore */
  }
}

function refreshTorchButton() {
  const btn = $("btnTorch");
  if (!btn) return;
  const track = mediaStream?.getVideoTracks?.()?.[0];
  const caps = track?.getCapabilities?.();
  const supported =
    !!caps &&
    (caps.torch === true ||
      (Array.isArray(caps.fillLightMode) && caps.fillLightMode.some((m) => /flash|torch/i.test(String(m)))));
  btn.hidden = !supported;
  btn.textContent = torchOn ? "Light off" : "Light";
}

function refreshCaptureButtons() {
  const ready = !!mediaStream;
  const openBtn = $("btnOpenScanner");
  if (openBtn) openBtn.disabled = !ready;
  $("btnScanBarcode").disabled = !ready;
  $("btnOcrDate").disabled = !ready;
  $("btnStopBarcode").disabled = true;
}

function stopBarcodeScan() {
  barcodeScanning = false;
  videoWrap.classList.remove("scanning");
  if (barcodeReader) {
    try {
      barcodeReader.reset();
    } catch {
      /* ignore */
    }
    barcodeReader = null;
  }
  closeScannerShell();
  refreshCaptureButtons();
}

/** In-memory cache for Open Food Facts responses (GTIN → product or null). */
const offProductCache = new Map();

function normalizeGtin(barcode) {
  const d = String(barcode || "").replace(/\D/g, "");
  if (d.length < 8) return "";
  if (d.length === 12) return `0${d}`;
  if (d.length > 14) return d.slice(0, 14);
  return d;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function findCellarRowsByNormalizedBarcode(barcode) {
  const code = normalizeGtin(barcode);
  if (!code || code.length < 8) return [];
  return rows.filter((r) => normalizeGtin(r.barcode) === code);
}

function renderCellarMatches() {
  const el = cellarBarcodeMatches;
  if (!el) return;
  const matches = findCellarRowsByNormalizedBarcode(fieldBarcode.value.trim());
  if (!matches.length) {
    el.setAttribute("hidden", "");
    el.innerHTML = "";
    return;
  }
  el.removeAttribute("hidden");
  const parts = matches.map((r) => {
    const qty = Math.max(1, parseInt(String(r.qty), 10) || 1);
    const date = (r.mfgDate || "").trim();
    const size = (r.size || "").trim();
    const notes = (r.notes || "").trim();
    const bits = [`qty ${qty}`];
    if (date) bits.push(date);
    if (size) bits.push(size);
    const sub = notes ? `${bits.join(" · ")} — ${notes}` : bits.join(" · ");
    return `<div class="cellar-match-card" role="listitem">
      <div class="cellar-match-card__meta"><strong>${escapeHtml(r.brand)}</strong> — <strong>${escapeHtml(r.blend)}</strong><span class="cellar-match-card__sub">${escapeHtml(sub)}</span></div>
      <button type="button" class="primary" data-apply-cellar="${escapeHtml(r.id)}">Use this tin</button>
    </div>`;
  });
  el.innerHTML = `<p class="cellar-matches__title font-serif">Same code in your list</p>
    <p class="cellar-matches__lede">These rows use the same normalized UPC/EAN. Tap <strong>Use this tin</strong> to copy brand, blend, size, notes, and quantity from that row. Adjust the date if this is a new tin.</p>
    <div class="cellar-matches__list" role="list">${parts.join("")}</div>`;
}

function applyCellarRowToForm(id) {
  const r = rows.find((x) => x.id === id);
  if (!r) return;
  fieldBrand.value = r.brand || "";
  fieldBlend.value = r.blend || "";
  fieldSize.value = r.size || "";
  fieldNotes.value = r.notes || "";
  if (!fieldMfgDate.value.trim() && r.mfgDate) {
    fieldMfgDate.value = r.mfgDate;
  }
  fieldQty.value = String(Math.max(1, parseInt(String(r.qty), 10) || 1));
  setCamStatus("Applied from your cellar list — update date or qty if needed, then add.", "ok");
  fieldBlend.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function scheduleCellarMatchRefresh() {
  if (cellarMatchTimer) clearTimeout(cellarMatchTimer);
  cellarMatchTimer = setTimeout(() => {
    cellarMatchTimer = null;
    renderCellarMatches();
  }, 250);
}

function fillFromOffProduct(p) {
  if (!p) return;
  const trim = (s) => String(s || "").trim();

  if (!fieldBrand.value.trim()) {
    const b = trim(p.brands);
    if (b) {
      fieldBrand.value = b.split(/[,;·\/|]/)[0].trim();
    } else if (Array.isArray(p.brands_tags) && p.brands_tags.length) {
      const tag = String(p.brands_tags[0]);
      const core = tag.replace(/^[a-z]{2}:/i, "").replace(/-/g, " ");
      fieldBrand.value = core.replace(/\b\w/g, (ch) => ch.toUpperCase());
    }
  }

  if (!fieldBlend.value.trim()) {
    fieldBlend.value =
      trim(p.product_name) ||
      trim(p.generic_name) ||
      trim(p.abbreviated_product_name) ||
      "";
  }

  if (!fieldSize.value.trim()) {
    const q = trim(p.quantity);
    if (q) fieldSize.value = q;
  }
}

async function applyBarcodeLookup(barcode) {
  try {
    const code = normalizeGtin(barcode);
    if (!code) {
      setCamStatus("Enter at least 8 digits to look up a UPC/EAN.", "error");
      return;
    }
    if (offProductCache.has(code)) {
      const cached = offProductCache.get(code);
      if (!cached) {
        setCamStatus(`No Open Food Facts match for ${code}. Enter brand/blend manually.`, "ok");
        return;
      }
      fillFromOffProduct(cached);
      setCamStatus("Filled from cache — still verify, especially for pipe tobacco.", "ok");
      return;
    }

    try {
      const url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`;
      const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
      if (!res.ok) {
        setCamStatus(`UPC lookup failed (HTTP ${res.status}).`, "error");
        return;
      }
      const data = await res.json();
      if (data.status !== 1 || !data.product) {
        offProductCache.set(code, null);
        setCamStatus(`No Open Food Facts match for ${code}. Enter brand/blend manually.`, "ok");
        return;
      }
      offProductCache.set(code, data.product);
      fillFromOffProduct(data.product);
      setCamStatus("Filled from Open Food Facts — verify (many pipe tins are not listed).", "ok");
    } catch (e) {
      setCamStatus("UPC lookup failed: " + (e?.message || String(e)), "error");
    }
  } finally {
    renderCellarMatches();
  }
}

function onBarcodeScanned(raw) {
  const digits = String(raw || "").replace(/\s/g, "");
  if (!digits) return;
  fieldBarcode.value = digits;
  stopBarcodeScan();
  refreshCaptureButtons();
  setCamStatus("Barcode read: " + digits + " — looking up…", "ok");
  try {
    navigator.vibrate?.(35);
  } catch {
    /* ignore */
  }
  void applyBarcodeLookup(digits);
}

async function runNativeBarcodeLoop() {
  if (typeof BarcodeDetector === "undefined") {
    return { ranNative: false, found: false, userStopped: false };
  }
  let supported;
  try {
    supported = await BarcodeDetector.getSupportedFormats();
  } catch {
    return { ranNative: false, found: false, userStopped: false };
  }
  const want = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];
  const formats = want.filter((f) => supported.includes(f));
  if (!formats.length) {
    return { ranNative: false, found: false, userStopped: false };
  }
  let detector;
  try {
    detector = new BarcodeDetector({ formats });
  } catch {
    return { ranNative: false, found: false, userStopped: false };
  }

  setCamStatus("Native scanner — keep the barcode inside the corners.", "ok");
  const nativeStarted = Date.now();
  const nativeTimeoutMs = 4500;
  while (barcodeScanning) {
    try {
      if (previewVideo.readyState >= 2 && previewVideo.videoWidth > 0) {
        const codes = await detector.detect(previewVideo);
        if (codes && codes.length) {
          const raw = codes[0].rawValue || codes[0].value || "";
          if (raw) {
            onBarcodeScanned(raw);
            return { ranNative: true, found: true, userStopped: false };
          }
        }
      }
    } catch {
      /* ignore per-frame */
    }
    if (Date.now() - nativeStarted >= nativeTimeoutMs) {
      return { ranNative: true, found: false, userStopped: false };
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  return { ranNative: true, found: false, userStopped: true };
}

function startZxingBarcodeScan() {
  barcodeReader = new BrowserMultiFormatReader(undefined, {
    tryPlayVideoTimeout: 9000,
    delayBetweenScanAttempts: 75,
  });
  barcodeReader
    .decodeFromVideoElement(previewVideo, (result) => {
      if (!barcodeScanning) return;
      if (result) {
        onBarcodeScanned(result.getText());
      }
    })
    .catch((e) => {
      if (!barcodeScanning) return;
      setCamStatus("Scanner failed: " + (e?.message || String(e)), "error");
      stopBarcodeScan();
    });
}

async function startBarcodeEngine({ useFullscreen = false } = {}) {
  if (!mediaStream) {
    setCamStatus("Start the camera first.", "error");
    return;
  }
  if (previewVideo.readyState < 2) {
    setCamStatus("Wait for the preview to start, then try scanning again.", "error");
    return;
  }

  stopBarcodeScan();
  barcodeScanning = true;
  videoWrap.classList.add("scanning");
  $("btnStopBarcode").disabled = false;
  $("btnScanBarcode").disabled = true;
  const openBtn = $("btnOpenScanner");
  if (openBtn) openBtn.disabled = true;

  if (useFullscreen) {
    document.body.classList.add("scanner-focus");
    setScanHudVisible(true);
    refreshTorchButton();
  }

  const native = await runNativeBarcodeLoop();
  if (!barcodeScanning) {
    return;
  }
  if (native.found) {
    return;
  }
  if (native.ranNative && native.userStopped) {
    return;
  }

  setCamStatus("Falling back to ZXing… same preview stream.", "ok");
  startZxingBarcodeScan();
}

async function openTinScanner() {
  if (!window.isSecureContext) {
    setCamStatus("Camera needs https:// or http://localhost.", "error");
    return;
  }
  if (!mediaStream) {
    await startCamera();
  }
  if (!mediaStream) return;
  await startBarcodeEngine({ useFullscreen: true });
}


function startBarcodeScan() {
  void startBarcodeEngine({ useFullscreen: false });
}

/**
 * Extract human-readable date candidates from noisy OCR text.
 * @param {string} text
 * @returns {string[]}
 */
function extractDateCandidates(text) {
  const found = new Set();
  const t = text.replace(/\|/g, "l");

  const iso = /\b(20\d{2}|19\d{2})[.\-/](0?[1-9]|1[0-2])[.\-/](0?[1-9]|[12]\d|3[01])\b/g;
  let m;
  while ((m = iso.exec(t)) !== null) {
    const y = m[1].padStart(4, "0");
    const mo = m[2].padStart(2, "0");
    const d = m[3].padStart(2, "0");
    found.add(`${y}-${mo}-${d}`);
  }

  const dmy = /\b(0?[1-9]|[12]\d|3[01])[.\-/](0?[1-9]|1[0-2])[.\-/](\d{2}|\d{4})\b/g;
  while ((m = dmy.exec(t)) !== null) {
    let d = parseInt(m[1], 10);
    let mo = parseInt(m[2], 10);
    let y = parseInt(m[3], 10);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      found.add(`${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
  }

  const mdy = /\b(0?[1-9]|1[0-2])[.\-/](0?[1-9]|[12]\d|3[01])[.\-/](\d{2}|\d{4})\b/g;
  while ((m = mdy.exec(t)) !== null) {
    let mo = parseInt(m[1], 10);
    let d = parseInt(m[2], 10);
    let y = parseInt(m[3], 10);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      found.add(`${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
  }

  const monYear = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s.\-]+(20\d{2}|19\d{2})\b/gi;
  while ((m = monYear.exec(t)) !== null) {
    found.add(`${m[1].slice(0, 1).toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`);
  }

  const six = /\b(\d{2})(\d{2})(\d{2})\b/g;
  while ((m = six.exec(t)) !== null) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const c = parseInt(m[3], 10);
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31 && c <= 99) {
      const y = c >= 70 ? 1900 + c : 2000 + c;
      found.add(`${y}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")} (parsed MMDDYY)`);
    }
  }

  return [...found].slice(0, 12);
}

function renderDateCandidates(list) {
  dateCandidates.innerHTML = "";
  list.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = s;
    b.addEventListener("click", () => {
      fieldMfgDate.value = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
    });
    dateCandidates.appendChild(b);
  });
}

async function captureStickerOcr() {
  if (!mediaStream || previewVideo.readyState < 2) {
    ocrProgress.textContent = "Start the camera and wait for preview first.";
    ocrProgress.classList.add("error");
    return;
  }
  ocrProgress.classList.remove("error");
  ocrProgress.textContent = "Reading sticker…";
  dateCandidates.innerHTML = "";

  const w = previewVideo.videoWidth;
  const h = previewVideo.videoHeight;
  if (!w || !h) {
    ocrProgress.textContent = "Video not ready.";
    ocrProgress.classList.add("error");
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(previewVideo, 0, 0, w, h);

  try {
    const worker = await Tesseract.createWorker("eng");
    await worker.setParameters({ tessedit_pageseg_mode: "12" });
    const {
      data: { text },
    } = await worker.recognize(canvas);
    await worker.terminate();

    const candidates = extractDateCandidates(text);
    if (candidates.length) {
      renderDateCandidates(candidates);
      ocrProgress.textContent = "Pick a date below or edit the field. Raw OCR snippet logged in notes if empty.";
    } else {
      ocrProgress.textContent = "No clear date found — check lighting and crop; you can type the date manually.";
      fieldNotes.value =
        (fieldNotes.value ? fieldNotes.value + "\n" : "") + "OCR raw: " + text.replace(/\s+/g, " ").trim().slice(0, 500);
    }
  } catch (e) {
    ocrProgress.textContent = "OCR error: " + (e.message || String(e));
    ocrProgress.classList.add("error");
  }
}

function escapeCsvCell(s) {
  const str = String(s ?? "");
  if (/[",\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function buildCsv() {
  const header = [
    "Brand",
    "Blend_Name",
    "Barcode_UPC_EAN",
    "Manufacture_Or_Tin_Date",
    "Quantity_Tins",
    "Tin_Size",
    "Notes",
  ];
  const lines = [header.join(",")];
  rows.forEach((r) => {
    lines.push(
      [
        escapeCsvCell(r.brand),
        escapeCsvCell(r.blend),
        escapeCsvCell(r.barcode),
        escapeCsvCell(r.mfgDate),
        escapeCsvCell(r.qty),
        escapeCsvCell(r.size),
        escapeCsvCell(r.notes),
      ].join(",")
    );
  });
  return lines.join("\r\n");
}

function downloadCsv() {
  const csv = buildCsv();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cellar-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderTable() {
  cellarBody.innerHTML = "";
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.brand)}</td>
      <td>${escapeHtml(r.blend)}</td>
      <td>${escapeHtml(r.barcode)}</td>
      <td>${escapeHtml(r.mfgDate)}</td>
      <td>${escapeHtml(String(r.qty))}</td>
      <td class="actions-cell"><button type="button" data-del="${r.id}">Remove</button></td>
    `;
    cellarBody.appendChild(tr);
  });
  emptyHint.style.display = rows.length ? "none" : "block";
}

function addRow() {
  const qty = Math.max(1, parseInt(fieldQty.value, 10) || 1);
  rows.push({
    id: crypto.randomUUID(),
    brand: fieldBrand.value.trim(),
    blend: fieldBlend.value.trim(),
    barcode: fieldBarcode.value.trim(),
    mfgDate: fieldMfgDate.value.trim(),
    qty,
    size: fieldSize.value.trim(),
    notes: fieldNotes.value.trim(),
  });
  saveRows();
  renderTable();
  renderCellarMatches();
}

function clearForm() {
  fieldBrand.value = "";
  fieldBlend.value = "";
  fieldBarcode.value = "";
  fieldMfgDate.value = "";
  fieldQty.value = "1";
  fieldSize.value = "";
  fieldNotes.value = "";
  dateCandidates.innerHTML = "";
  ocrProgress.textContent = "";
  renderCellarMatches();
}

function wire() {
  $("btnStartCam").addEventListener("click", startCamera);
  $("btnStopCam").addEventListener("click", stopCamera);
  $("btnScanBarcode").addEventListener("click", startBarcodeScan);
  $("btnStopBarcode").addEventListener("click", stopBarcodeScan);
  const openBtn = $("btnOpenScanner");
  if (openBtn) openBtn.addEventListener("click", () => void openTinScanner());
  const closeHud = $("btnScanClose");
  if (closeHud) closeHud.addEventListener("click", () => stopBarcodeScan());
  const torchBtn = $("btnTorch");
  if (torchBtn) {
    torchBtn.addEventListener("click", () => {
      torchOn = !torchOn;
      applyTorch(torchOn);
      refreshTorchButton();
    });
  }
  $("btnLookupUpc").addEventListener("click", () => {
    void applyBarcodeLookup(fieldBarcode.value.trim());
  });
  fieldBarcode.addEventListener("input", scheduleCellarMatchRefresh);
  if (cellarBarcodeMatches) {
    cellarBarcodeMatches.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;
      const btn = t.closest("[data-apply-cellar]");
      if (!(btn instanceof HTMLElement)) return;
      const id = btn.dataset.applyCellar;
      if (id) applyCellarRowToForm(id);
    });
  }
  $("btnOcrDate").addEventListener("click", captureStickerOcr);
  $("btnAddRow").addEventListener("click", addRow);
  $("btnClearForm").addEventListener("click", clearForm);
  $("btnExportCsv").addEventListener("click", downloadCsv);
  $("btnClearAll").addEventListener("click", () => {
    if (!rows.length) return;
    if (confirm("Remove all rows from this device?")) {
      rows = [];
      saveRows();
      renderTable();
      renderCellarMatches();
    }
  });

  cellarBody.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t instanceof HTMLElement && t.dataset.del) {
      rows = rows.filter((r) => r.id !== t.dataset.del);
      saveRows();
      renderTable();
      renderCellarMatches();
    }
  });
}

loadRows();
renderTable();
renderCellarMatches();
wire();
populateCameras();
