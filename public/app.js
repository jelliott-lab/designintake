/* Turf Care Call Guide — front end (no framework). */
(function () {
  'use strict';

  const L = window.Logic;
  const app = document.getElementById('app');
  const REP_KEY = 'tcg.repName';

  const state = {
    call: null,
    pricing: null,
    dirty: false,
    saving: false,
    saveTimer: null,
    saveStatus: 'saved',
    listFilter: 'todo',
    listSearch: '',
  };

  // ---- utilities -----------------------------------------------------------

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function get(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  function set(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    keys.slice(0, -1).forEach((k) => {
      if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
      o = o[k];
    });
    o[keys[keys.length - 1]] = value;
  }

  function getLS(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function setLS(key, val) {
    try { localStorage.setItem(key, val); } catch { /* storage unavailable */ }
  }
  function delLS(key) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${url} failed (${res.status})`);
    return res.status === 204 ? null : res.json();
  }

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Copied to clipboard');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // ---- form helpers (render HTML bound to call fields via data-bind) ------

  function val(path) {
    const v = get(state.call, path);
    return v == null ? '' : v;
  }

  function input(path, label, opts = {}) {
    const type = opts.type || 'text';
    return `<label class="field ${opts.wide ? 'wide' : ''}">
      <span>${esc(label)}</span>
      <input type="${type}" data-bind="${path}" ${opts.live ? 'data-live' : ''} value="${esc(val(path))}"
        placeholder="${esc(opts.placeholder || '')}" ${opts.inputmode ? `inputmode="${opts.inputmode}"` : ''}
        ${opts.autocomplete ? `autocomplete="${opts.autocomplete}"` : 'autocomplete="off"'}>
    </label>`;
  }

  function textarea(path, label, opts = {}) {
    return `<label class="field wide">
      <span>${esc(label)}</span>
      <textarea data-bind="${path}" rows="${opts.rows || 3}" placeholder="${esc(opts.placeholder || '')}">${esc(val(path))}</textarea>
    </label>`;
  }

  function radios(path, label, options) {
    const cur = val(path);
    return `<fieldset class="choice">
      ${label ? `<legend>${esc(label)}</legend>` : ''}
      <div class="chips">
        ${options.map(([value, text]) => `
          <label class="chip ${cur === value ? 'on' : ''}">
            <input type="radio" name="${path}" data-bind="${path}" data-rerender value="${esc(value)}" ${cur === value ? 'checked' : ''}>
            ${esc(text)}
          </label>`).join('')}
      </div>
    </fieldset>`;
  }

  function checks(path, label, options) {
    const cur = get(state.call, path) || [];
    return `<fieldset class="choice">
      ${label ? `<legend>${esc(label)}</legend>` : ''}
      <div class="chips">
        ${options.map(([value, text, extra]) => `
          <label class="chip ${cur.includes(value) ? 'on' : ''}">
            <input type="checkbox" data-bind-array="${path}" data-rerender value="${esc(value)}" ${cur.includes(value) ? 'checked' : ''}>
            ${esc(text)}${extra ? ` <small>${esc(extra)}</small>` : ''}
          </label>`).join('')}
      </div>
    </fieldset>`;
  }

  function toggle(path, label) {
    const on = !!get(state.call, path);
    return `<label class="toggle">
      <input type="checkbox" data-bind-bool="${path}" data-rerender ${on ? 'checked' : ''}>
      <span>${esc(label)}</span>
    </label>`;
  }

  function say(text) {
    return `<div class="say"><span class="tag">Say</span><p>${text}</p></div>`;
  }

  function tip(text, kind = 'do') {
    return `<div class="tip ${kind}"><span class="tag">${kind === 'warn' ? 'Heads up' : 'Do'}</span><p>${text}</p></div>`;
  }

  function repName() {
    return esc(state.call.repName || '[Your Name]');
  }

  function firstName() {
    return esc((state.call.contact && state.call.contact.firstName) || '');
  }

  // ---- call steps ----------------------------------------------------------

  const STEPS = [
    {
      id: 'greet',
      title: 'Greeting',
      render: () => `
        <div class="row">${input('repName', 'Your name (rep)', { placeholder: 'e.g. Sarah' })}</div>
        ${say(`Thank you for calling Precision. My name is <b>${repName()}</b>. How can I help you today?`)}
        ${tip('Listen for interest in turf care: fertilization, weed control, a greener lawn, and so on.')}
        ${checks('servicesWanted', 'What are they calling about?', Object.entries(L.LABELS.services))}
        ${(state.call.servicesWanted || []).includes('other') ? `<div class="row">${input('servicesOther', 'Other service', { wide: true })}</div>` : ''}
        ${say('It sounds like you want us to help you achieve a <b>healthy, green lawn with no hassle</b>.')}
      `,
    },
    {
      id: 'contact',
      title: 'Contact info',
      render: () => `
        ${say('Can I start by getting some basic info from you today?')}
        <div class="row">
          ${input('contact.firstName', 'First name', { live: true })}
          ${input('contact.lastName', 'Last name', { live: true })}
        </div>
        <div class="row">
          ${input('contact.phone', 'Phone', { type: 'tel', inputmode: 'tel', live: true })}
          ${input('contact.email', 'Email', { type: 'email', inputmode: 'email' })}
        </div>
        ${say('Is this the best phone number to reach you?')}
        ${radios('contact.phoneIsPreferred', '', [['yes', 'Yes, preferred'], ['no', 'No, use another']])}
        ${val('contact.phoneIsPreferred') === 'no' ? `<div class="row">${input('contact.altPhone', 'Preferred phone', { type: 'tel', inputmode: 'tel' })}</div>` : ''}
        <h3>Property address</h3>
        <div class="row">${input('contact.street', 'Street address', { wide: true, live: true })}</div>
        <div class="row">
          ${input('contact.city', 'City', { live: true })}
          ${input('contact.state', 'State', { placeholder: 'SC', live: true })}
          ${input('contact.zip', 'ZIP', { inputmode: 'numeric', live: true })}
        </div>
        ${tip('Write it down here only. Don\'t add them to Aspire until after the call.')}
      `,
    },
    {
      id: 'qualify',
      title: 'Qualify',
      render: () => `
        ${say('Do you have a current lawn care service?')}
        ${radios('qual.hasCurrentService', '', [['yes', 'Yes'], ['no', 'No']])}
        ${val('qual.hasCurrentService') === 'yes' ? `
          <div class="row">${input('qual.currentProvider', 'Current provider', { wide: true })}</div>
          ${say('Why are you looking to make a change?')}
          ${textarea('qual.whyChange', 'Reason for change', { rows: 2 })}` : ''}
        ${say(`If it's ok with you${firstName() ? ', ' + firstName() : ''}, I'd like to take about <b>5–10 minutes</b> on this call to ask a few questions about your yard, go over our turf care programs, and get you a quote over the phone. If we agree on that, we could get you started with a program today. Would that work for you?`)}
        ${say('Are you looking to get a quote and make a decision today, or just doing research?')}
        ${radios('qual.decisionTiming', '', [['today', 'Quote & decide today'], ['research', 'Just researching']])}
        ${val('qual.decisionTiming') === 'research' ? tip('Keep going. A quote over the phone often turns research into a sale. If they don\'t want one, offer an account manager site visit on the Quote step.') : ''}
      `,
    },
    {
      id: 'lawn',
      title: 'Lawn & grass',
      render: () => {
        const g = state.call.grass || {};
        return `
        ${say('Do you know what type of grass you have: <b>warm season</b> or <b>cool season</b>?')}
        ${radios('grass.season', '', Object.entries(L.LABELS.season))}
        ${g.season === 'warm' ? `
          ${say('Do you know what kind of warm season turf it is? Bermuda, Zoysia, Centipede, or St. Augustine?')}
          ${radios('grass.warmType', '', Object.entries(L.LABELS.warmType))}` : ''}
        ${g.season === 'cool' ? tip('Cool season in the Upstate is going to be <b>Fescue</b>.') : ''}
        ${g.season === 'unknown' ? tip('That\'s ok. We can still quote. The account manager will confirm the turf type on site.') : ''}
        ${say('Is the front lawn a different type from the back?')}
        ${radios('grass.frontBackDifferent', '', [['no', 'Same'], ['yes', 'Different'], ['unknown', "Don't know"]])}
        ${g.frontBackDifferent === 'yes' ? `<div class="row">${input('grass.frontBackNotes', 'What\'s different? (e.g. Bermuda front, Fescue back)', { wide: true })}</div>` : ''}
        ${g.frontBackDifferent === 'unknown' ? tip('We can still quote. The account manager will review it on site.') : ''}
      `;
      },
    },
    {
      id: 'programs',
      title: 'Programs',
      render: () => {
        const rec = L.recommendedProgram(state.call.grass);
        const p = state.pricing.programs;
        return `
        ${say('We have <b>2 tiers</b> of treatment programs: <b>Turf Care</b> and <b>Turf Care+</b>.')}
        ${rec ? `<div class="rec">Recommended: <b>${esc(p[rec.program].name)}</b>. ${esc(rec.reason)}</div>` : ''}
        <div class="programs">
          <section class="program ${rec && rec.program === 'tc' ? 'recommended' : ''}">
            <h3>${esc(p.tc.name)}</h3>
            <p class="count">${esc(p.tc.visits)} treatments per year</p>
            <ul>
              <li>Fertilization</li>
              <li>Pre-emergent and post-emergent weed control your lawn needs</li>
              <li>A mix of granular and liquid applications, depending on the time of year and type of treatment</li>
              <li><b>Aeration & overseeding is not included</b>, but we highly recommend it for best results (Fescue yards)</li>
              <li>Your account manager can talk to you about a few add-on applications that improve your turf's vitality</li>
            </ul>
          </section>
          <section class="program ${rec && rec.program === 'tcplus' ? 'recommended' : ''}">
            <h3>${esc(p.tcplus.name)}</h3>
            <p class="count">${esc(p.tcplus.visits)} treatments per year</p>
            <ul>
              <li>7 applications of fertilization plus pre- and post-emergent weed control</li>
              <li><b>4 preventive fungicide applications</b> during the growing season to keep fungus and disease from damaging your turf</li>
              <li><b>Aeration and/or aeration & overseeding included</b> (can be removed if you do this yourself)</li>
              <li>Highly recommended for all Fescue yards and many Zoysia yards</li>
            </ul>
          </section>
        </div>
        <details class="addons-script">
          <summary>Add-on treatments to mention</summary>
          <ul>
            <li>Integrated outdoor pest management: mosquitoes, flea & tick, perimeter pest, fire ants, grub control, and army worms</li>
            <li>Aeration for warm season / aeration & overseeding for cool season turf</li>
            <li>Top dressing: sand for warm season, topsoil for Fescue</li>
            <li>Soil amendment programs: we take a soil sample, have it analyzed for nutrient deficiencies, and recommend a treatment</li>
          </ul>
        </details>
        ${radios('quote.program', 'Which program are they interested in?', [['tc', p.tc.name], ['tcplus', p.tcplus.name]])}
      `;
      },
    },
    {
      id: 'quote',
      title: 'Quote',
      render: () => {
        const q = state.call.quote || {};
        const url = L.mapsUrl(state.call.contact);
        const includesAer = L.tcPlusIncludesAeration(state.call);
        const addOnOpts = state.pricing.addOns
          .filter((a) => !(includesAer && (a.id === 'aeration' || a.id === 'aeration_overseed')))
          .map((a) => [a.id, a.name]);
        return `
        ${say('Do you want me to get you a quote over the phone right now?')}
        ${radios('quote.wantsPhoneQuote', '', [['yes', 'Yes, quote now'], ['no', 'No']])}
        ${q.wantsPhoneQuote === 'no' ? `
          ${say('Would you like an account manager to visit you on site and give you an estimate for treating your property?')}
          ${tip('If yes, pick a time from the account manager\'s Google Calendar, then go to <b>Close</b> and choose "Account manager site visit".')}
        ` : ''}
        ${q.wantsPhoneQuote === 'yes' ? `
          ${say('Can you give me a few minutes to take a virtual lawn measurement and get you a price?')}
          ${tip('You can ask if they mind a short hold while you measure.')}
          <div class="maps">
            ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Open address in Google Maps ↗</a>` : '<span class="muted">Enter the address on the Contact step to get a Maps link.</span>'}
            <span class="muted">In Google Maps, right-click the lawn edge, choose <b>Measure distance</b>, and trace the turf to get the area.</span>
          </div>
          <div class="row">
            ${input('quote.frontSqft', 'Front turf (sq ft)', { inputmode: 'numeric', live: true })}
            ${input('quote.backSqft', 'Back turf (sq ft)', { inputmode: 'numeric', live: true })}
            ${input('quote.otherSqft', 'Other areas (sq ft)', { inputmode: 'numeric', live: true })}
          </div>
          ${!q.program ? tip('Pick a program on the <b>Programs</b> step to see a price.', 'warn') : ''}
          ${q.program === 'tcplus' ? toggle('quote.removeAeration', 'Remove aeration (customer does it themselves)') : ''}
          ${checks('quote.addOns', 'Add-ons', addOnOpts)}
          <div class="quote-box" data-quote-box>${renderQuoteBox()}</div>
          <div class="row">${input('quote.priceOverride', 'Adjusted annual price (optional, overrides calculated)', { inputmode: 'decimal', live: true, placeholder: 'Leave blank to use calculated price' })}</div>
        ` : ''}
      `;
      },
    },
    {
      id: 'close',
      title: 'Close',
      render: () => {
        const cl = state.call.close || {};
        const quoted = L.totalSqft(state.call.quote) > 0 && (state.call.quote || {}).program;
        return `
        ${quoted ? say(`So for your lawn, ${esc(state.pricing.programs[state.call.quote.program].name)} comes to <b>${esc(L.money(L.calcQuote(state.call, state.pricing).total))}</b> for the year. Would you like to get started today?`) : ''}
        ${radios('close.outcome', 'How did the call end?', Object.entries(L.LABELS.outcome))}
        ${cl.outcome === 'sold' ? `
          ${say('Great! Once you approve, we\'ll get you activated in our system.')}
          ${tip('Payment info isn\'t collected in this app. Take it in Aspire when you enter the account.', 'warn')}
          ${say('The next step is getting your account manager in touch with you to introduce themselves and answer any specific questions about our process. Their contact info will be in the welcome email I send you, and you should hear from them by the end of the day or the morning of the next business day.')}
          ${say('We\'ll also set up your first treatment, which will be on…')}
          <div class="row">${input('close.firstTreatmentDate', 'First treatment date', { type: 'date' })}</div>
        ` : ''}
        ${cl.outcome === 'quote_emailed' ? say('No problem. I\'ll email you the quote. An account manager will follow up in a day or two, but if we can\'t get in touch with you or don\'t hear back, we\'ll assume you\'re not interested.') : ''}
        ${cl.outcome === 'site_visit' ? say('Great. Let\'s get a meeting set up with an account manager to look at your property with you.') + tip('Book it on the account manager\'s Google Calendar, then put the date/time in the follow-up field below.') : ''}
        ${cl.outcome ? `
          <h3>Account manager handoff</h3>
          ${toggle('close.handoffToRep', 'Send to an account manager')}
          ${cl.handoffToRep ? `<div class="row">
            ${input('close.accountManager', 'Account manager', { placeholder: 'Name' })}
            ${input('close.handoffReason', 'Reason', { placeholder: 'e.g. New account, confirm turf type, site visit' })}
          </div>` : ''}
          ${textarea('close.followUp', 'Follow-up details (appointment time, when to call back, etc.)', { rows: 2 })}
          ${say('Thank you, have a great day!')}
        ` : ''}
      `;
      },
    },
    {
      id: 'summary',
      title: 'Summary for Aspire',
      render: () => {
        const c = state.call.contact || {};
        const chips = [
          ['Name', L.fullName(c)], ['Phone', c.phone], ['Email', c.email], ['Street', c.street],
          ['City', c.city], ['State', c.state], ['ZIP', c.zip],
        ].filter(([, v]) => v);
        return `
        ${tip('Enter this into Aspire right after the call, then mark it entered below.')}
        ${chips.length ? `<div class="copy-chips">${chips.map(([k, v]) => `<button class="copy-chip" data-copy="${esc(v)}"><small>${esc(k)}</small>${esc(v)}</button>`).join('')}</div>` : ''}
        <div class="summary-actions">
          <button class="btn primary" data-action="copy-summary">Copy full summary</button>
          ${toggle('aspireEntered', 'Entered in Aspire')}
        </div>
        <pre class="summary" id="summaryText">${esc(L.buildSummary(state.call, state.pricing))}</pre>
        <div class="danger-zone"><button class="btn danger subtle" data-action="delete-call">Delete this call</button></div>
      `;
      },
    },
  ];

  function renderQuoteBox() {
    const q = state.call.quote || {};
    if (!q.program) return '<p class="muted">No program selected.</p>';
    const r = L.calcQuote(state.call, state.pricing);
    if (!r.sqft) return '<p class="muted">Enter the turf square footage to calculate a price.</p>';
    return `
      ${r.placeholder ? '<p class="placeholder-flag">Placeholder pricing. Update it on the Pricing page.</p>' : ''}
      <table>
        ${r.lines.map((l) => `<tr><td>${esc(l.label)}</td><td>${esc(L.money(l.amount))}</td></tr>`).join('')}
        ${r.overridden ? `<tr class="muted"><td>Calculated</td><td><s>${esc(L.money(r.calculated))}</s></td></tr>` : ''}
        <tr class="total"><td>Annual total · ${r.sqft.toLocaleString()} sq ft</td><td>${esc(L.money(r.total))}</td></tr>
      </table>`;
  }

  function renderSideCard() {
    const call = state.call;
    const c = call.contact || {};
    const g = call.grass || {};
    const q = call.quote || {};
    const url = L.mapsUrl(c);
    const quote = q.program && L.totalSqft(q) ? L.calcQuote(call, state.pricing) : null;
    let grass = L.LABELS.season[g.season] || '';
    if (g.season === 'warm' && L.LABELS.warmType[g.warmType]) grass = L.LABELS.warmType[g.warmType];
    const row = (k, v) => (v ? `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>` : '');
    return `
      <h2>${esc(L.fullName(c) || 'New caller')}</h2>
      <dl>
        ${row('Phone', esc(c.phone))}
        ${row('Address', esc(L.fullAddress(c)) + (url ? ` <a href="${esc(url)}" target="_blank" rel="noopener">Map ↗</a>` : ''))}
        ${row('Grass', esc(grass))}
        ${row('Turf', L.totalSqft(q) ? esc(L.totalSqft(q).toLocaleString() + ' sq ft') : '')}
        ${row('Program', q.program ? esc(state.pricing.programs[q.program].name) : '')}
        ${row('Quote', quote ? `<b>${esc(L.money(quote.total))}</b>/yr` : '')}
        ${row('Outcome', esc(L.LABELS.outcome[(call.close || {}).outcome] || ''))}
      </dl>`;
  }

  // ---- call screen ---------------------------------------------------------

  function stepIndex(id) {
    const i = STEPS.findIndex((s) => s.id === id);
    return i === -1 ? 0 : i;
  }

  function renderCall(stepId) {
    const i = stepIndex(stepId);
    const step = STEPS[i];
    app.innerHTML = `
      <div class="call-layout">
        <nav class="steps" aria-label="Call steps">
          ${STEPS.map((s, n) => `<a href="#/call/${state.call.id}/${s.id}" class="${n === i ? 'active' : ''}"><span>${n + 1}</span>${esc(s.title)}</a>`).join('')}
        </nav>
        <section class="step-card">
          <h1>${esc(step.title)}</h1>
          <div class="step-body" data-step-body>${step.render()}</div>
          <div class="step-nav">
            ${i > 0 ? `<a class="btn" href="#/call/${state.call.id}/${STEPS[i - 1].id}">← ${esc(STEPS[i - 1].title)}</a>` : '<span></span>'}
            ${i < STEPS.length - 1 ? `<a class="btn primary" href="#/call/${state.call.id}/${STEPS[i + 1].id}">${esc(STEPS[i + 1].title)} →</a>` : '<a class="btn" href="#/">Back to calls</a>'}
          </div>
        </section>
        <aside class="side">
          <div class="side-card" data-side-card>${renderSideCard()}</div>
          <label class="notes">
            <span>Call notes <small data-save-status class="save ${state.saveStatus}">${saveLabel()}</small></span>
            <textarea data-bind="notes" placeholder="Anything else worth remembering: gate code, dogs, problem areas, best time to call…">${esc(val('notes'))}</textarea>
          </label>
        </aside>
      </div>`;
    state.stepId = step.id;
    const active = app.querySelector('.steps a.active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function rerenderStep() {
    const body = app.querySelector('[data-step-body]');
    if (!body) return;
    const step = STEPS[stepIndex(state.stepId)];
    body.innerHTML = step.render();
    refreshLive();
  }

  function refreshLive() {
    const side = app.querySelector('[data-side-card]');
    if (side) side.innerHTML = renderSideCard();
    const qb = app.querySelector('[data-quote-box]');
    if (qb) qb.innerHTML = renderQuoteBox();
  }

  // ---- saving --------------------------------------------------------------

  function saveLabel() {
    return { saved: 'Saved', saving: 'Saving…', pending: 'Unsaved', error: 'Offline, will retry' }[state.saveStatus];
  }

  function setSaveStatus(s) {
    state.saveStatus = s;
    const el = app.querySelector('[data-save-status]');
    if (el) {
      el.textContent = saveLabel();
      el.className = `save ${s}`;
    }
  }

  function markDirty() {
    state.dirty = true;
    setLS(`tcg.draft.${state.call.id}`, JSON.stringify(state.call));
    setSaveStatus('pending');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(save, 600);
  }

  async function save() {
    if (!state.call || state.saving || !state.dirty) return;
    state.saving = true;
    state.dirty = false;
    setSaveStatus('saving');
    const call = state.call;
    try {
      const saved = await api('PUT', `/api/calls/${call.id}`, call);
      if (state.call && state.call.id === saved.id) state.call.updatedAt = saved.updatedAt;
      delLS(`tcg.draft.${call.id}`);
      setSaveStatus(state.dirty ? 'pending' : 'saved');
    } catch (err) {
      console.error(err);
      state.dirty = true;
      setSaveStatus('error');
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(save, 4000);
    } finally {
      state.saving = false;
      if (state.dirty && state.saveStatus !== 'error') save();
    }
  }

  async function flushSave() {
    clearTimeout(state.saveTimer);
    while (state.saving) await new Promise((r) => setTimeout(r, 50));
    if (state.dirty) await save();
  }

  function applyOutcomeDefaults(outcome) {
    // Sold, emailed quotes and site visits all go to an account manager per the sales process.
    set(state.call, 'close.handoffToRep', ['sold', 'quote_emailed', 'site_visit'].includes(outcome));
    if (!get(state.call, 'close.handoffReason')) {
      const reason = { sold: 'New account, first treatment scheduled', quote_emailed: 'Follow up on emailed quote', site_visit: 'On-site estimate' }[outcome];
      if (reason) set(state.call, 'close.handoffReason', reason);
    }
  }

  // ---- events --------------------------------------------------------------

  app.addEventListener('input', (e) => {
    const el = e.target;
    if (!state.call) return;
    if (el.dataset.bind && el.type !== 'radio') {
      set(state.call, el.dataset.bind, el.value);
      if (el.dataset.bind === 'repName') setLS(REP_KEY, el.value);
      markDirty();
      if (el.hasAttribute('data-live')) refreshLive();
    }
  });

  app.addEventListener('change', (e) => {
    const el = e.target;
    if (!state.call) return;
    let changed = false;
    if (el.type === 'radio' && el.dataset.bind) {
      set(state.call, el.dataset.bind, el.value);
      if (el.dataset.bind === 'close.outcome') applyOutcomeDefaults(el.value);
      if (el.dataset.bind === 'quote.wantsPhoneQuote' && el.value === 'no' && !get(state.call, 'close.outcome')) {
        set(state.call, 'close.outcome', 'site_visit');
        applyOutcomeDefaults('site_visit');
      }
      changed = true;
    } else if (el.dataset.bindArray) {
      const path = el.dataset.bindArray;
      const cur = new Set(get(state.call, path) || []);
      el.checked ? cur.add(el.value) : cur.delete(el.value);
      set(state.call, path, [...cur]);
      changed = true;
    } else if (el.dataset.bindBool) {
      set(state.call, el.dataset.bindBool, el.checked);
      if (el.dataset.bindBool === 'aspireEntered') set(state.call, 'aspireEnteredAt', el.checked ? new Date().toISOString() : null);
      changed = true;
    }
    if (changed) {
      markDirty();
      if (el.hasAttribute('data-rerender')) rerenderStep();
    }
  });

  app.addEventListener('click', async (e) => {
    const copyEl = e.target.closest('[data-copy]');
    if (copyEl) return copyText(copyEl.dataset.copy);
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;

    if (action === 'copy-summary') return copyText(L.buildSummary(state.call, state.pricing));

    if (action === 'delete-call') {
      if (!confirm('Delete this call permanently?')) return;
      clearTimeout(state.saveTimer);
      state.dirty = false;
      await api('DELETE', `/api/calls/${state.call.id}`);
      delLS(`tcg.draft.${state.call.id}`);
      state.call = null;
      toast('Call deleted');
      location.hash = '#/';
    }

    if (action === 'toggle-aspire') {
      const id = actionEl.dataset.id;
      const call = await api('GET', `/api/calls/${id}`);
      call.aspireEntered = !call.aspireEntered;
      call.aspireEnteredAt = call.aspireEntered ? new Date().toISOString() : null;
      await api('PUT', `/api/calls/${id}`, call);
      renderList();
    }

    if (action === 'filter') {
      state.listFilter = actionEl.dataset.filter;
      renderList();
    }
  });

  document.getElementById('newCallBtn').addEventListener('click', newCall);

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty || state.saving) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  async function newCall() {
    await flushSave();
    const call = await api('POST', '/api/calls', {
      repName: getLS(REP_KEY) || '',
      contact: { state: 'SC' },
      servicesWanted: [],
      qual: {},
      grass: {},
      quote: { addOns: [] },
      close: {},
      notes: '',
      aspireEntered: false,
    });
    location.hash = `#/call/${call.id}/greet`;
  }

  // ---- call list -----------------------------------------------------------

  async function renderList() {
    state.call = null;
    const calls = await api('GET', '/api/calls');
    const counts = {
      todo: calls.filter((c) => !c.aspireEntered).length,
      done: calls.filter((c) => c.aspireEntered).length,
      all: calls.length,
    };
    const term = state.listSearch.toLowerCase();
    const shown = calls.filter((c) => {
      if (state.listFilter === 'todo' && c.aspireEntered) return false;
      if (state.listFilter === 'done' && !c.aspireEntered) return false;
      if (!term) return true;
      return [c.name, c.phone, c.address, c.repName].join(' ').toLowerCase().includes(term);
    });
    const outcomeBadge = (o) => (o ? `<span class="badge ${o}">${esc(L.LABELS.outcome[o].split(' — ')[0])}</span>` : '<span class="badge none">In progress</span>');

    app.innerHTML = `
      <section class="list-page">
        <div class="list-head">
          <h1>Calls</h1>
          <input type="search" id="listSearch" placeholder="Search name, phone, address, rep" value="${esc(state.listSearch)}">
        </div>
        <div class="tabs">
          ${[['todo', 'Needs Aspire entry'], ['done', 'Entered in Aspire'], ['all', 'All']].map(([k, t]) =>
            `<button class="tab ${state.listFilter === k ? 'on' : ''}" data-action="filter" data-filter="${k}">${t} <span>${counts[k]}</span></button>`).join('')}
        </div>
        ${shown.length ? `
        <div class="table-wrap"><table class="calls">
          <thead><tr><th>When</th><th>Customer</th><th>Address</th><th>Outcome</th><th>To AM</th><th>Rep</th><th>Aspire</th></tr></thead>
          <tbody>
            ${shown.map((c) => `
              <tr data-href="#/call/${c.id}/${c.outcome ? 'summary' : 'greet'}">
                <td class="nowrap">${esc(fmtDate(c.createdAt))}</td>
                <td><b>${esc(c.name || 'Unnamed caller')}</b><br><small>${esc(c.phone)}</small></td>
                <td>${esc(c.address)}</td>
                <td>${outcomeBadge(c.outcome)}</td>
                <td>${c.handoffToRep ? 'Yes' : ''}</td>
                <td>${esc(c.repName)}</td>
                <td><button class="btn small ${c.aspireEntered ? 'done' : ''}" data-action="toggle-aspire" data-id="${c.id}">${c.aspireEntered ? '✓ Entered' : 'Mark entered'}</button></td>
              </tr>`).join('')}
          </tbody>
        </table></div>` : `
        <div class="empty">
          <p>${calls.length ? 'No calls match.' : 'No calls yet.'}</p>
          ${calls.length ? '' : '<button class="btn primary" id="emptyNew">+ Start a new call</button>'}
        </div>`}
      </section>`;

    const search = document.getElementById('listSearch');
    search.addEventListener('input', () => {
      state.listSearch = search.value;
      clearTimeout(renderList.t);
      renderList.t = setTimeout(async () => {
        await renderList();
        const s = document.getElementById('listSearch');
        s.focus();
        s.setSelectionRange(s.value.length, s.value.length);
      }, 200);
    });
    const emptyNew = document.getElementById('emptyNew');
    if (emptyNew) emptyNew.addEventListener('click', newCall);
    app.querySelectorAll('tr[data-href]').forEach((tr) =>
      tr.addEventListener('click', (e) => {
        if (!e.target.closest('button')) location.hash = tr.dataset.href;
      }));
  }

  // ---- pricing page --------------------------------------------------------

  function renderPricing() {
    state.call = null;
    const p = JSON.parse(JSON.stringify(state.pricing));
    const num = (v) => `value="${esc(v)}" inputmode="decimal"`;
    const programRow = (key) => `
      <tr data-program="${key}">
        <td><input data-f="name" value="${esc(p.programs[key].name)}"></td>
        <td><input data-f="visits" ${num(p.programs[key].visits)}></td>
        <td><input data-f="perThousand" ${num(p.programs[key].perThousand)}></td>
        <td><input data-f="minimum" ${num(p.programs[key].minimum)}></td>
        <td></td>
      </tr>`;
    const addOnRow = (a) => `
      <tr data-addon="${esc(a.id)}">
        <td><input data-f="name" value="${esc(a.name)}"></td>
        <td><input data-f="visits" ${num(a.visits)}></td>
        <td><input data-f="perThousand" ${num(a.perThousand)}></td>
        <td><input data-f="minimum" ${num(a.minimum)}></td>
        <td><button class="btn small subtle" data-remove title="Remove">✕</button></td>
      </tr>`;
    const head = '<thead><tr><th>Name</th><th>Visits / yr</th><th>$ per 1,000 sq ft per visit</th><th>Minimum $ per visit</th><th></th></tr></thead>';

    app.innerHTML = `
      <section class="pricing-page">
        <h1>Pricing</h1>
        <p class="muted">Each item is priced as <b>the greater of (sq ft ÷ 1,000 × rate) or the minimum, per visit, × visits per year</b>. Match these to your Aspire kits.</p>
        <label class="toggle"><input type="checkbox" id="placeholderFlag" ${p.placeholder ? 'checked' : ''}><span>These are placeholder prices (shows a warning on every quote)</span></label>
        <h2>Programs</h2>
        <div class="table-wrap"><table class="price-table">${head}<tbody>${programRow('tc')}${programRow('tcplus')}</tbody></table></div>
        <h2>Add-ons</h2>
        <div class="table-wrap"><table class="price-table">${head}<tbody id="addOnRows">${p.addOns.map(addOnRow).join('')}</tbody></table></div>
        <p class="muted small">Keep the aeration rows as <code>aeration</code> (warm season) and <code>aeration_overseed</code> (cool season). Turf Care+ uses them for its included aeration.</p>
        <div class="pricing-actions">
          <button class="btn" id="addAddOn">+ Add add-on</button>
          <button class="btn primary" id="savePricing">Save pricing</button>
        </div>
      </section>`;

    const rows = document.getElementById('addOnRows');
    rows.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (!btn) return;
      const tr = btn.closest('tr');
      if (['aeration', 'aeration_overseed'].includes(tr.dataset.addon) && !confirm('Turf Care+ uses this row for its included aeration. Remove anyway?')) return;
      tr.remove();
    });
    document.getElementById('addAddOn').addEventListener('click', () => {
      rows.insertAdjacentHTML('beforeend', addOnRow({ id: 'addon_' + Date.now().toString(36), name: '', visits: 1, perThousand: 0, minimum: 0 }));
      rows.lastElementChild.querySelector('input').focus();
    });
    document.getElementById('savePricing').addEventListener('click', async () => {
      const read = (tr) => {
        const f = (k) => tr.querySelector(`[data-f="${k}"]`).value.trim();
        return { name: f('name'), visits: L.num(f('visits')) || 1, perThousand: L.num(f('perThousand')), minimum: L.num(f('minimum')) };
      };
      const next = { ...p, placeholder: document.getElementById('placeholderFlag').checked, programs: {}, addOns: [] };
      app.querySelectorAll('tr[data-program]').forEach((tr) => (next.programs[tr.dataset.program] = read(tr)));
      rows.querySelectorAll('tr[data-addon]').forEach((tr) => {
        const item = read(tr);
        if (item.name) next.addOns.push({ id: tr.dataset.addon, ...item });
      });
      if (!next.placeholder) delete next.note;
      try {
        state.pricing = await api('PUT', '/api/pricing', next);
        toast('Pricing saved');
        renderPricing();
      } catch (err) {
        alert('Could not save pricing: ' + err.message);
      }
    });
  }

  // ---- router --------------------------------------------------------------

  async function route() {
    const hash = location.hash || '#/';
    const [, page, id, step] = hash.split('/');
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (page || 'list')));
    try {
      if (!state.pricing) state.pricing = await api('GET', '/api/pricing');
      if (page === 'call' && id) {
        if (!state.call || state.call.id !== id) {
          await flushSave();
          let call = await api('GET', `/api/calls/${id}`);
          // Recover unsaved edits left in this browser (e.g. the tab closed mid-save).
          const draft = getLS(`tcg.draft.${id}`);
          if (draft) {
            try {
              call = JSON.parse(draft);
              state.call = call;
              state.dirty = true;
              save();
            } catch { delLS(`tcg.draft.${id}`); }
          }
          state.call = call;
        }
        renderCall(step);
        window.scrollTo(0, 0);
      } else {
        await flushSave();
        if (page === 'pricing') renderPricing();
        else renderList();
      }
    } catch (err) {
      console.error(err);
      app.innerHTML = `<div class="empty"><p>Something went wrong: ${esc(err.message)}</p><a class="btn" href="#/">Back to calls</a></div>`;
    }
  }

  window.addEventListener('hashchange', route);
  route();
})();
