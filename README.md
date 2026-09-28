# Detailing Tracker

A private iPhone app for running a mobile detailing business. It's a web app you
add to your Home Screen: it opens full-screen with its own icon, works offline,
and keeps all data **on your phone**. There are no accounts, servers, or fees.

## What it tracks

| Tab | What's there |
|---|---|
| **Home** | Net profit, income, expenses, miles, owner contributions and unpaid jobs for any week, month, quarter or year. Also income by month, top services, expenses by category, top customers, and a rough tax estimate. |
| **Clients** | Contact info, notes (gate codes, pets), each customer's vehicles (year/make/model/color/plate), job history and lifetime spend. You can call, text, email or get directions in one tap. |
| **Jobs** | Each completed job: date, customer, vehicle, services (tap chips to fill in the price), price, tip, payment method and paid/unpaid. |
| **Crew** | Payroll for 1099 contractors paid a commission. Set each person's default %, pick the crew on each job, and their commission (on the price, not tips) is added to what you owe them. Record payments and see who's owed what. There's a yearly 1099-NEC summary that flags anyone paid over the threshold (set in Settings), and a reminder when a W-9 is missing. Crew payments count as contract labor in profit and the tax estimate. |
| **Costs** | Expenses by vendor and category, plus a **Mileage** log (miles, or start/end odometer, with a round-trip option). |
| **Journal** | Owner contribution journal entries: money or property you put into the business from personal funds, shown as **Dr [account] / Cr Owner's Capital**. Any expense marked *Paid with personal money* is added here automatically. |
| **Settings** (⚙︎ on Home) | Business name, mileage rate, your service menu and prices, expense categories, 1099 threshold, backup/restore, CSV exports (including crew payments and 1099 totals), and erase all data. |

## Put it on your iPhone

**Publish the site (one time).** The GitHub iPhone app can't change repo
settings, so do this in **Safari**, signed in to github.com. If a page looks cut
off, tap **aA → Request Desktop Website**.

1. Open <https://github.com/ericjennings83-creator/WOWO/settings>, scroll to the
   bottom, and choose **Danger Zone → Change visibility → Change to public**.
   Free GitHub Pages needs a public repo. Only the app's code becomes public.
   Your business data stays on your phone and is never uploaded.
2. Open <https://github.com/ericjennings83-creator/WOWO/settings/pages>. Under
   **Build and deployment → Source**, choose **GitHub Actions**.

The included workflow publishes the app every time `main` changes, at
<https://ericjennings83-creator.github.io/WOWO/>.

**Install it.** Open that link in **Safari** on your iPhone, tap
**Share → Add to Home Screen**, then **Add**. Open **Detailing** from your Home
Screen.

## Back up your data

All data lives in the app's storage on your phone. If you delete the Home Screen
app or clear Safari website data, the data is gone. Every so often go to
**Settings → Export backup** and save the file to Files or iCloud Drive. Use
**Restore from backup** to load it back or move it to a new phone.

The **Spreadsheets (CSV)** buttons export jobs, expenses, mileage, owner journal,
customers, crew payments and crew 1099 totals. You can open them in Numbers or Excel or send them to your
accountant.

## Running it locally

There's no build step. Serve the folder over HTTP:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

After changing any app file, bump `VERSION` in `sw.js` so installed copies pick
up the update.
