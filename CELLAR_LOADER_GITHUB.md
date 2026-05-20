# Cellar-loader on GitHub

The **Cellar Scanner** app was prepared for **[killamfkr/Cellar-loader](https://github.com/killamfkr/Cellar-loader)** (root `README.md`, `LICENSE`, and `cellar-scanner/`).

## Push from your machine

Automated pushes from this environment to `Cellar-loader` return **403** (the bot token can push to `emby-xtream` but not to that repository). To publish the initial commit:

1. Open a terminal **where you have write access** to `killamfkr/Cellar-loader` (SSH key or `gh auth login` / personal access token).
2. If you already have the nested clone from this workspace:

   ```bash
   cd Cellar-loader
   git push -u origin main
   ```

3. If you do **not** have that folder, clone the (still empty) remote, then copy in the tree from this repo’s `cellar-scanner/` plus a root `README.md` and `LICENSE` matching **[Cellar-loader initial import](https://github.com/killamfkr/emby-xtream)** branch `cursor/cellar-scanner-app-d053`, or ask for a patch / zip.

After the first successful push, treat **Cellar-loader** as the home repo for scanner changes; the `cellar-scanner/` copy under **emby-xtream** can stay in sync manually or be removed later to avoid drift.

## Contents of the prepared clone

- `README.md` — project overview and quick start  
- `LICENSE` — MIT  
- `.gitignore`  
- `cellar-scanner/` — web app (camera barcode, OCR, CSV export)

The nested directory `Cellar-loader/` in this workspace is **gitignored** here so it is not committed into emby-xtream; it exists only in environments where the agent created it for you to push.
