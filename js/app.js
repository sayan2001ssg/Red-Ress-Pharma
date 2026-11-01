/* Red Ress Billing — app screens and logic */
(function () {
  'use strict';
  const {openStorage, openDeviceStorage, DirFS, copyAll, readJSON, writeJSON, kvSet, kvDel} = window.RRStore;

  /* ---------- helpers ---------- */
  const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const money = n => Number(n || 0).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const plain = n => { const x = r2(num(n)); return Number.isInteger(x) ? String(x) : x.toFixed(2); };
  const dmy = iso => iso ? String(iso).split('-').reverse().join('/') : '';
  const isoOf = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
  const todayISO = () => isoOf(new Date());
  const slug = s => String(s || 'party').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'party';
  const firmName = s => String(s.name || '').replace(/^M\/S\.?\s*/i, '');
  const $ = id => document.getElementById(id);

  function inWords(n) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const two = x => x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '');
    const three = x => { const h = Math.floor(x / 100), r = x % 100; return (h ? ones[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : ''); };
    const conv = x => { if (!x) return 'Zero'; let s = ''; const cr = Math.floor(x / 1e7); x %= 1e7; const la = Math.floor(x / 1e5); x %= 1e5; const th = Math.floor(x / 1000); x %= 1000;
      if (cr) s += conv(cr) + ' Crore '; if (la) s += two(la) + ' Lakh '; if (th) s += two(th) + ' Thousand '; if (x) s += three(x); return s.trim(); };
    const v = r2(n); const rs = Math.floor(v); const ps = Math.round((v - rs) * 100);
    return 'Rupees ' + conv(rs) + (ps ? ' and ' + two(ps) + ' Paise' : '') + ' Only';
  }
  const U = {dmy, money, plain, inWords};

  /* Amount = Qty × a × Rate (pack is a × b) */
  const calcItem = it => r2(num(it.qty) * num(it.packA) * num(it.rate));
  function calcBill(b) {
    b.items.forEach(it => it.amount = calcItem(it));
    b.subtotal = r2(b.items.reduce((s, it) => s + it.amount, 0));
    b.discount = r2(num(b.discount));
    b.taxable = r2(b.subtotal - b.discount);
    b.gstPct = num(b.gstPct);
    b.sgst = r2(b.taxable * b.gstPct / 2 / 100);
    b.cgst = r2(b.taxable * b.gstPct / 2 / 100);
    b.total = r2(b.taxable + b.sgst + b.cgst);
    return b;
  }
  const baseName = b => `${b.date}_BL-${slug(b.blNo)}`;

  const DEFAULT_SETTINGS = {
    name: 'M/S. RED RESS PHARMA', tagline: 'Marketing Division', initials: 'RRP',
    address: 'Mohanpur (Panchanantala), Sewli Telinipara, Barrackpore, Kolkata - 700 121',
    mobile: '9088316371 / 7003901046', gstin: '19AMRPN6416A1ZX', dlNos: 'WB/NPG/727-SBW\nWB/NPG/727-SW',
    terms: 'Goods once sold will not be taken back.\nInterest@20% p.a. will be charged if bill is not paid within 30 days.', gstPct: 12
  };

  /* ---------- state ---------- */
  const S = {fs: null, settings: {...DEFAULT_SETTINGS}, parties: [], bills: [], draft: null, route: {name: 'dash'},
    filters: {partyId: 'all', preset: 'all', from: '', to: ''}, tab: 'bills', dashQ: '', partyForm: null, confirmDelete: false,
    locked: null, installPrompt: null, persisted: null};
  const app = $('app');

  function toast(t, action) {
    const el = $('toast'); el.innerHTML = esc(t) + (action ? ` <button type="button" id="toastAct">${esc(action.label)}</button>` : ''); el.hidden = false;
    if (action) $('toastAct').onclick = action.fn;
    clearTimeout(toast._t); toast._t = setTimeout(() => el.hidden = true, action ? 12000 : 3000);
  }
  async function busy(label, fn) {
    $('busyText').textContent = label; $('busy').hidden = false;
    try { return await fn(); }
    catch (e) { console.error(e); toast('Something went wrong: ' + (e && e.message || e)); return undefined; }
    finally { $('busy').hidden = true; }
  }
  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function shareFile(name, blob, title) {
    const file = new File([blob], name, {type: blob.type || 'application/octet-stream'});
    if (navigator.canShare && navigator.canShare({files: [file]})) {
      try { await navigator.share({files: [file], title}); } catch (e) { if (e.name !== 'AbortError') toast('Could not share: ' + e.message); }
    } else downloadBlob(name, blob);
  }
  const canShareFiles = () => { try { return !!(navigator.canShare && navigator.canShare({files: [new File(['x'], 'x.pdf', {type: 'application/pdf'})]})); } catch (e) { return false; } };

  /* ---------- loading & saving files ---------- */
  async function loadAll() {
    const fs = S.fs;
    let settings = await readJSON(fs, 'settings.json');
    if (!settings) { settings = {...DEFAULT_SETTINGS}; await writeJSON(fs, 'settings.json', settings); }
    S.settings = {...DEFAULT_SETTINGS, ...settings};
    let parties = await readJSON(fs, 'parties.json');
    if (!Array.isArray(parties)) { parties = []; await writeJSON(fs, 'parties.json', parties); }
    S.parties = parties;
    const bills = [];
    for (const p of await fs.list('bills/data')) {
      if (!p.endsWith('.json')) continue;
      const b = await readJSON(fs, p);
      if (b && Array.isArray(b.items)) { b.dataFile = p; if (!b.pdfFile) b.pdfFile = p.replace(/^bills\/data\//, 'bills/pdf/').replace(/\.json$/, '.pdf'); bills.push(calcBill(b)); }
    }
    S.bills = bills;
  }
  const saveParties = () => writeJSON(S.fs, 'parties.json', S.parties);
  const saveSettings = () => writeJSON(S.fs, 'settings.json', S.settings);

  async function uniquePaths(b) {
    const folder = slug(b.partyName); let base = baseName(b), i = 1;
    for (;;) {
      const data = `bills/data/${folder}/${base}.json`;
      const clash = S.bills.find(x => x.id !== b.id && x.dataFile === data);
      if (!clash) return {dataFile: data, pdfFile: `bills/pdf/${folder}/${base}.pdf`};
      i++; base = `${baseName(b)}-${i}`;
    }
  }
  async function writeBill(b) {
    const old = S.bills.find(x => x.id === b.id);
    const paths = await uniquePaths(b);
    if (old && old.dataFile && old.dataFile !== paths.dataFile) { await S.fs.remove(old.dataFile); await S.fs.remove(old.pdfFile); }
    Object.assign(b, paths);
    const rec = {...b}; delete rec._mode;
    await writeJSON(S.fs, b.dataFile, rec);
    await S.fs.write(b.pdfFile, await window.RRPdf.makeBillPdf(b, S.settings, U));
    S.bills = S.bills.filter(x => x.id !== b.id).concat(rec);
    return rec;
  }
  async function getPdf(b, regenerate) {
    let blob = regenerate ? null : await S.fs.read(b.pdfFile);
    if (!blob) { blob = await window.RRPdf.makeBillPdf(b, S.settings, U); await S.fs.write(b.pdfFile, blob); }
    return blob.type === 'application/pdf' ? blob : new Blob([blob], {type: 'application/pdf'});
  }

  /* ---------- routing (#/ hash, so the tablet back button works) ---------- */
  function parseRoute() {
    const [, name = '', id = ''] = (location.hash || '#/').match(/^#\/?([^/]*)\/?(.*)$/) || [];
    return {name: name || 'dash', id: decodeURIComponent(id)};
  }
  const go = h => { if (location.hash === h) render(); else location.hash = h; };
  window.addEventListener('hashchange', () => { S.confirmDelete = false; render(); });

  const partyById = id => S.parties.find(p => p.id === id);
  const billsOf = pid => S.bills.filter(b => b.partyId === pid);
  const nextBlNo = () => String(S.bills.reduce((mx, b) => Math.max(mx, parseInt(b.blNo, 10) || 0), 0) + 1);

  function presetRange(p) {
    const t = new Date(), y = t.getFullYear(), m = t.getMonth();
    if (p === 'month') return [isoOf(new Date(y, m, 1)), todayISO()];
    if (p === '3m') return [isoOf(new Date(y, m - 2, 1)), todayISO()];
    if (p === 'fy') { const fy = m >= 3 ? y : y - 1; return [isoOf(new Date(fy, 3, 1)), isoOf(new Date(fy + 1, 2, 31))]; }
    if (p === 'lfy') { const fy = (m >= 3 ? y : y - 1) - 1; return [isoOf(new Date(fy, 3, 1)), isoOf(new Date(fy + 1, 2, 31))]; }
    return ['', ''];
  }

  /* ---------- render ---------- */
  function render() {
    if (S.locked) { app.innerHTML = viewLocked(); return; }
    S.route = parseRoute();
    const r = S.route;
    $('brandName').textContent = firmName(S.settings);
    $('seal').textContent = S.settings.initials || 'RRP';
    const navKey = r.name === 'party' || r.name === 'register' ? 'register' : r.name === 'settings' ? 'settings' : r.name === 'dash' ? 'dash' : '';
    document.querySelectorAll('#nav .tab').forEach(b => b.setAttribute('aria-current', String(b.dataset.v === navKey)));
    let html;
    if (r.name === 'party') html = partyById(r.id) ? viewRegister(r.id) : notFound('That party');
    else if (r.name === 'register') html = viewRegister(null);
    else if (r.name === 'new' || r.name === 'edit') html = prepareDraft(r) ? viewForm() : notFound('That bill');
    else if (r.name === 'review') { if (!S.draft) return go('#/'); html = viewReview(); }
    else if (r.name === 'bill') html = viewBill(r.id);
    else if (r.name === 'settings') html = viewSettings();
    else html = viewDash();
    app.innerHTML = html;
    if (r.name === 'new' || r.name === 'edit') updateCalc();
    if (r.name === 'settings') fillStorageInfo();
    if (!render.keepScroll) window.scrollTo({top: 0}); render.keepScroll = false;
  }
  const notFound = what => `<div class="empty">${what} could not be found. <button class="btn" data-act="go" data-to="#/">Back to parties</button></div>`;

  function viewLocked() {
    return `<div class="gate panel">
      <h2>Allow access to your billing folder</h2>
      <p class="muted" style="margin:0">Your records are in the folder <b>${esc(S.locked.name)}</b> on this computer. The browser asks for permission again each time the app opens.</p>
      <div class="row-actions"><button class="btn primary" data-act="unlock">Allow access to ${esc(S.locked.name)}</button>
      <button class="btn" data-act="forgetfolder">Stop using this folder</button></div></div>`;
  }

  /* ----- dashboard ----- */
  function viewDash() {
    const q = S.dashQ.toLowerCase();
    const rows = S.parties.filter(p => !q || p.name.toLowerCase().includes(q) || (p.address || '').toLowerCase().includes(q))
      .map(p => { const bs = billsOf(p.id); return {p, n: bs.length, total: bs.reduce((s, b) => s + b.total, 0), last: bs.map(b => b.date).sort().pop() || ''}; })
      .sort((a, b) => (b.last || '').localeCompare(a.last || '') || a.p.name.localeCompare(b.p.name));
    const [mf, mt] = presetRange('month'), [ff, ft] = presetRange('fy');
    const tot = (f, t) => S.bills.filter(b => (!f || b.date >= f) && (!t || b.date <= t)).reduce((s, b) => s + b.total, 0);
    return `
    <div class="head"><div><div class="eyebrow">Dashboard</div><h1>Parties (M/S)</h1></div>
      <button class="btn" data-act="addparty">+ Add M/S</button></div>
    <div class="stats">
      <div class="stat"><span>Parties</span><b>${S.parties.length}</b></div>
      <div class="stat"><span>Bills saved</span><b>${S.bills.length}</b></div>
      <div class="stat"><span>Billed this month</span><b>₹${money(tot(mf, mt))}</b></div>
      <div class="stat"><span>Billed this FY</span><b>₹${money(tot(ff, ft))}</b></div>
      <div class="stat"><span>Billed all time</span><b>₹${money(tot())}</b></div>
    </div>
    ${S.partyForm ? partyFormHTML() : ''}
    ${S.parties.length ? `<div class="toolbar"><label class="f" style="max-width:380px">Search M/S
      <input id="dashQ" type="search" placeholder="Party name or address" value="${esc(S.dashQ)}" autocomplete="off"></label></div>` : ''}
    ${rows.length ? `<div class="cards">${rows.map(({p, n, total, last}) => `
      <button class="card" data-act="go" data-to="#/party/${encodeURIComponent(p.id)}">
        <div><h3>${esc(p.name)}</h3><div class="addr">${esc([p.address, p.dispatch].filter(Boolean).join(' · ') || 'No address yet')}</div></div>
        <dl><div><dt>Bills</dt><dd>${n}</dd></div><div><dt>Billed</dt><dd>₹${money(total)}</dd></div><div><dt>Last bill</dt><dd>${last ? dmy(last) : '—'}</dd></div></dl>
      </button>`).join('')}</div>`
      : S.parties.length ? `<div class="empty">No party matches “${esc(S.dashQ)}”.</div>`
      : S.partyForm ? '' : `<div class="empty"><b style="color:var(--fg)">No parties yet</b><span>Add the shops and agencies you bill. Each one gets its own page of bills and goods sold.</span><button class="btn primary" data-act="addparty">+ Add your first M/S</button></div>`}`;
  }

  function partyFormHTML() {
    const f = S.partyForm, hasBills = f.id && billsOf(f.id).length;
    return `<section class="panel stack" id="partyForm">
      <h2>${f.id ? 'Edit M/S details' : 'Add a new M/S'}</h2>
      <div class="grid">
        <label class="f">M/S name *<input id="pf_name" value="${esc(f.name)}" placeholder="e.g. Saha Agencies" autocomplete="off"></label>
        <label class="f">Address<input id="pf_address" value="${esc(f.address)}" placeholder="e.g. B.N. Bose" autocomplete="off"></label>
        <label class="f">Dispatched through<input id="pf_dispatch" value="${esc(f.dispatch)}" placeholder="e.g. Talpukur, Kolkata - 700123" autocomplete="off"></label>
        <label class="f">DL No<input id="pf_dlNo" value="${esc(f.dlNo)}" placeholder="e.g. 10345 (S), 10423 (S.B)" autocomplete="off"></label>
      </div>
      <div class="muted" style="font-size:13px">These fill in automatically on new bills and can be changed per bill.</div>
      <div id="pf_msg"></div>
      <div class="row-actions"><button class="btn primary" data-act="saveparty">${f.id ? 'Save changes' : 'Add M/S'}</button><button class="btn" data-act="cancelparty">Cancel</button>
      ${f.id ? (hasBills ? '' : `<button class="btn danger small" data-act="delparty" style="margin-left:auto">Delete this M/S</button>`) : ''}</div>
    </section>`;
  }

  /* ----- register (all parties or one party) ----- */
  function filteredBills(pid) {
    const f = S.filters;
    const [from, to] = f.preset === 'custom' ? [f.from, f.to] : presetRange(f.preset);
    const party = pid || f.partyId;
    return S.bills.filter(b => (party === 'all' || b.partyId === party) && (!from || b.date >= from) && (!to || b.date <= to))
      .sort((a, b) => b.date.localeCompare(a.date) || (parseInt(b.blNo) || 0) - (parseInt(a.blNo) || 0));
  }
  function registerData(pid) {
    const bills = filteredBills(pid);
    const lines = bills.flatMap(b => b.items.map(it => ({b, it})));
    const byProd = {};
    lines.forEach(({it}) => { const k = String(it.product).trim().toLowerCase(); const e = byProd[k] || (byProd[k] = {name: it.product, units: 0, amount: 0, bills: 0}); e.units += num(it.qty) * num(it.packA); e.amount += it.amount; e.bills++; });
    return {bills, lines, prods: Object.values(byProd).sort((a, b) => b.amount - a.amount)};
  }
  const partyName = b => partyById(b.partyId)?.name || b.partyName;

  function viewRegister(pid) {
    const party = pid ? partyById(pid) : null;
    const f = S.filters, {bills, lines, prods} = registerData(pid);
    const sum = k => bills.reduce((s, b) => s + (b[k] || 0), 0);
    const presets = [['all', 'All time'], ['month', 'This month'], ['3m', 'Last 3 months'], ['fy', 'This financial year'], ['lfy', 'Last financial year'], ['custom', 'Choose dates']];
    const showParty = !party;
    let table = '';
    if (!bills.length) table = `<div class="empty">No bills in this period${party ? ' for ' + esc(party.name) : ''}.${party ? `<button class="btn primary" data-act="newbill" data-id="${esc(party.id)}">+ Add a bill</button>` : ''}</div>`;
    else if (S.tab === 'bills') table = `<div class="scroll"><table class="t"><thead><tr><th>Date</th><th>BL No</th>${showParty ? '<th>M/S</th>' : ''}<th class="r">Items</th><th class="r">Before GST</th><th class="r">GST</th><th class="r">Total</th><th>PDF file</th></tr></thead><tbody>
      ${bills.map(b => `<tr class="click" data-act="go" data-to="#/bill/${encodeURIComponent(b.id)}"><td class="num">${dmy(b.date)}</td><td class="num">${esc(b.blNo)}</td>${showParty ? `<td>${esc(partyName(b))}</td>` : ''}<td class="r num">${b.items.length}</td><td class="r num">${money(b.taxable)}</td><td class="r num">${money(b.sgst + b.cgst)}</td><td class="r num"><b>${money(b.total)}</b></td><td class="file">${esc(b.pdfFile)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="${showParty ? 4 : 3}">Total of ${bills.length} bill${bills.length > 1 ? 's' : ''}</td><td class="r num">${money(sum('taxable'))}</td><td class="r num">${money(sum('sgst') + sum('cgst'))}</td><td class="r num">${money(sum('total'))}</td><td></td></tr></tfoot></table></div>`;
    else if (S.tab === 'goods') table = `<div class="scroll"><table class="t"><thead><tr><th>Date</th><th>BL No</th>${showParty ? '<th>M/S</th>' : ''}<th>Product</th><th>Batch</th><th>Exp</th><th class="r">Qty</th><th>Pack</th><th class="r">MRP</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>
      ${lines.map(({b, it}) => `<tr class="click" data-act="go" data-to="#/bill/${encodeURIComponent(b.id)}"><td class="num">${dmy(b.date)}</td><td class="num">${esc(b.blNo)}</td>${showParty ? `<td>${esc(partyName(b))}</td>` : ''}<td>${esc(it.product)}</td><td class="num">${esc(it.batch)}</td><td class="num">${esc(it.exp)}</td><td class="r num">${plain(it.qty)}</td><td class="num">${plain(it.packA)} x ${plain(it.packB)}</td><td class="r num">${money(it.mrp)}</td><td class="r num">${money(it.rate)}</td><td class="r num">${money(it.amount)}<span class="formula">${plain(it.qty)} × ${plain(it.packA)} × ${money(it.rate)}</span></td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="${showParty ? 10 : 9}">Item total (before discount and GST)</td><td class="r num">${money(lines.reduce((s, l) => s + l.it.amount, 0))}</td></tr></tfoot></table></div>`;
    else table = `<div class="scroll"><table class="t"><thead><tr><th>Product</th><th class="r">Times billed</th><th class="r">Units (qty × a)</th><th class="r">Amount</th></tr></thead><tbody>
      ${prods.map(p => `<tr><td>${esc(p.name)}</td><td class="r num">${p.bills}</td><td class="r num">${plain(p.units)}</td><td class="r num">${money(p.amount)}</td></tr>`).join('')}</tbody></table></div>`;
    return `
    <div class="head"><div>
        <div class="eyebrow">${party ? '<button class="btn link" data-act="go" data-to="#/">Parties</button> / M/S' : 'Sales register'}</div>
        <h1>${party ? esc(party.name) : 'All goods sold'}</h1>
        ${party ? `<div class="muted" style="margin-top:4px">${esc([party.address, party.dispatch].filter(Boolean).join(' · '))}${party.dlNo ? ` · DL No ${esc(party.dlNo)}` : ''}</div>` : ''}
      </div>
      ${party ? `<button class="btn" data-act="editparty" data-id="${esc(party.id)}">Edit details</button><button class="btn primary" data-act="newbill" data-id="${esc(party.id)}">+ Add bill for ${esc(party.name)}</button>` : ''}
    </div>
    ${S.partyForm ? partyFormHTML() : ''}
    <div class="panel" style="padding:14px"><div class="toolbar">
      ${party ? '' : `<label class="f">M/S<select id="fParty"><option value="all">All parties</option>${S.parties.map(p => `<option value="${esc(p.id)}" ${f.partyId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`}
      <label class="f">Period<select id="fPreset">${presets.map(([k, l]) => `<option value="${k}" ${f.preset === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${f.preset === 'custom' ? `<label class="f">From<input type="date" id="fFrom" value="${f.from}"></label><label class="f">To<input type="date" id="fTo" value="${f.to}"></label>` : ''}
      ${f.preset !== 'all' && f.preset !== 'custom' ? `<span class="muted" style="padding-bottom:10px">${presetRange(f.preset).map(dmy).join(' – ')}</span>` : ''}
    </div></div>
    <div class="stats">
      <div class="stat"><span>Bills</span><b>${bills.length}</b></div>
      <div class="stat"><span>Sale value before GST</span><b>₹${money(sum('taxable'))}</b></div>
      <div class="stat"><span>GST (SGST + CGST)</span><b>₹${money(sum('sgst') + sum('cgst'))}</b></div>
      <div class="stat"><span>Total with GST</span><b>₹${money(sum('total'))}</b></div>
    </div>
    <div class="head"><div class="segs" role="group" aria-label="View">
      <button data-act="tab" data-v="bills" aria-pressed="${S.tab === 'bills'}">Bills (${bills.length})</button>
      <button data-act="tab" data-v="goods" aria-pressed="${S.tab === 'goods'}">Goods sold (${lines.length})</button>
      <button data-act="tab" data-v="products" aria-pressed="${S.tab === 'products'}">By product (${prods.length})</button></div>
      ${bills.length ? `<button class="btn small" data-act="csv" data-id="${esc(pid || '')}">Export this list (.csv)</button>` : ''}</div>
    ${table}`;
  }

  function exportCsv(pid) {
    const {bills, lines, prods} = registerData(pid);
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    let rows;
    if (S.tab === 'bills') rows = [['Date', 'BL No', 'M/S', 'Items', 'Before discount', 'Discount', 'Before GST', 'SGST', 'CGST', 'Total', 'PDF file'],
      ...bills.map(b => [dmy(b.date), b.blNo, partyName(b), b.items.length, b.subtotal, b.discount, b.taxable, b.sgst, b.cgst, b.total, b.pdfFile])];
    else if (S.tab === 'goods') rows = [['Date', 'BL No', 'M/S', 'Product', 'Batch', 'Exp', 'Qty', 'Pack a', 'Pack b', 'MRP', 'Rate', 'Amount'],
      ...lines.map(({b, it}) => [dmy(b.date), b.blNo, partyName(b), it.product, it.batch, it.exp, it.qty, it.packA, it.packB, it.mrp, it.rate, it.amount])];
    else rows = [['Product', 'Times billed', 'Units', 'Amount'], ...prods.map(p => [p.name, p.bills, p.units, r2(p.amount)])];
    const name = `${pid ? slug(partyById(pid)?.name) : 'all-parties'}_${S.tab}_${todayISO()}.csv`;
    downloadBlob(name, new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], {type: 'text/csv'}));
  }

  /* ----- bill entry ----- */
  const blankItem = () => ({qty: '', packA: '', packB: '', product: '', batch: '', exp: '', mrp: '', rate: '', amount: 0});
  function newDraft(pid) {
    const p = pid ? partyById(pid) : null;
    return {_mode: 'new', id: null, partyId: p?.id || '', partyName: p?.name || '', address: p?.address || '', dispatch: p?.dispatch || '', dlNo: p?.dlNo || '',
      blNo: nextBlNo(), date: todayISO(), items: [blankItem(), blankItem()], discount: 0, gstPct: S.settings.gstPct ?? 12};
  }
  function prepareDraft(r) {
    if (r.name === 'new') {
      if (!S.draft || S.draft._mode !== 'new') S.draft = newDraft(r.id || null);
      return true;
    }
    const b = S.bills.find(x => x.id === r.id); if (!b) return false;
    if (!S.draft || S.draft._mode !== 'edit' || S.draft.id !== b.id) S.draft = {...JSON.parse(JSON.stringify(b)), _mode: 'edit'};
    return true;
  }
  function viewForm() {
    const d = S.draft, edit = d._mode === 'edit';
    return `
    <div class="head"><div><div class="eyebrow">${edit ? 'Edit bill' : 'New bill'} · Step 1 of 2</div><h1>${d.partyName ? (edit ? 'Bill ' + esc(d.blNo) + ' for ' : 'Bill for ') + esc(d.partyName) : 'New bill'}</h1></div>
      <button class="btn" data-act="cancelform">Cancel</button><button class="btn primary" data-act="review">Review bill →</button></div>
    <section class="panel stack">
      <h3>Party &amp; bill details</h3>
      <div class="grid">
        <label class="f">M/S *<select id="d_party"><option value="">Choose a party…</option>${S.parties.map(p => `<option value="${esc(p.id)}" ${d.partyId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label class="f">Address<input id="d_address" value="${esc(d.address)}" autocomplete="off"></label>
        <label class="f">Dispatched through<input id="d_dispatch" value="${esc(d.dispatch)}" autocomplete="off"></label>
        <label class="f">BL No *<input id="d_blNo" value="${esc(d.blNo)}" inputmode="numeric" autocomplete="off"></label>
        <label class="f">Date *<input id="d_date" type="date" value="${esc(d.date)}"></label>
        <label class="f">DL No<input id="d_dlNo" value="${esc(d.dlNo)}" placeholder="Separate two numbers with a comma" autocomplete="off"></label>
      </div>
      <div class="muted" style="font-size:13px">Party not in the list? <button class="btn link" data-act="addparty" data-from="form">Add a new M/S</button>. Address, dispatch and DL No fill in from the party and can be changed for this bill.</div>
    </section>
    <section class="stack">
      <div class="head"><div><h3>Items</h3><div class="muted" style="font-size:13px">Amount = Qty × a × Rate, where Pack is a × b</div></div><button class="btn" data-act="additem">+ Add item</button></div>
      <div class="items" id="itemRows">${d.items.map(itemHTML).join('')}</div>
      <div><button class="btn" data-act="additem">+ Add item</button></div>
    </section>
    <section class="panel totals">
      <h3 style="margin-bottom:6px">Totals</h3>
      <div class="sum">
        <div class="row"><span>Total sale value before adding GST<span class="formula" id="f_sub"></span></span><b class="num" id="c_sub"></b></div>
        <div class="row"><label for="d_discount">Discount (₹)</label><input id="d_discount" class="num" inputmode="decimal" value="${esc(d.discount)}"></div>
        <div class="row"><span>Value after discount<span class="formula" id="f_tax"></span></span><b class="num" id="c_tax"></b></div>
        <div class="row"><label for="d_gst">(+) GST %, split SGST / CGST</label><input id="d_gst" class="num" inputmode="decimal" value="${esc(d.gstPct)}"></div>
        <div class="row"><span>SGST <span id="l_sgst"></span><span class="formula" id="f_sgst"></span></span><b class="num" id="c_sgst"></b></div>
        <div class="row"><span>CGST <span id="l_cgst"></span><span class="formula" id="f_cgst"></span></span><b class="num" id="c_cgst"></b></div>
        <div class="row total"><span>Total sale price with GST<span class="formula" id="f_tot"></span></span><b class="num" id="c_tot"></b></div>
      </div>
      <div class="muted" style="font-size:13px;margin-top:8px" id="c_words"></div>
    </section>
    <div id="formMsg"></div>
    <div class="row-actions" style="justify-content:flex-end"><button class="btn" data-act="cancelform">Cancel</button><button class="btn primary" data-act="review">Review bill →</button></div>`;
  }
  function itemHTML(it, i) {
    const f = (k, label, ph, mode = 'decimal', cls = k) => `<label class="f ${cls}">${label}<input data-row="${i}" data-f="${k}" value="${esc(it[k])}" placeholder="${ph}" ${mode ? `inputmode="${mode}"` : ''} autocomplete="off"></label>`;
    return `<div class="item">
      <span class="n">${i + 1}</span>
      ${f('qty', 'Qty', '5')}
      <label class="f pack">Pack (a × b)<span class="packbox"><input data-row="${i}" data-f="packA" value="${esc(it.packA)}" placeholder="20" inputmode="decimal" aria-label="Pack a"><span>×</span><input data-row="${i}" data-f="packB" value="${esc(it.packB)}" placeholder="10" inputmode="decimal" aria-label="Pack b"></span></label>
      ${f('product', 'Product name', 'e.g. Glimp MP2 Tab', '', 'prod')}
      ${f('batch', 'Batch no', 'Batch', '')}
      ${f('exp', 'Exp', 'MM/YY', '')}
      ${f('mrp', 'MRP', '0.00')}
      ${f('rate', 'Rate', '0.00')}
      <div class="amt"><span class="muted" style="font-size:11px;font-weight:600">Amount</span><b id="a_${i}">0.00</b><span class="formula" id="af_${i}"></span></div>
      <div class="del">${S.draft.items.length > 1 ? `<button class="btn small danger" data-act="delitem" data-i="${i}" aria-label="Remove item ${i + 1}">✕</button>` : ''}</div>
    </div>`;
  }
  function updateCalc() {
    const d = calcBill(S.draft);
    const set = (id, t) => { const el = $(id); if (el) el.textContent = t; };
    d.items.forEach((it, i) => { set('a_' + i, money(it.amount)); set('af_' + i, `${plain(it.qty)} × ${plain(it.packA)} × ${money(num(it.rate))}`); });
    const used = d.items.filter(it => it.amount);
    set('c_sub', money(d.subtotal)); set('f_sub', used.length ? used.map(it => money(it.amount)).join(' + ') : 'sum of item amounts');
    set('c_tax', money(d.taxable)); set('f_tax', `${money(d.subtotal)} − ${money(d.discount)}`);
    set('l_sgst', `@ ${plain(d.gstPct / 2)}%`); set('l_cgst', `@ ${plain(d.gstPct / 2)}%`);
    set('c_sgst', money(d.sgst)); set('f_sgst', `${money(d.taxable)} × ${plain(d.gstPct / 2)}%`);
    set('c_cgst', money(d.cgst)); set('f_cgst', `${money(d.taxable)} × ${plain(d.gstPct / 2)}%`);
    set('c_tot', '₹' + money(d.total)); set('f_tot', `${money(d.taxable)} + ${money(d.sgst)} + ${money(d.cgst)}`);
    set('c_words', d.total ? inWords(d.total) : '');
  }
  function validate(d) {
    const errs = [];
    if (!d.partyId) errs.push('Choose the M/S this bill is for.');
    if (!String(d.blNo).trim()) errs.push('Enter a BL No.');
    if (!d.date) errs.push('Enter the bill date.');
    const items = d.items.filter(it => String(it.product).trim() || num(it.qty) || num(it.rate) || num(it.packA));
    if (!items.length) errs.push('Add at least one item.');
    items.forEach((it, i) => {
      const miss = [];
      if (!String(it.product).trim()) miss.push('product name');
      if (!(num(it.qty) > 0)) miss.push('quantity');
      if (!(num(it.packA) > 0) || !(num(it.packB) > 0)) miss.push('pack (a × b)');
      if (!(num(it.rate) > 0)) miss.push('rate');
      if (miss.length) errs.push(`Item ${i + 1}: enter ${miss.join(', ')}.`);
    });
    if (num(d.discount) < 0) errs.push('Discount cannot be negative.');
    if (num(d.discount) > d.subtotal) errs.push('Discount is larger than the sale value.');
    if (num(d.gstPct) < 0 || num(d.gstPct) > 100) errs.push('GST % must be between 0 and 100.');
    return {errs, items};
  }
  function viewReview() {
    const d = S.draft;
    const dup = S.bills.find(b => b.id !== d.id && String(b.blNo).trim() === String(d.blNo).trim());
    const folder = slug(d.partyName);
    return `
    <div class="head"><div><div class="eyebrow">Step 2 of 2 · Check before saving</div><h1>Review bill ${esc(d.blNo)}</h1></div>
      <button class="btn" data-act="backedit">← Back to edit</button><button class="btn primary" data-act="confirm">Confirm &amp; save bill</button></div>
    ${dup ? `<div class="msg warn">BL No ${esc(d.blNo)} is already used by a bill for ${esc(partyName(dup))} dated ${dmy(dup.date)}. You can still save, or go back and change it.</div>` : ''}
    <div class="kv panel" style="padding:12px 16px"><span>Files that will be saved</span><div class="file">bills/data/${esc(folder)}/${esc(baseName(d))}.json</div><div class="file">bills/pdf/${esc(folder)}/${esc(baseName(d))}.pdf</div></div>
    <div class="sheet-wrap">${sheetHTML(d)}</div>
    <div class="row-actions" style="justify-content:flex-end"><button class="btn" data-act="backedit">← Back to edit</button><button class="btn primary" data-act="confirm">Confirm &amp; save bill</button></div>`;
  }

  /* ----- bill sheet (screen copy of the PDF) ----- */
  function sheetHTML(b) {
    const s = S.settings;
    const rows = b.items.map(it => `<tr><td>${plain(it.qty)} x</td><td>${plain(it.packA)} x ${plain(it.packB)}</td><td>${esc(it.product)}</td><td>${esc(it.batch)}</td><td>${esc(it.exp)}</td><td class="r">${money(it.mrp)}</td><td class="r">${money(it.rate)}</td><td class="r">${money(it.amount)}</td></tr>`).join('');
    const dl = String(b.dlNo || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean);
    return `<div class="sheet">
      <div class="top">
        <div><div class="dls">DL. No. ${esc(s.dlNos).replace(/\n/g, '<br>')}</div><div class="gst">GSTIN : ${esc(s.gstin)}</div></div>
        <div class="mid"><div class="ttl">RETAIL INVOICE / CASH MEMO / BILL</div><div class="nm">${esc(s.name)}</div><div class="ad">${esc(s.address)}</div><div class="mb">Mobile ${esc(s.mobile)}</div></div>
        <div class="logo"><div class="c">${esc(s.initials || '')}</div><small>${esc(s.tagline)}</small></div>
      </div>
      <div class="boxes">
        <div class="box">
          <div class="ln"><span>M/s</span><b>${esc(b.partyName)}</b></div>
          <div class="ln"><b>${esc(b.address)}</b></div>
          <div class="ln"><span>Dispatched Through</span><b>${esc(b.dispatch)}</b></div>
        </div>
        <div class="box">
          <div class="ln"><span>BL. No.</span><b>${esc(b.blNo)}</b></div>
          <div class="ln"><span>Date</span><b>${dmy(b.date)}</b></div>
          <div class="ln"><span>DL. No.</span><b>${esc(dl[0] || '')}</b></div>
          ${dl.slice(1).map(x => `<div class="ln"><span style="visibility:hidden">DL. No.</span><b>${esc(x)}</b></div>`).join('')}
        </div>
      </div>
      <table><thead><tr><th style="width:56px">Qty./ Sch.</th><th style="width:70px">Pack</th><th>Product Name</th><th style="width:86px">Batch No.</th><th style="width:50px">Exp</th><th style="width:62px">MRP</th><th style="width:62px">Rate</th><th style="width:90px">Amount</th></tr></thead>
        <tbody>${rows}<tr class="fill"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></tbody></table>
      <div class="foot">
        <div class="words"><div><b>Rs.</b> (In words) <span class="pen">${esc(inWords(b.total))}</span></div><div class="cf">Sale/Transfer against central form (if any) C/F/H etc.</div></div>
        <div class="tot">
          <div><span>Total Sale Value before adding GST</span><em>${money(b.subtotal)}</em></div>
          <div><span>Discount</span><em>${money(b.discount)}</em></div>
          <div><span>(+) SGST @ ${plain(b.gstPct / 2)}%</span><em>${money(b.sgst)}</em></div>
          <div><span>(+) CGST @ ${plain(b.gstPct / 2)}%</span><em>${money(b.cgst)}</em></div>
          <div><span>Total Sale Price with GST</span><em>${money(b.total)}</em></div>
        </div>
      </div>
      <div class="terms">
        <div class="t1"><b>TERMS &amp; CONDITION</b><br>${esc(s.terms).replace(/\n/g, '<br>')}</div>
        <div class="sig"><span>For ${esc(firmName(s))}</span><span>(Authorised Signatory)</span></div>
      </div>
    </div>`;
  }

  /* ----- bill page ----- */
  function viewBill(id) {
    const b = S.bills.find(x => x.id === id);
    if (!b) return notFound('That bill');
    const fileName = b.pdfFile.split('/').pop();
    return `
    <div class="head"><div><div class="eyebrow"><button class="btn link" data-act="go" data-to="#/party/${encodeURIComponent(b.partyId)}">${esc(partyName(b))}</button> / Bill</div><h1>BL No ${esc(b.blNo)} · ${dmy(b.date)}</h1></div>
      <button class="btn" data-act="go" data-to="#/edit/${encodeURIComponent(b.id)}">Edit</button>
      ${canShareFiles() ? `<button class="btn" data-act="sharepdf" data-id="${esc(b.id)}">Share PDF</button>` : ''}
      <button class="btn" data-act="openpdf" data-id="${esc(b.id)}">Open PDF</button>
      <button class="btn primary" data-act="dlpdf" data-id="${esc(b.id)}">Download PDF</button></div>
    <div class="panel stack" style="padding:14px 16px">
      <div class="kv"><span>PDF file name</span><div class="row-actions"><code class="file" id="fname" style="color:var(--fg);font-size:14px">${esc(fileName)}</code><button class="btn small" data-act="copy" data-t="${esc(fileName)}">Copy name</button></div></div>
      <div class="kv"><span>Saved at</span><code class="file">${esc(b.pdfFile)}</code><code class="file">${esc(b.dataFile)}</code></div>
    </div>
    <div class="sheet-wrap">${sheetHTML(b)}</div>
    <div class="row-actions">${S.confirmDelete
      ? `<span>Delete bill ${esc(b.blNo)} and both of its files? This can't be undone.</span><button class="btn danger" data-act="delbill" data-id="${esc(b.id)}">Yes, delete</button><button class="btn" data-act="canceldel">Keep it</button>`
      : `<button class="btn danger small" data-act="askdel">Delete this bill</button><button class="btn small" data-act="regen" data-id="${esc(b.id)}">Rebuild PDF with current firm details</button>`}</div>`;
  }

  /* ----- settings & data ----- */
  function viewSettings() {
    const s = S.settings;
    const fld = (k, l, ta, mode) => `<label class="f">${l}${ta ? `<textarea id="s_${k}">${esc(s[k])}</textarea>` : `<input id="s_${k}" value="${esc(s[k])}" ${mode ? `inputmode="${mode}"` : ''} autocomplete="off">`}</label>`;
    const kind = S.fs.kind;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    return `
    <div class="head"><div><div class="eyebrow">Settings</div><h1>Your firm &amp; data</h1></div></div>
    <section class="panel stack"><h3>Firm details printed on every bill</h3>
      <div class="grid">${fld('name', 'Firm name')}${fld('initials', 'Logo initials')}${fld('tagline', 'Line under logo')}${fld('gstin', 'GSTIN')}${fld('mobile', 'Mobile')}${fld('gstPct', 'Default GST % (split SGST / CGST)', false, 'decimal')}</div>
      <div class="grid">${fld('address', 'Address', 1)}${fld('dlNos', 'Firm DL Nos (one per line)', 1)}${fld('terms', 'Terms & condition (one per line)', 1)}</div>
      <div class="row-actions"><button class="btn primary" data-act="savesettings">Save firm details</button><span class="muted" style="font-size:13px">Saved bills keep their PDF. Use “Rebuild PDF” on a bill to reprint it with new details.</span></div></section>

    <section class="panel stack"><h3>Where your records are kept</h3>
      <div class="kv"><span>Storage</span><b>${esc(S.fs.label)}</b><span id="storageInfo" class="muted"></span></div>
      ${kind === 'folder' ? `<div class="row-actions"><button class="btn" data-act="unlinkfolder">Stop using this folder</button><span class="muted" style="font-size:13px">Your files stay in the folder, and a copy moves back into the app.</span></div>`
      : window.showDirectoryPicker ? `<div class="row-actions"><button class="btn" data-act="linkfolder">Use a folder on this computer…</button><span class="muted" style="font-size:13px">Keeps every bill as a file you can see in File Explorer / Finder. Your existing records are copied into it.</span></div>` : ''}
      <pre class="tree">${kind === 'folder' ? esc(S.fs.root.name) : 'billing-data'}/
  settings.json            firm details
  parties.json             your M/S list
  bills/data/&lt;M/S&gt;/&lt;date&gt;_BL-&lt;no&gt;.json   one file per bill
  bills/pdf/&lt;M/S&gt;/&lt;date&gt;_BL-&lt;no&gt;.pdf    the printed bill</pre>
    </section>

    <section class="panel stack"><h3>Backup &amp; restore</h3>
      <p class="muted" style="margin:0;max-width:68ch">A backup is a single .zip with every file above, bills and PDFs included. Keep one on Google Drive, a pen drive or email it to yourself every week. Restoring adds the files back; bills already on this device with the same file name are replaced.</p>
      <div class="row-actions"><button class="btn primary" data-act="backup">Download backup (.zip)</button>
        ${canShareFiles() ? '<button class="btn" data-act="sharebackup">Share backup</button>' : ''}
        <label class="btn" for="restoreFile">Restore from backup…</label><input type="file" id="restoreFile" accept=".zip,application/zip" hidden></div>
    </section>

    <section class="panel stack"><h3>App on this device</h3>
      ${standalone ? '<div class="msg ok">Running as an installed app. It works without internet.</div>'
      : isIOS ? '<div class="msg info">To add the icon on iPad: tap the Share button in Safari, then <b>Add to Home Screen</b>.</div>'
      : `<div class="msg info">To add the icon: use <b>Install app</b> at the top, or the browser menu ⋮ → <b>Add to Home screen</b> / <b>Install app</b>.</div>`}
      <div class="muted" style="font-size:13px">Version 1.0 · Works offline after the first open.</div>
    </section>`;
  }
  async function fillStorageInfo() {
    const el = $('storageInfo'); if (!el) return;
    const parts = [`${S.bills.length} bills, ${S.parties.length} parties`];
    try { const e = await navigator.storage?.estimate?.(); if (e && S.fs.kind !== 'folder') parts.push(`about ${(e.usage / 1048576).toFixed(1)} MB used`); } catch (e) {}
    if (S.fs.kind !== 'folder') parts.push(S.persisted ? 'protected from automatic clean-up' : 'the browser may clear it if the device runs low on space, so keep backups');
    el.textContent = parts.join(' · ');
  }

  /* ---------- actions ---------- */
  async function saveParty() {
    const f = S.partyForm; const g = k => $('pf_' + k).value.trim();
    const p = {name: g('name'), address: g('address'), dispatch: g('dispatch'), dlNo: g('dlNo')};
    const msg = $('pf_msg');
    if (!p.name) { msg.innerHTML = '<div class="msg err">Enter the M/S name.</div>'; $('pf_name').focus(); return; }
    if (S.parties.some(x => x.id !== f.id && x.name.toLowerCase() === p.name.toLowerCase())) { msg.innerHTML = `<div class="msg err">${esc(p.name)} is already in your list.</div>`; return; }
    let np;
    if (f.id) Object.assign(partyById(f.id), p);
    else { np = {id: uid(), ...p, createdAt: todayISO()}; S.parties.push(np); }
    const ok = await busy('Saving…', async () => { await saveParties(); return true; });
    if (!ok) return;
    S.partyForm = null;
    if (np && f.from === 'form' && S.draft) { Object.assign(S.draft, {partyId: np.id, partyName: np.name, address: np.address, dispatch: np.dispatch, dlNo: np.dlNo}); history.back(); toast(np.name + ' added'); return; }
    toast(f.id ? 'Details updated' : p.name + ' added');
    if (np) go('#/party/' + encodeURIComponent(np.id)); else render();
  }

  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const a = t.dataset.act, id = t.dataset.id;
    if (a === 'go') return go(t.dataset.to);
    if (a === 'install') { if (S.installPrompt) { S.installPrompt.prompt(); await S.installPrompt.userChoice; S.installPrompt = null; $('installBtn').hidden = true; } return; }
    if (a === 'addparty') {
      S.partyForm = {name: '', address: '', dispatch: '', dlNo: '', from: t.dataset.from || ''};
      if (t.dataset.from === 'form') location.hash = '#/'; else if (S.route.name !== 'dash') go('#/'); else render();
      setTimeout(() => { $('partyForm')?.scrollIntoView({block: 'start'}); $('pf_name')?.focus(); }, 30); return;
    }
    if (a === 'editparty') { S.partyForm = {...partyById(id)}; render.keepScroll = true; render(); $('partyForm')?.scrollIntoView({block: 'start'}); return; }
    if (a === 'cancelparty') { const back = S.partyForm?.from === 'form'; S.partyForm = null; if (back) history.back(); else { render.keepScroll = true; render(); } return; }
    if (a === 'saveparty') return saveParty();
    if (a === 'delparty') { const pid = S.partyForm.id; S.parties = S.parties.filter(p => p.id !== pid); await busy('Saving…', saveParties); S.partyForm = null; toast('M/S deleted'); return go('#/'); }
    if (a === 'tab') { S.tab = t.dataset.v; render.keepScroll = true; return render(); }
    if (a === 'csv') return exportCsv(id || null);
    if (a === 'newbill') { S.draft = newDraft(id || (S.route.name === 'party' ? S.route.id : null)); return go('#/new'); }
    if (a === 'cancelform') { S.draft = null; return go(S.route.name === 'edit' ? '#/bill/' + encodeURIComponent(S.route.id) : '#/'); }
    if (a === 'additem') { S.draft.items.push(blankItem()); redrawItems(); document.querySelector(`[data-row="${S.draft.items.length - 1}"][data-f="qty"]`)?.focus(); return; }
    if (a === 'delitem') { S.draft.items.splice(+t.dataset.i, 1); return redrawItems(); }
    if (a === 'review') {
      const d = calcBill(S.draft); const {errs, items} = validate(d);
      if (errs.length) { $('formMsg').innerHTML = `<div class="msg err">${errs.map(esc).join('<br>')}</div>`; $('formMsg').scrollIntoView({block: 'center'}); return; }
      d.items = items; calcBill(d); return go('#/review');
    }
    if (a === 'backedit') { if (!S.draft.items.length) S.draft.items.push(blankItem()); return history.back(); }
    if (a === 'confirm') {
      const d = calcBill(S.draft);
      const now = new Date().toISOString();
      const rec = {...d, id: d.id || uid(), createdAt: d.createdAt || now, updatedAt: d._mode === 'edit' ? now : undefined,
        items: d.items.map(it => ({qty: num(it.qty), packA: num(it.packA), packB: num(it.packB), product: String(it.product).trim(), batch: String(it.batch).trim(), exp: String(it.exp).trim(), mrp: num(it.mrp), rate: num(it.rate), amount: it.amount}))};
      const saved = await busy('Saving bill and PDF…', () => writeBill(calcBill(rec)));
      if (!saved) return;
      S.draft = null;
      location.replace('#/bill/' + encodeURIComponent(saved.id));
      toast(`Bill ${saved.blNo} saved as ${saved.pdfFile.split('/').pop()}`); return;
    }
    if (a === 'dlpdf' || a === 'openpdf' || a === 'sharepdf' || a === 'regen') {
      const b = S.bills.find(x => x.id === id); if (!b) return;
      const name = b.pdfFile.split('/').pop();
      const blob = await busy(a === 'regen' ? 'Rebuilding PDF…' : 'Preparing PDF…', () => getPdf(b, a === 'regen'));
      if (!blob) return;
      if (a === 'regen') return toast('PDF rebuilt with current firm details');
      if (a === 'dlpdf') return downloadBlob(name, blob);
      if (a === 'sharepdf') return shareFile(name, blob, `Bill ${b.blNo} - ${partyName(b)}`);
      const url = URL.createObjectURL(blob); const w = window.open(url, '_blank'); if (!w) downloadBlob(name, blob); setTimeout(() => URL.revokeObjectURL(url), 60000); return;
    }
    if (a === 'copy') {
      try { await navigator.clipboard.writeText(t.dataset.t); toast('File name copied'); }
      catch (_) { const r = document.createRange(); r.selectNodeContents($('fname')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('File name selected, copy it from the menu'); }
      return;
    }
    if (a === 'askdel') { S.confirmDelete = true; render.keepScroll = true; return render(); }
    if (a === 'canceldel') { S.confirmDelete = false; render.keepScroll = true; return render(); }
    if (a === 'delbill') {
      const b = S.bills.find(x => x.id === id); if (!b) return;
      const ok = await busy('Deleting…', async () => { await S.fs.remove(b.dataFile); await S.fs.remove(b.pdfFile); return true; });
      if (!ok) return;
      S.bills = S.bills.filter(x => x.id !== id); S.confirmDelete = false; toast('Bill deleted');
      return location.replace('#/party/' + encodeURIComponent(b.partyId));
    }
    if (a === 'savesettings') {
      ['name', 'initials', 'tagline', 'gstin', 'mobile', 'address', 'dlNos', 'terms'].forEach(k => S.settings[k] = $('s_' + k).value.trim());
      S.settings.gstPct = num($('s_gstPct').value);
      if (await busy('Saving…', async () => { await saveSettings(); return true; })) { toast('Firm details saved'); render.keepScroll = true; render(); }
      return;
    }
    if (a === 'backup' || a === 'sharebackup') {
      const blob = await busy('Building backup…', makeBackup); if (!blob) return;
      const name = `rr-billing-backup_${todayISO()}.zip`;
      return a === 'backup' ? downloadBlob(name, blob) : shareFile(name, blob, 'Red Ress Billing backup');
    }
    if (a === 'linkfolder') return linkFolder();
    if (a === 'unlinkfolder') return unlinkFolder();
    if (a === 'unlock') {
      const h = S.locked;
      if ((await h.requestPermission({mode: 'readwrite'})) === 'granted') { S.fs = new DirFS(h, 'folder', 'Folder on this computer: ' + h.name); S.locked = null; await busy('Opening records…', loadAll); render(); }
      else toast('Permission was not given. Choose “Allow” to open your folder.');
      return;
    }
    if (a === 'forgetfolder') { await kvDel('folder'); S.locked = null; S.fs = await openDeviceStorage(); await busy('Opening records…', loadAll); render(); }
  });

  function redrawItems() { $('itemRows').innerHTML = S.draft.items.map(itemHTML).join(''); updateCalc(); }

  async function makeBackup() {
    const zip = new JSZip();
    for (const p of await S.fs.list('')) { const b = await S.fs.read(p); if (b) zip.file(p, b); }
    zip.file('README.txt', `Red Ress Billing backup made on ${new Date().toLocaleString('en-IN')}.\nRestore it from Settings & data > Restore from backup.\n`);
    return zip.generateAsync({type: 'blob', compression: 'DEFLATE'});
  }
  async function restoreBackup(file) {
    const zip = await JSZip.loadAsync(file);
    if (!zip.file('settings.json') && !zip.file('parties.json')) throw new Error('this zip is not a Red Ress Billing backup');
    let n = 0;
    for (const [p, entry] of Object.entries(zip.files)) {
      if (entry.dir || p === 'README.txt' || p.includes('..')) continue;
      const blob = await entry.async('blob');
      await S.fs.write(p, p.endsWith('.pdf') ? new Blob([blob], {type: 'application/pdf'}) : blob); n++;
    }
    await loadAll();
    return n;
  }
  async function linkFolder() {
    let h; try { h = await window.showDirectoryPicker({id: 'rr-billing', mode: 'readwrite'}); } catch (e) { return; }
    const target = new DirFS(h, 'folder', 'Folder on this computer: ' + h.name);
    const ok = await busy('Copying your records into the folder…', async () => { await copyAll(S.fs, target, false); await kvSet('folder', h); S.fs = target; await loadAll(); return true; });
    if (ok) { toast('Now saving to the folder ' + h.name); render(); }
  }
  async function unlinkFolder() {
    const device = await openDeviceStorage();
    const ok = await busy('Copying records back into the app…', async () => { await copyAll(S.fs, device, true); await kvDel('folder'); S.fs = device; await loadAll(); return true; });
    if (ok) { toast('Records copied back into the app'); render(); }
  }

  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'dashQ') { S.dashQ = el.value; const pos = el.selectionStart; render.keepScroll = true; render(); const n = $('dashQ'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
    if (!S.draft || !['new', 'edit'].includes(S.route.name)) return;
    if (el.dataset.row != null) { S.draft.items[+el.dataset.row][el.dataset.f] = el.value; updateCalc(); return; }
    const map = {d_address: 'address', d_dispatch: 'dispatch', d_blNo: 'blNo', d_date: 'date', d_dlNo: 'dlNo', d_discount: 'discount', d_gst: 'gstPct'};
    if (map[el.id]) { S.draft[map[el.id]] = el.value; updateCalc(); }
  });
  document.addEventListener('change', async e => {
    const el = e.target;
    if (el.id === 'd_party') { const p = partyById(el.value); Object.assign(S.draft, {partyId: p?.id || '', partyName: p?.name || '', address: p?.address || '', dispatch: p?.dispatch || '', dlNo: p?.dlNo || ''}); render.keepScroll = true; render(); }
    else if (el.id === 'fParty') { S.filters.partyId = el.value; render.keepScroll = true; render(); }
    else if (el.id === 'fPreset') { S.filters.preset = el.value; if (el.value === 'custom' && !S.filters.from) { S.filters.from = presetRange('fy')[0]; S.filters.to = todayISO(); } render.keepScroll = true; render(); }
    else if (el.id === 'fFrom' || el.id === 'fTo') { S.filters[el.id === 'fFrom' ? 'from' : 'to'] = el.value; render.keepScroll = true; render(); }
    else if (el.id === 'restoreFile' && el.files[0]) {
      const n = await busy('Restoring backup…', () => restoreBackup(el.files[0]));
      el.value = '';
      if (n != null) { toast(`Restored ${n} files: ${S.parties.length} parties, ${S.bills.length} bills`); render(); }
    }
  });

  /* ---------- start ---------- */
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installPrompt = e; $('installBtn').hidden = false; });
  window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; toast('Installed. Open Red Ress Billing from your home screen.'); });

  async function boot() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast('A new version is ready.', {label: 'Reload', fn: () => location.reload()}); });
        });
      }).catch(e => console.warn('Offline mode unavailable', e));
    }
    try { S.persisted = await navigator.storage?.persisted?.(); if (!S.persisted) S.persisted = await navigator.storage?.persist?.(); } catch (e) {}
    try {
      const r = await openStorage();
      if (r.locked) { S.locked = r.locked; return render(); }
      S.fs = r.fs; await loadAll();
    } catch (e) {
      console.error(e);
      app.innerHTML = `<div class="gate panel"><h2>Records could not be opened</h2><p class="muted">${esc(e.message || e)}</p><p class="muted">Open the app from its web address (https) or from the start script, not by double-clicking index.html.</p></div>`;
      return;
    }
    render();
  }
  boot();
})();
