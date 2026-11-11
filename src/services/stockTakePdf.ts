/**
 * One approved stock take as a PDF: who counted and approved it, its totals in
 * shillings, every difference with its reason, and the products that matched.
 * Same look as the sales report (services/salesReport.ts).
 */
import { format } from 'date-fns';
import { formatCurrency } from '../utils/format';
import { monthNames, t, tData } from '../i18n';
import type { StockTake, StockTakeItem } from '../db';
import { summarize, UNKNOWN_REASON } from './stockTake';

type RGB = [number, number, number];

function longDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()} ${monthNames()[d.getMonth()]} ${d.getFullYear()}, ${format(d, 'HH:mm')}`;
}

export async function exportStockTakePdf(take: StockTake, items: StockTakeItem[], shopName: string, currency: string) {
  const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new JsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 14;
  // The PDF's own fonts have no typographic minus: an ordinary hyphen.
  const money = (n: number) => formatCurrency(Math.abs(n), currency);
  const signed = (n: number) => (n < 0 ? `-${money(n)}` : n > 0 ? `+${money(n)}` : money(0));

  const brand: RGB = [37, 99, 235];
  const red: RGB = [185, 28, 28];
  const green: RGB = [21, 128, 61];

  // ---- Title
  doc.setFillColor(...brand);
  doc.rect(0, 0, pageW, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(t('Hesabu ya Stoo'), M, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(shopName || '', M, 22);
  doc.text(longDate(take.approved_at || take.started_at), pageW - M, 22, { align: 'right' });

  // ---- Who
  let y = 40;
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9.5);
  const lines = [
    t('Imeanzishwa na {name}: {when}', { name: take.started_by_name || '', when: longDate(take.started_at) }),
    take.submitted_by_name ? t('Imetumwa na {name}: {when}', { name: take.submitted_by_name, when: longDate(take.submitted_at) }) : '',
    take.approved_by_name ? t('Imeidhinishwa na {name}: {when}', { name: take.approved_by_name, when: longDate(take.approved_at) }) : '',
    take.scope === 'all'
      ? t('Duka zima: bidhaa {counted} zimehesabiwa kati ya {total}', { counted: items.length, total: take.total_products ?? items.length })
      : t('Bidhaa {counted} zilizochaguliwa', { counted: items.length }),
  ].filter(Boolean);
  for (const line of lines) { doc.text(line, M, y); y += 5.5; }

  // ---- Totals
  const s = summarize(items);
  y += 3;
  const boxW = (pageW - M * 2 - 9) / 4;
  const tiles: [string, string, RGB][] = [
    [t('Zilizopungua ({n})', { n: s.lostCount }), `-${money(s.lost)}`, red],
    [t('Zilizozidi ({n})', { n: s.extraCount }), `+${money(s.extra)}`, green],
    [t('Bila maelezo'), `-${money(s.unexplained)}`, red],
    [t('Tofauti halisi'), signed(s.net), s.net < 0 ? red : green],
  ];
  tiles.forEach(([label, value, color], i) => {
    const x = M + i * (boxW + 3);
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, boxW, 18, 2, 2, 'FD');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(label.toUpperCase(), x + 3, y + 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...color);
    doc.text(value, x + 3, y + 13.5);
    doc.setFont('helvetica', 'normal');
  });
  y += 27;

  const tableStyle = {
    theme: 'striped' as const,
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: brand, textColor: 255, fontStyle: 'bold' as const },
    alternateRowStyles: { fillColor: [246, 248, 251] as RGB },
    margin: { left: M, right: M },
  };
  const heading = (text: string, at: number) => {
    let hy = at;
    if (hy > pageH - 40) { doc.addPage(); hy = 20; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(40, 40, 40);
    doc.text(text, M, hy);
    doc.setFont('helvetica', 'normal');
    return hy + 4;
  };
  const after = () => (doc as any).lastAutoTable.finalY + 11;
  const rightCols = (...cols: number[]) => ({
    columnStyles: Object.fromEntries(cols.map(c => [c, { halign: 'right' as const }])),
    didParseCell: (data: any) => { if (data.section === 'head' && cols.includes(data.column.index)) data.cell.styles.halign = 'right'; },
  });

  // ---- Differences, biggest loss first
  const diffs = items
    .filter(i => i.counted_qty !== i.expected_qty)
    .sort((a, b) => (a.counted_qty - a.expected_qty) * a.buy_price - (b.counted_qty - b.expected_qty) * b.buy_price);
  if (diffs.length) {
    autoTable(doc, {
      ...tableStyle,
      startY: heading(t('Bidhaa zenye tofauti ({n})', { n: diffs.length }), y),
      head: [[t('Bidhaa'), t('Mfumo'), t('Rafuni'), t('Tofauti'), t('Thamani'), t('Sababu')]],
      body: diffs.map(i => {
        const d = i.counted_qty - i.expected_qty;
        return [
          i.product_name,
          String(i.expected_qty),
          String(i.counted_qty),
          d > 0 ? `+${d}` : String(d),
          signed(d * i.buy_price),
          d > 0 ? t('Zimezidi') : tData(i.reason || UNKNOWN_REASON),
        ];
      }),
      ...rightCols(1, 2, 3, 4),
    });
    y = after();
  }

  // ---- Matched
  const same = items.filter(i => i.counted_qty === i.expected_qty).sort((a, b) => a.product_name.localeCompare(b.product_name));
  if (same.length) {
    autoTable(doc, {
      ...tableStyle,
      startY: heading(t('Bidhaa {n} zimelingana na mfumo', { n: same.length }), y),
      head: [[t('Bidhaa'), t('Idadi')]],
      body: same.map(i => [i.product_name, String(i.counted_qty)]),
      ...rightCols(1),
    });
    y = after();
  }

  // ---- Signature
  if (y > pageH - 45) { doc.addPage(); y = 20; }
  doc.setFontSize(9.5);
  doc.setTextColor(40, 40, 40);
  doc.text(t('Sahihi: __________________________'), M, y + 6);
  doc.text(t('Tarehe: {format}', { format: format(new Date(), 'dd/MM/yyyy') }), M, y + 14);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 150);
    doc.text(t('Imetengenezwa na Venics Sales'), M, pageH - 8);
    doc.text(t('Ukurasa {i}/{pages}', { i, pages }), pageW - M, pageH - 8, { align: 'right' });
  }

  doc.save(`hesabu-ya-stoo_${format(new Date(take.approved_at || take.started_at), 'yyyy-MM-dd')}.pdf`);
}
