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

The same UI is wrapped with **[Capacitor](https://capacitorjs.com/)** so you can install it as an Android app (`applicationId`: `com.killamfkr.cellarscanner`).

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
2. **Scan barcode** — align the tin’s barcode with the on-screen frame; the value fills the barcode field (you can edit it).
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

## Technical notes

- **Barcode**: [@zxing/browser](https://github.com/zxing-js/library) via [esm.sh](https://esm.sh) (network required on first load).
- **OCR**: [Tesseract.js](https://github.com/naptha/tesseract.js) v5 via esm.sh. Sticker fonts, foil, and glare affect accuracy; always verify dates.
- **Privacy**: Video is processed locally in the tab; nothing is uploaded unless you use a separate service yourself. CSV download is a normal file save from your browser.

## Troubleshooting (camera)

- **Wrong camera / scan never fires:** the barcode reader now decodes from the **same `<video>` preview** as “Start camera”. Earlier builds called `decodeFromVideoDevice`, which opened a **second** camera (often the rear) while the preview stayed on the front.
- **`OverconstrainedError`** almost always means **video constraints** could not be met (for example, “rear camera only” on a device with no back camera, or a stale camera id after unplugging a USB webcam). The app now relaxes constraints automatically; if it still fails, pick a different **Camera** in the dropdown or reload the page.
- **HTTPS / secure context**: Mobile browsers (and the Android WebView) only expose `getUserMedia` on **https://** or **http://localhost**. Plain `http://192.168.x.x` is often blocked. The old message that blamed every failure on HTTPS was misleading for `OverconstrainedError`.

## Limitations

- Not every tin uses a standard barcode; some use only internal batch codes — use notes and manual fields.
- Date stickers vary by manufacturer (Julian codes, lot numbers, etc.). Heuristics favor common numeric date shapes; ambiguous `MM/DD/YY` vs `DD/MM/YY` may need your judgment.

## License

MIT — see `package.json` and the repository root license where applicable.
