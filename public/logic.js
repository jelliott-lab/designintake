// Shared, DOM-free logic: quote math, labels and the Aspire summary text.
// Loaded in the browser as window.Logic and in Node tests via require().
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LABELS = {
    services: {
      turf_care: 'Turf care / fertilization & weed control',
      mowing: 'Mowing / maintenance',
      pest: 'Pest control (mosquito, flea & tick, etc.)',
      aeration: 'Aeration / overseeding',
      landscaping: 'Landscaping / enhancements',
      other: 'Other',
    },
    season: { warm: 'Warm season', cool: 'Cool season (Fescue)', unknown: "Doesn't know" },
    warmType: { bermuda: 'Bermuda', zoysia: 'Zoysia', centipede: 'Centipede', st_augustine: 'St. Augustine', unknown: 'Not sure' },
    decision: { today: 'Wants a quote and to decide today', research: 'Just doing research' },
    outcome: {
      sold: 'SOLD — activate account',
      quote_emailed: 'Quote emailed — account manager to follow up',
      site_visit: 'Account manager site visit requested',
      not_interested: 'Not interested',
      research: 'Research only — no quote',
    },
  };

  function num(v) {
    const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
    return isFinite(n) ? n : 0;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function money(n) {
    return '$' + num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function totalSqft(quote) {
    quote = quote || {};
    return num(quote.frontSqft) + num(quote.backSqft) + num(quote.otherSqft);
  }

  // Price of one item for a year: max(minimum, sqft/1000 * rate) per visit, times visits.
  function itemPrice(item, sqft) {
    const perVisit = Math.max(num(item.minimum), (sqft / 1000) * num(item.perThousand));
    return round2(perVisit * (num(item.visits) || 1));
  }

  // Turf Care+ includes aeration (warm season) or aeration & overseeding (cool season).
  function includedAerationId(grass) {
    return grass && grass.season === 'warm' ? 'aeration' : 'aeration_overseed';
  }

  function tcPlusIncludesAeration(call) {
    const q = call.quote || {};
    return q.program === 'tcplus' && !q.removeAeration;
  }

  function calcQuote(call, pricing) {
    const q = call.quote || {};
    const sqft = totalSqft(q);
    const lines = [];
    const program = pricing.programs && pricing.programs[q.program];
    const addOnById = {};
    (pricing.addOns || []).forEach((a) => (addOnById[a.id] = a));

    if (program) {
      lines.push({ label: `${program.name} (${program.visits} treatments)`, amount: itemPrice(program, sqft) });
    }
    if (tcPlusIncludesAeration(call)) {
      const aer = addOnById[includedAerationId(call.grass)];
      if (aer) lines.push({ label: `${aer.name} — included with Turf Care+`, amount: itemPrice(aer, sqft) });
    }
    const included = tcPlusIncludesAeration(call) ? ['aeration', 'aeration_overseed'] : [];
    (q.addOns || []).forEach((id) => {
      const a = addOnById[id];
      if (a && !included.includes(id)) lines.push({ label: a.name, amount: itemPrice(a, sqft), addOn: true });
    });

    const calculated = round2(lines.reduce((s, l) => s + l.amount, 0));
    const override = String(q.priceOverride == null ? '' : q.priceOverride).trim();
    const total = override !== '' ? round2(num(override)) : calculated;
    return {
      sqft,
      lines,
      calculated,
      total,
      overridden: override !== '',
      placeholder: !!pricing.placeholder,
    };
  }

  function recommendedProgram(grass) {
    grass = grass || {};
    if (grass.season === 'cool') return { program: 'tcplus', reason: 'Fescue yards do best on Turf Care+ (fungicides + aeration & overseeding).' };
    if (grass.season === 'warm' && grass.warmType === 'zoysia') return { program: 'tcplus', reason: 'Zoysia is prone to disease in the growing season — Turf Care+ recommended.' };
    if (grass.season === 'warm') return { program: 'tc', reason: 'Turf Care is a great fit; offer Turf Care+ if they have had fungus problems.' };
    return null;
  }

  function fullName(c) {
    c = c || {};
    return [c.firstName, c.lastName].filter(Boolean).join(' ');
  }

  function fullAddress(c) {
    c = c || {};
    const cityLine = [c.city, [c.state, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return [c.street, cityLine].filter(Boolean).join(', ');
  }

  function mapsUrl(c) {
    const addr = fullAddress(c);
    return addr ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr) : '';
  }

  function yn(v) {
    return v === 'yes' ? 'Yes' : v === 'no' ? 'No' : v === 'unknown' ? "Doesn't know" : '—';
  }

  function or(v) {
    return v && String(v).trim() ? String(v).trim() : '—';
  }

  function buildSummary(call, pricing) {
    const c = call.contact || {};
    const qual = call.qual || {};
    const g = call.grass || {};
    const q = call.quote || {};
    const cl = call.close || {};
    const out = [];
    const date = new Date(call.createdAt || Date.now()).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

    out.push(`TURF CARE PHONE INTAKE — ${date}`);
    out.push(`Taken by: ${or(call.repName)}`);
    out.push(`Outcome: ${LABELS.outcome[cl.outcome] || 'Not recorded'}`);
    out.push('');
    out.push('CONTACT');
    out.push(`Name: ${or(fullName(c))}`);
    out.push(`Phone: ${or(c.phone)}${c.phoneIsPreferred === 'no' ? ' (not preferred)' : c.phoneIsPreferred === 'yes' ? ' (preferred)' : ''}`);
    if (c.altPhone) out.push(`Preferred / alt phone: ${c.altPhone}`);
    out.push(`Email: ${or(c.email)}`);
    out.push(`Address: ${or(fullAddress(c))}`);
    const services = (call.servicesWanted || []).map((s) => (s === 'other' && call.servicesOther ? `Other: ${call.servicesOther}` : LABELS.services[s] || s));
    out.push(`Services interested in: ${services.length ? services.join('; ') : '—'}`);
    out.push('');
    out.push('QUALIFICATION');
    const current = qual.hasCurrentService === 'yes' ? `Yes${qual.currentProvider ? ' — ' + qual.currentProvider : ''}` : yn(qual.hasCurrentService);
    out.push(`Current lawn care service: ${current}`);
    if (qual.whyChange) out.push(`Why they're changing: ${qual.whyChange}`);
    out.push(`Decision timing: ${LABELS.decision[qual.decisionTiming] || '—'}`);
    out.push('');
    out.push('LAWN');
    let grassLine = LABELS.season[g.season] || '—';
    if (g.season === 'warm') grassLine += ` — ${LABELS.warmType[g.warmType] || 'type not given'}`;
    out.push(`Grass type: ${grassLine}`);
    out.push(`Front different from back: ${yn(g.frontBackDifferent)}${g.frontBackDifferent === 'yes' && g.frontBackNotes ? ' — ' + g.frontBackNotes : ''}`);
    if (g.season === 'unknown' || g.frontBackDifferent === 'unknown') out.push('** Account manager to confirm turf type on site **');
    const sqft = totalSqft(q);
    const parts = [['front', q.frontSqft], ['back', q.backSqft], ['other', q.otherSqft]].filter((p) => num(p[1])).map((p) => `${p[0]} ${num(p[1]).toLocaleString()}`);
    out.push(`Turf area: ${sqft ? sqft.toLocaleString() + ' sq ft' : '—'}${parts.length > 1 ? ` (${parts.join(' / ')})` : ''}`);

    if (q.program && pricing) {
      const quote = calcQuote(call, pricing);
      out.push('');
      out.push('QUOTE');
      quote.lines.forEach((l) => out.push(`  ${l.label}: ${money(l.amount)}`));
      if (q.program === 'tcplus' && q.removeAeration) out.push('  (Aeration removed — customer does it themselves)');
      if (quote.overridden) out.push(`  Calculated: ${money(quote.calculated)} — rep adjusted price`);
      out.push(`Annual total: ${money(quote.total)}`);
      if (quote.placeholder) out.push('!! Quoted from PLACEHOLDER pricing — verify against Aspire kits !!');
    }

    out.push('');
    out.push('NEXT STEPS');
    if (cl.outcome === 'sold') out.push(`First treatment date: ${or(cl.firstTreatmentDate)}`);
    out.push(`Sent to account manager: ${cl.handoffToRep ? 'Yes' + (cl.accountManager ? ' — ' + cl.accountManager : '') : 'No'}`);
    if (cl.handoffReason) out.push(`Reason: ${cl.handoffReason}`);
    if (cl.followUp) out.push(`Follow-up: ${cl.followUp}`);

    if (call.notes && call.notes.trim()) {
      out.push('');
      out.push('CALL NOTES');
      out.push(call.notes.trim());
    }
    return out.join('\n');
  }

  return {
    LABELS,
    num,
    money,
    totalSqft,
    itemPrice,
    calcQuote,
    recommendedProgram,
    includedAerationId,
    tcPlusIncludesAeration,
    fullName,
    fullAddress,
    mapsUrl,
    buildSummary,
  };
});
