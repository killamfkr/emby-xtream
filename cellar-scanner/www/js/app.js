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

let mediaStream = null;
let barcodeReader = null;
let barcodeScanning = false;

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

async function populateCameras() {
  cameraSelect.innerHTML = "";
  try {
    const devices = await BrowserMultiFormatReader.listVideoInputDevices();
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
  } catch (e) {
    setCamStatus("Could not list cameras: " + (e.message || String(e)), "error");
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
    $("btnScanBarcode").disabled = true;
    $("btnOcrDate").disabled = true;
    return;
  }

  if (!window.isSecureContext) {
    setCamStatus(
      "Camera needs a secure page (https:// or http://localhost). This URL is not a secure context.",
      "error"
    );
    $("btnScanBarcode").disabled = true;
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
    $("btnScanBarcode").disabled = true;
    $("btnOcrDate").disabled = true;
    return;
  }

  try {
    previewVideo.srcObject = mediaStream;
    await previewVideo.play();
    setCamStatus("Camera on.", "ok");
    $("btnScanBarcode").disabled = false;
    $("btnOcrDate").disabled = false;
  } catch (e) {
    setCamStatus("Camera preview failed: " + (e.message || String(e)), "error");
    $("btnScanBarcode").disabled = true;
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
  $("btnScanBarcode").disabled = true;
  $("btnOcrDate").disabled = true;
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
  $("btnScanBarcode").disabled = !mediaStream;
  $("btnStopBarcode").disabled = true;
}

function startBarcodeScan() {
  if (!mediaStream) return;
  stopBarcodeScan();
  barcodeReader = new BrowserMultiFormatReader();
  barcodeScanning = true;
  videoWrap.classList.add("scanning");
  $("btnStopBarcode").disabled = false;
  $("btnScanBarcode").disabled = true;

  const deviceId = cameraSelect.value || undefined;
  const videoId = previewVideo.id;

  barcodeReader.decodeFromVideoDevice(deviceId, videoId, (result, err) => {
    if (!barcodeScanning) return;
    if (result) {
      const text = result.getText();
      fieldBarcode.value = text.replace(/\s/g, "");
      setCamStatus("Barcode read: " + text, "ok");
      stopBarcodeScan();
      $("btnScanBarcode").disabled = false;
    }
    /* ignore NotFoundException noise */
  });
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
}

function wire() {
  $("btnStartCam").addEventListener("click", startCamera);
  $("btnStopCam").addEventListener("click", stopCamera);
  $("btnScanBarcode").addEventListener("click", startBarcodeScan);
  $("btnStopBarcode").addEventListener("click", stopBarcodeScan);
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
    }
  });

  cellarBody.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t instanceof HTMLElement && t.dataset.del) {
      rows = rows.filter((r) => r.id !== t.dataset.del);
      saveRows();
      renderTable();
    }
  });
}

loadRows();
renderTable();
wire();
populateCameras();
