# Marketing Dashboard

A Google Apps Script web app that shows Precision's marketing **cost per lead (CPL)** and **ROI**,
by month and by channel, in the company greens.

| Source | What it provides |
|---|---|
| **HubSpot deals** | Leads (deals created), lead source (*Known lead source*), pipeline, Closed Won, amount |
| **Aspire # on the HubSpot deal** | A deal counts as a **job** only when it's Closed Won *and* has an *Aspire Opportunity #* |
| **HubSpot website analytics** | Sessions and new contacts by traffic source |
| **"2026 Advertising Spend by Month" Google Sheet** | Spend: QuickBooks transaction tabs (one per month), else the *Actual* column on *2026 Budget*, else the *Budget* column (shown as an estimate) |
| **Windsor.ai** *(optional)* | Ad platform spend for months that have no QuickBooks tab yet |

## The numbers

- **Leads**: HubSpot deals created in the period.
- **Jobs**: Closed Won deals with an Aspire Opportunity #. Closed Won deals *without* one are
  listed under **Needs attention** and aren't counted until the number is filled in.
- **Revenue**: the HubSpot deal amount on those jobs. This is booked revenue, not Aspire invoices.
- **Cost per lead** = spend ÷ leads. **ROI** = (revenue − spend) ÷ spend. **ROAS** = revenue ÷ spend.
- **Count jobs by**:
  - *Lead month* (default) credits a job to the month its lead came in, so it answers "what did
    this month's marketing produce?". Recent months keep filling in as deals close.
  - *Close month* credits a job to the month it was won.
- **Include referral / no-source leads**: deals with no *Known lead source* (referrals, repeat
  clients, walk-ins). Turn this off to see CPL and ROI for marketing-sourced leads only.
- The default period is **year to date through last month**. A half-finished month has spend but
  not many leads yet, which skews CPL.

### Channels

Spend lines and lead sources roll up into channels (defined in `public/metrics.js`, `DEFAULT_CHANNELS`):

| Channel | HubSpot lead sources | Spend (budget items / QuickBooks vendors) |
|---|---|---|
| Google Ads | Google Ads, Google Ads [Survey] | Google PPC Ads, Google Local Service Ads / `Google*Ads` |
| SEO & website | Organic, WordPress Site | Landscape Leadership, GoDaddy |
| Home & Garden Show | Home & Garden Show | HBA Invoice Payoff, SWAG for Events / HBA amortization |
| Social media | Social Media | Social Media Boosts / Meta, Facebook |
| Direct mail & print | Direct Mail | Print Materials / Vista Print, PrintFast, Moo, Minuteman, USPS mailers |
| Tools, events & other | (none) | HubSpot, CallRail, Mailchimp, sponsorships and anything unmatched |
| Referral / no source | (blank) | (none) |

"Tools, events & other" counts toward total spend, so it's included in the blended CPL and ROI.
It has no leads of its own. To move a vendor or lead source, edit the lists in `metrics.js`, or copy
`DEFAULT_CHANNELS` into `CONFIG.channels` in `Code.gs`. Open **Where the spend numbers come from**
at the bottom of the dashboard to see which vendor landed in which channel.

## Setup (about 15 minutes)

### 1. HubSpot private app

In HubSpot: **Settings → Integrations → Private Apps → Create a private app**, name it
*Marketing Dashboard*, and on **Scopes** tick:

- `crm.objects.deals.read`
- `crm.schemas.deals.read`
- `business-intelligence` (website traffic analytics)

Create it and copy the **access token**.

### 2. Apps Script project

1. Go to [script.google.com](https://script.google.com) → **New project**, name it *Marketing Dashboard*.
2. Replace `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs).
3. **+ → HTML**, name it `Index`, and paste in [`apps-script/Index.html`](apps-script/Index.html).
4. **Project Settings (⚙️)**: tick *Show "appsscript.json"*, then replace that file in the editor
   with [`apps-script/appsscript.json`](apps-script/appsscript.json).
5. **Project Settings → Script Properties → Add**:
   - `HUBSPOT_TOKEN` = the token from step 1
   - `WINDSOR_API_KEY` = your Windsor.ai API key *(optional)*
6. **Deploy → New deployment → Web app**: *Execute as* **Me**, *Who has access* **Anyone within
   Precision**. Authorize when asked. The script reads HubSpot, the spend sheet, and Windsor.
7. Share the **Web app URL**.

Whoever deploys needs view access to the *2026 Advertising Spend by Month* sheet. Viewers don't:
the app reads it as the deployer.

Data is cached for 30 minutes. **Refresh data** pulls fresh numbers.

### Keeping spend current

Add each month's QuickBooks *Transaction Report* to the sheet as a new tab named for the month
(e.g. `October 2026`). If you fix a month, name the new tab `Updated October` and it will be used
instead of the old one. Until a month has a tab, the dashboard uses the budget tab and marks that
month as an estimate.

**New year**: in `Code.gs`, change `CONFIG.year`, `CONFIG.budgetTab` and (if it's a new sheet)
`CONFIG.spendSheetId`, then redeploy.

### Updating the app

Paste the new `Code.gs` / `Index.html`, save, then **Deploy → Manage deployments → ✏️ → Version:
New version → Deploy**. The URL stays the same.

## Development

`public/` is the source. Open `public/index.html` in a browser to preview with made-up sample data.
After changing anything in `public/`, run `npm run build:dashboard` to regenerate
`apps-script/Index.html`. `npm test` fails if you forget.
