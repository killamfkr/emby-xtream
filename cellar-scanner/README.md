# Cellar Scanner

Small **browser app** for logging **pipe tobacco tins** while you are in front of your shelf: read the **retail barcode (UPC/EAN)** with the camera, run **OCR on the manufacture/date sticker**, then build a list and **download a CSV** for [Tobacco Cellar](http://www.tobaccocellar.com/) or any spreadsheet.

This folder is meant to live alongside or inside **[Cellar-loader](https://github.com/killamfkr/Cellar-loader)** (that GitHub repo is currently empty; you can copy these files there or host them from this repository).

## How to run (web)

You need a **local or HTTPS URL** (mobile browsers block camera on plain `file://`).

```bash
cd cellar-scanner/www
python3 -m http.server 8765
```

Then open `http://localhost:8765` on the same machine, or use your LAN IP on a phone.

## Android APK (Capacitor)

The same UI is wrapped with **[Capacitor](https://capacitorjs.com/)** so you can install it as an Android app (`applicationId`: `com.killamfkr.cellarscanner`). The build includes **`@capacitor/browser`**: the **Look up tin (web)** and **Pipe Tool (web)** buttons open **Chrome Custom Tabs** (an in-app browser shell). That helps you search the open web or indexed Pipe Tool pages, but the app **does not** scrape or inject JavaScript into third-party sites to fill the form automatically (logins, terms of use, and page structure get in the way). Copy what you need and return to the scanner.


### CI build (easiest)

On GitHub, run the workflow **“Cellar Scanner APK”** (or push a change under `cellar-scanner/`). Download the **`cellar-scanner-debug-apk`** artifact — that file is **`app-debug.apk`**, ready to sideload (debug-signed).

### Local build

1. Install **JDK 21** (e.g. [Eclipse Temurin](https://adoptium.net/)) and [Android Studio](https://developer.android.com/studio) (includes the Android SDK).
2. From the `cellar-scanner` folder:

   ```bash
   npm ci
   npx cap sync android
   ```

3. Open the Android project and build:

   ```bash
   npx cap open android
   ```

   In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**. The debug APK is under `android/app/build/outputs/apk/debug/`.

   Or from a shell (with `ANDROID_HOME` set by Studio’s “SDK Manager”):

   ```bash
   npm run android:debug
   ```

Release builds for Play Store need your own signing key and store listing; this repo only automates a **debug** APK for personal use.

## Workflow

1. **Start camera** — pick the rear camera on a phone if multiple devices appear.
2. **Scan barcode** — tap **Open tin scanner** for a fullscreen viewfinder (similar flow to apps like [ThePiper](https://thepiper.ambivrt.com/)), or use **Scan barcode (inline)** inside the page. Align the tin’s UPC/EAN; the value fills the barcode field (you can edit it). On Chrome/Android the page uses the **native** `BarcodeDetector` when available, then automatically tries **ZXing** on the same preview if nothing is read within a few seconds or the native engine is unavailable.
3. **Capture & read sticker** — center the printed date or batch code; OCR suggests likely dates; tap one or type your own.
4. Enter **brand**, **blend**, **quantity**, optional **tin size** and **notes**.
5. **Add to cellar list** — repeat for more tins.
6. **Download CSV** — import or merge in your tracker.

Rows are saved in **localStorage** on this browser until you clear them.

## Tobacco Cellar and CSV

[Tobacco Cellar](http://www.tobaccocellar.com/) offers account features such as **RESTORE BACKUP** for CSV imports. The site does **not** publish a guaranteed public column spec in the pages we could read, so this exporter uses a **clear, spreadsheet-friendly header row** you can map when importing, or paste into a sheet and reconcile with your account:

| Column | Meaning |
| --- | --- |
| `Brand` | Maker / line |
| `Blend_Name` | Blend |
| `Barcode_UPC_EAN` | Scanned code |
| `Manufacture_Or_Tin_Date` | Date or batch label you confirmed |
| `Quantity_Tins` | Count of identical tins this row represents |
| `Tin_Size` | Free text (e.g. 2 oz, 50 g) |
| `Notes` | Shop, price, OCR snippet, etc. |

If your **RESTORE BACKUP** screen expects different names, rename columns in a spreadsheet to match a backup you already exported from Tobacco Cellar (if available), or enter the data through the site’s forms.

## UPC → blend (Open Food Facts)

After a successful barcode read (or when you tap **Fill blend from UPC**), the app calls the public **Open Food Facts** API to pre-fill **empty** brand, blend, and tin-size fields when a product exists in that database. Coverage for niche **pipe tobacco** is spotty; treat suggestions as a starting point and correct them as needed.

If you already logged that UPC in **this app’s cellar list** (same device), a **Same code in your list** panel appears under the barcode field. Tap **Use this tin** to copy brand, blend, size, notes, and quantity from that saved row so you can align the Open Food Facts guess with what you actually cellared, then adjust date or count and add again.

## Technical notes

- **Barcode**: when the browser exposes **`BarcodeDetector`** (common on Chromium/Android), scanning runs on that API first for speed; after a short timeout with no decode, the app falls back to [@zxing/browser](https://github.com/zxing-js/library) on the **same** `<video>` element via [esm.sh](https://esm.sh) (network required on first load). If `BarcodeDetector` is missing, ZXing is used immediately.
- **OCR**: [Tesseract.js](https://github.com/naptha/tesseract.js) v5 via esm.sh. Sticker fonts, foil, and glare affect accuracy; always verify dates.
- **Privacy**: Video is processed locally in the tab; nothing is uploaded unless you use a separate service yourself. CSV download is a normal file save from your browser.

## Troubleshooting (camera)

- **Wrong camera / scan never fires:** the barcode reader now decodes from the **same `<video>` preview** as “Start camera”. Earlier builds called `decodeFromVideoDevice`, which opened a **second** camera (often the rear) while the preview stayed on the front.
- **`OverconstrainedError`** almost always means **video constraints** could not be met (for example, “rear camera only” on a device with no back camera, or a stale camera id after unplugging a USB webcam). The app now relaxes constraints automatically; if it still fails, pick a different **Camera** in the dropdown or reload the page.
- **HTTPS / secure context**: Mobile browsers (and the Android WebView) only expose `getUserMedia` on **https://** or **http://localhost**. Plain `http://192.168.x.x` is often blocked. The old message that blamed every failure on HTTPS was misleading for `OverconstrainedError`.



## The Pipe Tool (thepipetool.com)

**There is no published public HTTP API** from The Pipe Tool for live barcode lookup as of their [Fall 2024 update](https://www.thepipetool.com/blog/2024/10/fall-2024-update-a-look-into-2025/) — an API is on their roadmap (e.g. future TurboTin integration), not something this scanner can call reliably today.

This app **does** support their documented **[Tobacco XML](https://thepipetool.com/xml/)** interchange: use **Pipe Tool XML (form)** under *Cellar list* to download a single `Tobacco` document built from the current fields (UPC in `SerialNumber`, brand, blend, tin size as `Weight`, quantity, dates, notes). Import behavior depends on their site’s current importer; bulk moves are still easiest via **Download CSV** and their spreadsheet tools if available.
## Limitations

- Not every tin uses a standard barcode; some use only internal batch codes — use notes and manual fields.
- Date stickers vary by manufacturer (Julian codes, lot numbers, etc.). Heuristics favor common numeric date shapes; ambiguous `MM/DD/YY` vs `DD/MM/YY` may need your judgment.

## License

MIT — see `package.json` and the repository root license where applicable.
