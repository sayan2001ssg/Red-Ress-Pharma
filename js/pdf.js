/* Red Ress Billing — bill PDF (A4), laid out like the printed retail invoice / cash memo.
 * Uses pdf-lib (bundled in /vendor). Coordinates below are millimetres from the top-left corner. */
(function () {
  'use strict';
  const MM = 72 / 25.4, PW = 210, PH = 297;

  // Standard PDF fonts only cover Western characters; swap the few we use and drop the rest.
  const clean = t => String(t ?? '')
    .replace(/₹/g, 'Rs.').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/×/g, 'x')
    .replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

  async function makeBillPdf(b, s, U) {
    const {PDFDocument, StandardFonts, rgb} = window.PDFLib;
    const pdf = await PDFDocument.create();
    const firm = (s.name || '').replace(/^M\/S\.?\s*/i, '');
    pdf.setTitle(`Bill ${b.blNo} - ${b.partyName}`);
    pdf.setAuthor(firm); pdf.setCreator('Red Ress Billing'); pdf.setProducer('Red Ress Billing');
    pdf.setSubject(`Retail invoice dated ${U.dmy(b.date)}`);
    const F = await pdf.embedFont(StandardFonts.Helvetica);
    const FB = await pdf.embedFont(StandardFonts.HelveticaBold);
    const FI = await pdf.embedFont(StandardFonts.HelveticaOblique);
    const BLACK = rgb(0, 0, 0), WHITE = rgb(1, 1, 1), GREY = rgb(0.87, 0.87, 0.87), DARK = rgb(0.08, 0.08, 0.08);

    const ROWS = 11, chunks = [];
    for (let i = 0; i < b.items.length; i += ROWS) chunks.push(b.items.slice(i, i + ROWS));
    if (!chunks.length) chunks.push([]);

    const W = [16, 18, 62, 20, 14, 16, 16, 24], X = [12];
    W.forEach(w => X.push(X[X.length - 1] + w));

    chunks.forEach((items, pi) => {
      const page = pdf.addPage([PW * MM, PH * MM]);
      const last = pi === chunks.length - 1;
      const Y = y => (PH - y) * MM;
      const text = (t, x, y, o = {}) => {
        const font = o.font || F, size = o.size || 9; t = clean(t); if (!t) return;
        const w = font.widthOfTextAtSize(t, size);
        const xx = o.align === 'center' ? x * MM - w / 2 : o.align === 'right' ? x * MM - w : x * MM;
        page.drawText(t, {x: xx, y: Y(y), size, font, color: o.color || BLACK});
      };
      const width = (t, font, size) => font.widthOfTextAtSize(clean(t), size) / MM;
      const wrap = (t, font, size, maxW) => {
        const words = clean(t).split(' ').filter(Boolean); const lines = []; let cur = '';
        for (const w of words) {
          const nxt = cur ? cur + ' ' + w : w;
          if (width(nxt, font, size) <= maxW) cur = nxt;
          else { if (cur) lines.push(cur); cur = w; while (width(cur, font, size) > maxW && cur.length > 1) { let k = cur.length - 1; while (k > 1 && width(cur.slice(0, k), font, size) > maxW) k--; lines.push(cur.slice(0, k)); cur = cur.slice(k); } }
        }
        if (cur) lines.push(cur);
        return lines;
      };
      const line = (x1, y1, x2, y2, t = 0.8, dash) => page.drawLine({start: {x: x1 * MM, y: Y(y1)}, end: {x: x2 * MM, y: Y(y2)}, thickness: t, color: BLACK, dashArray: dash});
      const dotted = (x1, y, x2) => line(x1, y, x2, y, 0.5, [1, 2]);
      const rect = (x, y, w, h, o = {}) => page.drawRectangle({x: x * MM, y: Y(y + h), width: w * MM, height: h * MM,
        borderWidth: o.fill && !o.border ? 0 : (o.t || 0.8), borderColor: o.fill && !o.border ? undefined : BLACK, color: o.fill});

      // frame + firm header
      rect(8, 8, 194, 281, {t: 1.1});
      String(s.dlNos || '').split(/\n|,/).map(x => x.trim()).filter(Boolean).slice(0, 3)
        .forEach((x, i) => text((i ? '' : 'DL. No. ') + x, i ? 12 + width('DL. No. ', FB, 7.5) : 12, 15 + i * 4, {font: FB, size: 7.5}));
      const ttl = 'RETAIL INVOICE / CASH MEMO / BILL';
      text(ttl, 103, 15, {font: FB, size: 10.5, align: 'center'});
      const tw = width(ttl, FB, 10.5); line(103 - tw / 2, 16.2, 103 + tw / 2, 16.2, 0.8);
      let nameSize = 21; while (nameSize > 12 && width(s.name, FB, nameSize) > 140) nameSize -= 1;
      text(s.name, 103, 25.5, {font: FB, size: nameSize, align: 'center'});
      wrap(s.address, F, 8.5, 130).slice(0, 2).forEach((l, i) => text(l, 103, 31 + i * 4, {size: 8.5, align: 'center'}));
      text('Mobile ' + (s.mobile || ''), 103, 39.5, {font: FB, size: 9.5, align: 'center'});
      text('GSTIN : ' + (s.gstin || ''), 12, 42, {font: FB, size: 9.5});
      page.drawCircle({x: 186 * MM, y: Y(23), size: 10 * MM, color: DARK});
      page.drawCircle({x: 186 * MM, y: Y(23), size: 8.6 * MM, borderColor: WHITE, borderWidth: 0.8});
      text(s.initials || '', 186, 25, {font: FB, size: 12, align: 'center', color: WHITE});
      text(s.tagline || '', 186, 38.5, {font: FB, size: 7.5, align: 'center'});

      // party box
      rect(12, 45, 122, 36);
      text('M/s', 15, 53, {size: 9}); dotted(22, 54, 131);
      text(b.partyName, 24, 52.5, {font: FB, size: 11});
      text(wrap(b.address, F, 10, 105)[0] || '', 24, 62, {size: 10}); dotted(15, 63, 131);
      text('Dispatched Through', 15, 72, {size: 9}); dotted(46, 73, 131);
      const dsp = wrap(b.dispatch, F, 10, 82);
      text(dsp[0] || '', 47, 71.5, {size: 10}); if (dsp[1]) text(dsp.slice(1).join(' '), 24, 78, {size: 10}); dotted(15, 79, 131);

      // bill box
      rect(138, 45, 60, 36);
      text('BL. No.', 141, 53, {size: 9}); text('Date', 141, 62, {size: 9}); text('DL. No.', 141, 71, {size: 9});
      dotted(153, 54, 195); dotted(153, 63, 195); dotted(153, 72, 195); dotted(153, 78, 195);
      text(b.blNo, 155, 52.5, {font: FB, size: 10.5}); text(U.dmy(b.date), 155, 61.5, {font: FB, size: 10.5});
      String(b.dlNo || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean).slice(0, 2).forEach((x, i) => text(x, 155, 71 + i * 6.5, {font: FB, size: 9.5}));

      // items table
      const T0 = 85, H1 = 95, TB = 207;
      rect(12, T0, 186, 10, {fill: GREY});
      rect(12, T0, 186, TB - T0, {t: 1.1}); line(12, H1, 198, H1, 1.1);
      X.slice(1, -1).forEach(x => line(x, T0, x, TB));
      const heads = [['QTY./', 'SCH.'], ['PACK'], ['PRODUCT NAME'], ['BATCH', 'NO.'], ['EXP'], ['MRP'], ['RATE'], ['AMOUNT']];
      heads.forEach((h, i) => { const cx = X[i] + W[i] / 2; if (h.length === 2) { text(h[0], cx, 89, {font: FB, size: 8, align: 'center'}); text(h[1], cx, 92.6, {font: FB, size: 8, align: 'center'}); } else text(h[0], cx, 91, {font: FB, size: 8, align: 'center'}); });
      items.forEach((it, i) => {
        const y = H1 + i * 10 + 6;
        text(U.plain(it.qty), X[0] + 2, y, {size: 9});
        text(`${U.plain(it.packA)} x ${U.plain(it.packB)}`, X[1] + 1.5, y, {size: 9});
        const pn = wrap(it.product, F, 9, W[2] - 4);
        if (pn[1]) { text(pn[0], X[2] + 2, y - 2, {size: 9}); text(pn[1], X[2] + 2, y + 2, {size: 9}); } else text(pn[0] || '', X[2] + 2, y, {size: 9});
        let bs = 8; while (bs > 6 && width(it.batch, F, bs) > W[3] - 2) bs -= 0.5;
        text(it.batch, X[3] + 1, y, {size: bs}); text(it.exp, X[4] + 1.5, y, {size: 8});
        text(U.money(it.mrp), X[6] - 1.5, y, {size: 9, align: 'right'});
        text(U.money(it.rate), X[7] - 1.5, y, {size: 9, align: 'right'});
        text(U.money(it.amount), X[8] - 1.5, y, {size: 9, align: 'right'});
      });
      if (!last) text('Continued on next page', 103, TB - 3, {font: FI, size: 9, align: 'center'});

      // totals and amount in words
      const LX = 104, VX = 168, RH = 8.4;
      const rows = [['Total Sale Value before adding GST', b.subtotal], ['Discount', b.discount],
        [`(+) SGST @ ${U.plain(b.gstPct / 2)}%`, b.sgst], [`(+) CGST @ ${U.plain(b.gstPct / 2)}%`, b.cgst], ['Total Sale Price with GST', b.total]];
      if (last) rect(LX, TB + RH * 4, 94, RH, {fill: GREY});
      rect(12, TB, 186, RH * 5, {t: 1.1});
      line(LX, TB, LX, TB + RH * 5); line(VX, TB, VX, TB + RH * 5);
      rows.forEach((r, i) => {
        if (i) line(LX, TB + RH * i, 198, TB + RH * i);
        text(r[0], LX + 2, TB + RH * i + 5.6, {font: FB, size: 8.5});
        if (last) text(U.money(r[1]), 196, TB + RH * i + 5.6, {font: i === 4 ? FB : F, size: 10, align: 'right'});
      });
      line(12, TB + RH * 4, LX, TB + RH * 4);
      text('Rs.', 14, TB + 6, {font: FB, size: 9}); text('(In words)', 21, TB + 6, {size: 8.5});
      if (last) wrap(U.inWords(b.total), FB, 9.5, 86).slice(0, 3).forEach((l, i) => text(l, 14, TB + 12 + i * 5, {font: FB, size: 9.5}));
      text('Sale/Transfer against central form (if any) C/F/H etc.', 14, TB + RH * 4 + 5.4, {size: 7.5});

      // terms and signature
      const FT = TB + RH * 5;
      rect(12, FT, 186, 285 - FT, {t: 1.1});
      text('TERMS & CONDITION', 15, FT + 6, {font: FB, size: 8.5});
      String(s.terms || '').split('\n').filter(l => l.trim()).slice(0, 4).forEach((l, i) => text(wrap(l, F, 8, 110)[0], 15, FT + 11 + i * 4.2, {size: 8}));
      text('For ' + firm, 195, FT + 6, {font: FB, size: 9.5, align: 'right'});
      text('(Authorised Signatory)', 195, 282, {font: FB, size: 8.5, align: 'right'});
      text(`Page ${pi + 1} of ${chunks.length}`, 105, 287.6, {size: 7, align: 'center'});
    });
    const bytes = await pdf.save();
    return new Blob([bytes], {type: 'application/pdf'});
  }

  window.RRPdf = {makeBillPdf};
})();
