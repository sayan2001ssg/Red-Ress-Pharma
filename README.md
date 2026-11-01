# Red Ress Billing

Offline billing and sales register for Red Ress Pharma. It runs in the browser on a tablet, phone or computer, works with no internet after the first open, and installs on the home screen with its own icon.

## What's in the folder

```
index.html               the app
css/app.css              look and layout
js/app.js                screens: parties, register, bill entry, settings
js/store.js              file storage (see "Where records are kept")
js/pdf.js                the A4 bill PDF, laid out like the printed memo
sw.js                    makes the app work offline
manifest.webmanifest     app name and home-screen icon
icons/                   home-screen icons (Android, iPad, desktop)
vendor/                  pdf-lib (PDF) and JSZip (backups), bundled so nothing loads from the internet
start-on-this-pc.bat     run on a Windows computer
start-on-this-pc.sh      run on Mac / Linux
```

## Put it on the tablet (one time)

A tablet only installs a web app from an **https** address. Host the folder once on any free static host. Your bills never go to that host; they stay on the tablet.

**GitHub Pages (free):**
1. Create a GitHub repository, for example `rr-billing`, and upload everything in this folder.
2. Repository → Settings → Pages → Source: *Deploy from a branch* → `main` / root → Save.
3. After a minute the app is at `https://<your-username>.github.io/rr-billing/`.

Cloudflare Pages or Netlify work the same way: upload the folder, get an https link.

**Android tablet (Chrome):** open the link → tap **Install app** at the top of the page, or menu ⋮ → **Add to Home screen** / **Install app**.

**iPad (Safari):** open the link → Share button → **Add to Home Screen**.

The **RR Billing** icon now opens the app full screen. Open it once while online; after that it works with Wi-Fi and mobile data off.

## Use it on a computer

- **From the https link:** open it in Chrome or Edge and click the install icon in the address bar.
- **Without hosting:** double-click `start-on-this-pc.bat` (Windows, needs Python) or run `./start-on-this-pc.sh` (Mac / Linux). The app opens at `http://localhost:8765`, which also allows installing.

Opening `index.html` directly by double-click will not work, because browsers block offline storage for files opened that way.

## Where records are kept

Every record is a separate file:

```
billing-data/
  settings.json                                   firm details printed on bills
  parties.json                                    your M/S list
  bills/data/Saha_Agencies/2024-06-27_BL-103.json one file per bill
  bills/pdf/Saha_Agencies/2024-06-27_BL-103.pdf   the bill PDF, saved at the same time
```

The app picks the best place automatically:

| Device | Where the files live |
|---|---|
| Android tablet (Chrome) | The app's own file storage on the tablet |
| iPad | The app's own file storage, or Safari's storage on older iPadOS |
| Windows / Mac with Chrome or Edge | Same, or a **real folder you choose**: Settings & data → *Use a folder on this computer* |

On the tablet these files are not visible in the Files app, so use backups (below).

## Backups (do this weekly)

Settings & data → **Download backup (.zip)** or **Share backup** (sends it to Drive, WhatsApp, email). The zip holds every file listed above, PDFs included.

To move to a new tablet or recover: install the app there, then Settings & data → **Restore from backup…**

If the browser's site data is cleared, or the app is uninstalled, the records on that device are removed. The app asks the browser to protect its storage, and the Settings page shows whether that was granted.

## How the numbers work

- **Pack** is entered as `a × b` (e.g. 20 × 10).
- **Amount** = Qty × a × Rate, shown with its formula under each item.
- **Total sale value before GST** = sum of item amounts.
- **Discount** is a rupee amount taken off before GST.
- **SGST** and **CGST** are each half of the GST % on the value after discount (12% gives 6% + 6%).
- **Total with GST** = value after discount + SGST + CGST, also written in words (Indian system: lakh, crore).

## Changing the app later

After editing any file, change `VERSION` at the top of `sw.js` (for example `rr-billing-v1.0.1`) and upload again. Open devices show "A new version is ready" with a Reload button.

## Licences

pdf-lib (MIT) and JSZip (MIT / GPLv3) are included in `vendor/` with their licence files.
