# Himayath Sagar: DTR Verification App

An Android app (one HTML page inside a Capacitor wrapper) for **Section 18 Himayath Sagar, ERO 322 Gaganpahad (TGSPDCL)**. Staff use it in the field to verify services DTR-wise, structures feeder-wise, and structures area-code-wise.

## What it does

| Section | Purpose |
|---|---|
| **Services** | Pick a DTR from the section's DTR list (1,382 structure codes; type any part of the code or the name). Scan each meter's QR code or barcode with the phone's native scanner, use IR/IRDA (demo), or type the number. The app shows the **Service No, UKSCNO, meter, reading** and whether the service belongs to this DTR. |
| **Feeders** | Pick a feeder. Confirm each structure on it by scanning a DTR tag, typing the code or name, or ticking it from the list. |
| **Areas** | Pick an area code. Confirm each structure that has services in that area. |
| **Service-wise** | Type a service no (with or without the space), UKSCNO or meter no: details, mapped DTR and **EBS structure code** (shown when they differ), whether and when it was verified and by whom, **move it to another DTR** with a remark, and the history of moves. |
| **Report** | Summary, DTR-wise, feeder-wise and area-wise reports, plus conflicts. Everything downloads as CSV. |
| **Guide** | How to use the app, account and staff logins, Google Sheet sync, data on this phone. |
| **☰ menu** | All sections, Sync now, Scan meters, Download all findings, settings, Sign out. |

Protection against wrong mapping: one service can be on only one DTR, one structure on only one feeder; a scan that disagrees with the mapping asks before saving; every entry records who made it, when and how.

## Where the data comes from

| Source (from EBS) | Used for |
|---|---|
| Consumer master details PDF (`all_services_details_of_himayath_sagar.pdf`) | meter number, make, last reading and month, phase, category, load, seal, status, EBS structure code |
| Services mapped on DTRs Excel (`all_serives_mapped_on_dtrs_list.xlsx`) | which DTR each service is checked on, consumer name, address, area code |
| All DTRs list Excel (`himayath_sagar_all_dtrs_list.XLSX`) | every DTR of the section: name, type, feeder, KVA, substation |

Build the section data file (on a computer with Python 3, `openpyxl` and `pdftotext` from poppler-utils):

```bash
pdftotext -layout all_services_details_of_himayath_sagar.pdf master.txt
python3 tools/parse_master.py master.txt master.json
python3 tools/build_section.py master.json all_serives_mapped_on_dtrs_list.xlsx himayath_sagar_all_dtrs_list.XLSX HSagar_section_data.json
```

## Consumer data is NOT in this repository

This repository is public, so it holds **code only**. `.gitignore` blocks `*.json`, `*.xlsx`, `*.pdf`, `*.csv`, `data.js` and `sync_url.txt`.

There are two APKs, both signed with the same permanent key (so either installs over the other and keeps the entries):

| APK | Has data? | Where |
|---|---|---|
| **Himayath-Sagar-full.apk** | Yes: all services and DTRs, and the Google Sheet link | Shared privately by the admin (WhatsApp etc.). Never upload it to GitHub. |
| **Himayath-Sagar.apk** | No | Public download on the [apk release](../../releases/tag/apk). On a new phone: sign in as admin and load `HSagar_section_data.json`, or paste the Sheet link and tap **Get section data from Google Sheet**. |

Making the full APK from the CI build: `tools/add-data.py` adds `data.js` to the unsigned release APK, then `tools/apksign.py` signs it.

## Google Sheet backup and sync (no backup key)

Entries from every phone go to one Google Sheet that you own, and each phone pulls the others' entries, so the one-service-one-DTR check works across phones.

1. Create a new Google Sheet (`sheets.new`), e.g. "Himayath Sagar DTR Backup".
2. **Extensions → Apps Script**. Delete the sample code, paste all of [`tools/Code.gs`](tools/Code.gs), and save.
3. **Deploy → New deployment →** type **Web app**. *Execute as:* **Me**. *Who has access:* **Anyone**. Deploy, allow access, copy the **Web app URL** (ends in `/exec`).
4. In the app as admin: **☰ → Google Sheet sync**, paste the URL, **Save and test**. (Or send the URL to the developer to build it into the full APK, so staff phones sync with no setup.)

There is no backup key, so anyone who has the Web app URL can read and change the entries. Keep the URL private (it is never put in this public code). To cut off an old URL: **Deploy → Manage deployments → Archive**, make a new deployment, and give staff the new URL.

Tabs the app writes: **Services**, **Unknown meters**, **Feeder checks**, **Area checks** (entries; newest wins, removals sync too), **Backup log** (who synced from which phone), and optionally **App data** / **Section master** (put there by the admin).

The app also writes an automatic backup file on each phone: `Documents/Himayath Sagar DTR/entries-backup-….json`. It stays even if the app is removed; **Guide → Restore entries backup** brings it back.

## Sign in

Default admin: **admin / 123456**. This is in the public code, so **change the admin password** in **Guide → Account** on first use, and add staff logins there.

## Building the APK

Every push to `main` runs `.github/workflows/android-apk.yml`: it builds the unsigned release APK (published to the `ci-build` pre-release) and a debug APK, and runs a smoke test on an Android emulator with made-up data (screenshots in the `ci-screens` pre-release).

The release APK is signed outside GitHub with the permanent key (`tools/apksign.py`, APK Signature Scheme v2) and pushed to the `signed-apk` branch; `.github/workflows/publish-signed.yml` checks that it installs and publishes it on the `apk` release. Keep the signing key file safe: every future update must be signed with it.

Local build (needs Android Studio / SDK): `npm ci && npm run sync && cd android && ./gradlew assembleRelease`.
