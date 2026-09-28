# Detailing Tracker

A private iPhone app for running a mobile detailing business. It's a web app you
add to your Home Screen: it opens full-screen with its own icon, works offline,
and keeps all data **on your phone**. There are no accounts, servers, or fees.

## What it tracks

| Tab | What's there |
|---|---|
| **Home** | Net profit, income, expenses, miles, owner contributions and unpaid jobs for any week, month, quarter or year. Also income by month, top services, expenses by category, top customers, and a rough tax estimate. |
| **Customers** | Contact info, notes (gate codes, pets), each customer's vehicles (year/make/model/color/plate), job history and lifetime spend. You can call, text, email or get directions in one tap. |
| **Jobs** | Each completed job: date, customer, vehicle, services (tap chips to fill in the price), price, tip, payment method and paid/unpaid. |
| **Expenses** | Expenses by vendor and category, plus a **Mileage** log (miles, or start/end odometer, with a round-trip option). |
| **Journal** | Owner contribution journal entries: money or property you put into the business from personal funds, shown as **Dr [account] / Cr Owner's Capital**. Any expense marked *Paid with personal money* is added here automatically. |
| **Settings** (⚙︎ on Home) | Business name, mileage rate, your service menu and prices, expense categories, backup/restore, CSV exports, and erase all data. |

## Put it on your iPhone

1. **Publish the site (one time).** On GitHub, open this repo and go to
   **Settings → Pages**. Under *Build and deployment* set **Source** to
   **GitHub Actions**. The included workflow publishes the app on every push.
   It shows up at `https://<your-username>.github.io/<repo-name>/`.
   *(GitHub Pages on a private repo requires a paid GitHub plan. The published
   page holds only the app code. Your business data never leaves your phone.)*
2. **Install it.** On your iPhone, open that link in **Safari**, tap
   **Share → Add to Home Screen**, then **Add**.
3. Open **Detailing** from your Home Screen.

## Back up your data

All data lives in the app's storage on your phone. If you delete the Home Screen
app or clear Safari website data, the data is gone. Every so often go to
**Settings → Export backup** and save the file to Files or iCloud Drive. Use
**Restore from backup** to load it back or move it to a new phone.

The **Spreadsheets (CSV)** buttons export jobs, expenses, mileage, owner journal
and customers. You can open them in Numbers or Excel or send them to your
accountant.

## Running it locally

There's no build step. Serve the folder over HTTP:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

After changing any app file, bump `VERSION` in `sw.js` so installed copies pick
up the update.
