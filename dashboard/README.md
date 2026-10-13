# Marketing Dashboard

A Google Apps Script web app that shows Precision's marketing **cost per lead (CPL)** and **ROI**,
by month and by channel, in the company greens.

| Source | What it provides |
|---|---|
| **HubSpot deals** | Leads (deals created), lead source (*Known lead source*, else *Original Traffic Source*), service line (*Type of Job*), pipeline, Closed Won, amount |
| **Aspire # on the HubSpot deal** | A deal counts as a **job** only when it's Closed Won *and* has an *Aspire Opportunity #* |
| **HubSpot website analytics** | Sessions and new contacts by traffic source |
| **"2026 Advertising Spend by Month" Google Sheet** | Spend: QuickBooks transaction tabs (one per month), else the *Actual* column on *2026 Budget*, else the *Budget* column (shown as an estimate) |
| **Windsor.ai** *(optional)* | Ad platform spend for months that have no QuickBooks tab yet |

## The numbers

Definitions follow the **Marketing Standards & Trigger System** doc. Where the two disagree, the
doc wins and the dashboard is wrong.

- **Marketing lead**: a HubSpot deal created in the period with a lead source (*Known lead
  source*, else *Original Traffic Source* for paid search, organic search and social). Rep-created
  deals with no source are **self-sourced** sales, not marketing.
- **Spend**: working media only, from the QuickBooks advertising ledger. Software (HubSpot,
  CallRail, Mailchimp, Buzzsprout, Google Workspace) and the HBA amortisation are excluded and
  shown separately. An event's true all-in cost (`CONFIG.eventCosts`, e.g. the $30,000 Home &
  Garden Show) replaces its ledger amount and is charged to the months it produced leads.
- **Cost per lead** = channel spend ÷ leads created that month.
  **Qualified cost per lead** = spend ÷ (leads − killed at phone).
- **Killed at phone**: a lost deal that never got past New Lead / Call Attempt stages.
- **Jobs**: Closed Won deals with an Aspire Opportunity #. Closed Won deals *without* one are
  listed under **Needs attention** and aren't counted until the number is filled in.
- **Revenue**: the HubSpot deal amount on those jobs. The standards measure return on Aspire won
  dollars; until Aspire is connected, return here can read lower than the standards' own figures.
- **Return on spend** = job revenue ÷ spend, credited to the month the lead was created, and
  judged only once that month is **90 days old** (the maturity lag). The headline tile uses matured
  months only; maturing months show as lighter bars in the chart.
- **Count jobs by**: *Lead month* (default, the standards' basis) or *Close month*.
- **Include self-sourced deals** (off by default): adds rep-created no-source deals back into
  the totals. The **Self-sourced revenue** tile always shows them; per the standards it's the
  largest revenue engine and has no budget line.
- The default period is **year to date through last month**.

## Standards & review flags

The **Standards & review flags** panel runs every trigger in the standards doc's register, each
with its own window and minimum sample (below the floor a rule reads *insufficient data*, never
red). Triggers run on all deals as of today, whatever the filters say.

| Measured here | CS-1 to CS-6, SC-1 to SC-3, LQ-1 to LQ-5, DH-1, DH-5 |
|---|---|
| Needs Aspire data | SC-4, SC-5, DH-2, DH-3, DH-6 (shown as *Needs Aspire*) |
| Manual | DH-4 (pre-launch tracking check) |

Each tripped trigger becomes a flag with the evidence and the doc's recommended action. Someone
**accepts** it (with an optional note) or **overrides** it (a reason is required). Decisions are
shared with everyone and kept in the **Decision log**; a rule overridden three times is marked for
a threshold review, as the doc requires. Flag ids include the rule's window (week, month or
quarter), so a trigger that keeps firing asks for a new decision each cycle.

The dashboard also adds a few checks of its own, labelled *Dashboard check*: Closed Won deals
missing an Aspire #, leads with no Type of Job, spend that matched no channel, and channels over
budget.

Thresholds live in `public/flags.js` (`DEFAULT_RULES`); override them with `CONFIG.flagRules` in
`Code.gs`, and log the change in the standards doc. Floors the doc doesn't state are assumptions
marked in `DEFAULT_RULES` (LQ-2/3 use LQ-1's 30 leads; LQ-4 uses 20 lost leads; LQ-5 uses 20
leads). LQ-5 counts spam only, since HubSpot has no "duplicate" lost reason. SC-1 uses Mon–Fri
8am–5pm as business hours.

### Channels

Spend lines and lead sources roll up into channels (defined in `public/metrics.js`, `DEFAULT_CHANNELS`):

| Channel | HubSpot lead sources | Spend (budget items / QuickBooks vendors) |
|---|---|---|
| Google Ads | Google Ads, Google Ads [Survey] | Google PPC Ads, Google Local Service Ads / `Google*Ads` |
| SEO & website | Organic, WordPress Site | Landscape Leadership, GoDaddy |
| Home & Garden Show | Home & Garden Show | True event cost from `CONFIG.eventCosts` (SWAG for Events otherwise) |
| Social media | Social Media | Social Media Boosts / Meta, Facebook |
| Direct mail & print | Direct Mail | Print Materials / Vista Print, PrintFast, Moo, Minuteman, USPS mailers |
| Other media (untracked) | (none) | Misc, sponsorships, promo items and anything unmatched |
| Software & HBA amortisation | (none) | HubSpot, CallRail, Mailchimp, Buzzsprout, Google Workspace, HBA (excluded from spend) |
| Self-sourced (no lead source) | (blank) | (none) |

"Other media (untracked)" counts as working spend with no leads, so the CS-4 check watches it. To move a vendor or lead source, edit the lists in `metrics.js`, or copy
`DEFAULT_CHANNELS` into `CONFIG.channels` in `Code.gs`. Open **Where the spend numbers come from**
at the bottom of the dashboard to see which vendor landed in which channel.

### Service lines

*Type of Job* rolls up into service lines (`DEFAULT_SERVICE_LINES` in `metrics.js`):

| Service line | Type of Job values |
|---|---|
| Design & build | Landscape Design & Install |
| Enhancements | Enhancement |
| Maintenance & gardening | Maintenance & Gardening |
| Lawn & plant care (LPC) | Lawn Care, Plant Health Care, Exterior Pest Control |
| Irrigation | Irrigation Services |
| Type of job not set | (blank) |

*Type of Job* is multi-select. A deal with several types counts once, under the first matching
line in the order above, so revenue isn't double-counted.

Spend isn't tagged by service line. When you filter to a service line (or a pipeline), each
channel's monthly spend is split by that channel's share of the month's leads. Overhead such as
HubSpot and CallRail is split by the overall lead share. Those figures are marked **est.** For exact
numbers, tag Google Ads campaigns by service line and pull them through Windsor.

## Setup (about 15 minutes)

### 1. HubSpot private app

In HubSpot: **Settings → Integrations → Private Apps → Create a private app**, name it
*Marketing Dashboard*, and on **Scopes** tick:

- `crm.objects.deals.read`
- `crm.schemas.deals.read`
- `business-intelligence` (website traffic analytics)
- `crm.objects.owners.read` (rep names on stalled deals)

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
