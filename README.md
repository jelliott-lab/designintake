# Turf Care Call Guide

A web app that walks a phone rep through the Precision Turf Care sales call, captures everything
the customer says, and produces a formatted summary to enter into Aspire **after** the call.

## What it does

Each call runs through 8 steps, following the *Turf Care Programs Sales Process* doc:

1. **Greeting**: opening script, what they're calling about
2. **Contact info**: name, phone (preferred?), email, property address
3. **Qualify**: current provider and why they're switching, the 5–10 minute ask, deciding today vs. researching
4. **Lawn & grass**: warm/cool season, warm-season type, front vs. back
5. **Programs**: Turf Care vs. Turf Care+ script with a recommendation (Fescue and Zoysia → Turf Care+)
6. **Quote**: opens the address in Google Maps for measuring; enter sq ft, pick add-ons, see the price live
7. **Close**: outcome (sold / quote emailed / site visit / not interested / research), first treatment date, account manager handoff
8. **Summary for Aspire**: one-click copy of the full summary, per-field copy buttons, and an "Entered in Aspire" checkbox

Call notes and a live customer card stay on screen the whole time. Everything autosaves to the
Google Sheet or server (with a browser backup if the connection drops), so calls are shared across reps.
The **Calls** page lists every call, filtered to "Needs Aspire entry" by default.

Payment info is intentionally **not** collected. Take payment in Aspire.

## Pricing

The **Pricing** page sets the price of each program and add-on. Each item is priced as:

```
max(sq ft ÷ 1,000 × rate, minimum) per visit × visits per year
```

Turf Care+ automatically includes aeration (warm season) or aeration & overseeding (cool season)
unless the rep removes it. Reps can also type an adjusted price.

> ⚠️ The starting prices in `config/pricing.default.json` are **placeholders**. Enter the real
> numbers from the Aspire kits on the Pricing page, then uncheck "placeholder prices".
> Quotes show a warning until you do.

## Hosting on Google (recommended)

The app can run as a **Google Apps Script web app** attached to a Google Sheet. It's free, reps
sign in with their Precision Google accounts, and every call is saved as a row in the Sheet.
You need two files from the `apps-script/` folder: `Code.gs` and `Index.html`.

### One-time setup (about 10 minutes)

1. In Google Drive, create a new **Google Sheet** named something like *Turf Care Calls*.
   Only people you share this Sheet with can open it directly. Reps don't need access to it
   to use the app.
2. In the Sheet, open **Extensions → Apps Script**.
3. In the editor, click `Code.gs`, delete what's there, and paste in the contents of
   [`apps-script/Code.gs`](apps-script/Code.gs). On GitHub, open the file, click **Raw**,
   then select all and copy.
4. Click **+** next to *Files* → **HTML**, name it `Index` (the editor adds `.html`), delete
   what's there, and paste in the contents of [`apps-script/Index.html`](apps-script/Index.html).
5. Click the 💾 **Save** icon.
6. Click **Deploy → New deployment**, click the ⚙️ gear next to *Select type*, and choose **Web app**.
   - *Execute as:* **Me**
   - *Who has access:* **Anyone within Precision** (your Google Workspace domain)
7. Click **Deploy**, then **Authorize access** and allow the permissions. The app only reads and writes this Sheet.
8. Copy the **Web app URL** and send it to the reps to bookmark.

The first call creates a **Calls** tab in the Sheet. You can sort, filter and read it freely.
Deleting a row deletes that call. Don't edit the last column (*Call data*); the app reads from it.

### Updating the app later

Paste the new `Code.gs` / `Index.html`, save, then go to **Deploy → Manage deployments →** ✏️ edit
→ *Version:* **New version** → **Deploy**. The URL stays the same.

Pricing edits made on the app's Pricing page are stored in the script, not the files, so updating
the code doesn't reset them.

## Running it as a Node server (alternative)

Use this option instead if you'd rather host it yourself. Requires Node.js 18+; there are no dependencies to install.

```bash
npm start            # http://localhost:3000
npm test
```

Environment variables:

| Variable       | Default   | Purpose |
|----------------|-----------|---------|
| `PORT`         | `3000`    | Port to listen on |
| `DATA_DIR`     | `./data`  | Where `calls.json` and `pricing.json` are stored. Back this folder up. |
| `APP_PASSCODE` | *(none)*  | If set, the browser asks for this passcode (any username). **Set this whenever the app is reachable outside your office network.** It holds customer names, addresses and phone numbers. |

## For developers

`public/` is the single source for the front end. After changing anything in `public/` or
`config/pricing.default.json`, run `npm run build:apps-script` to regenerate
`apps-script/Index.html` and the default pricing in `apps-script/Code.gs`. `npm test` fails if you forget.
