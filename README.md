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
server (with a browser backup if the connection drops), so calls are shared across reps.
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

## Running it

Requires Node.js 18+. No dependencies to install.

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

Host it anywhere that runs Node and keeps a persistent disk (an office PC or server, Render,
Railway, Fly.io, a small VPS, etc.) so every rep uses the same URL and sees the same calls.
