import { formatCurrency } from './format';
import { format } from 'date-fns';

export interface ReceiptData {
  shopName: string;
  shopPhone?: string;
  shopLocation?: string;
  sellerName?: string;
  sellerEmail?: string;
  saleId: string;
  paymentMethod: string;
  isCredit: boolean;
  customerName?: string;
  customerPhone?: string;
  dueDate?: string;
  totalAmount: number;
  currency: string;
  items: Array<{
    name: string;
    qty: number;
    sell_price: number;
  }>;
}

// Basic HTML escaping so a product/customer name with < or & can't break the markup.
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function printReceipt(data: ReceiptData) {
  // Translate payment method to a Swahili friendly term.
  let njiaYaMalipo = 'Taslimu (Cash)';
  if (data.paymentMethod === 'mobile_money' || data.paymentMethod === 'mobile') {
    njiaYaMalipo = 'Simu (M-Pesa/Tigo)';
  } else if (data.paymentMethod === 'credit') {
    njiaYaMalipo = 'Mkopo (Deni)';
  } else if (data.paymentMethod === 'card') {
    njiaYaMalipo = 'Kadi';
  }

  const container = document.createElement('div');
  container.className = 'thermal-receipt-container';
  container.id = 'temp-receipt-print';
  // Modern system sans-serif (matches the print stylesheet) — cleaner than the old Courier look.
  container.style.fontFamily = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';

  // Each item: full name on its own line (no truncation), then "qty x unit  ....  total".
  const itemsHtml = data.items
    .map((item) => {
      const itemTotal = item.qty * item.sell_price;
      return `
        <div style="margin-bottom: 6px;">
          <div style="font-size: 11px; font-weight: 600; line-height: 1.25;">${esc(item.name)}</div>
          <div style="display: flex; justify-content: space-between; font-size: 10px;">
            <span>${item.qty} x ${item.sell_price.toLocaleString('en-US')}</span>
            <span style="font-weight: 700;">${itemTotal.toLocaleString('en-US')}</span>
          </div>
        </div>
      `;
    })
    .join('');

  const formattedDate = format(new Date(), 'dd/MM/yyyy  HH:mm');
  const miniId = data.saleId.substring(0, 8).toUpperCase();
  const totalQty = data.items.reduce((sum, i) => sum + i.qty, 0);

  const metaRow = (label: string, value: string, bold = false) => `
    <div style="display: flex; justify-content: space-between; gap: 8px;">
      <span style="color: #000;">${label}</span>
      <span style="text-align: right;${bold ? ' font-weight: 700;' : ''}">${value}</span>
    </div>`;

  const rule = (style = 'dashed', top = 6, bottom = 6) =>
    `<div style="border-top: 1px ${style} #000; margin: ${top}px 0 ${bottom}px;"></div>`;

  container.innerHTML = `
    <!-- ===== Header ===== -->
    <div style="text-align: center;">
      <div style="font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; line-height: 1.2;">
        ${esc(data.shopName)}
      </div>
      ${data.shopLocation ? `<div style="font-size: 10px; margin-top: 3px;">${esc(data.shopLocation)}</div>` : ''}
      ${data.shopPhone ? `<div style="font-size: 10px; margin-top: 1px;">Simu: ${esc(data.shopPhone)}</div>` : ''}
    </div>

    <div style="border-top: 2px solid #000; margin: 7px 0 5px;"></div>
    <div style="text-align: center; font-size: 10px; font-weight: 700; letter-spacing: 4px; margin-bottom: 6px;">
      RISITI YA MAUZO
    </div>

    <!-- ===== Meta ===== -->
    <div style="font-size: 10px; line-height: 1.55;">
      ${metaRow('Risiti Na.', '#' + miniId, true)}
      ${metaRow('Tarehe', formattedDate)}
      ${data.sellerName ? metaRow('Muuzaji', esc(data.sellerName)) : ''}
      ${metaRow('Malipo', njiaYaMalipo, true)}
      ${data.customerName ? metaRow('Mteja', esc(data.customerName)) : ''}
      ${data.customerPhone ? metaRow('Simu ya Mteja', esc(data.customerPhone)) : ''}
      ${data.dueDate ? metaRow('Siku ya Kulipa', format(new Date(data.dueDate), 'dd/MM/yyyy')) : ''}
    </div>

    ${rule('dashed', 7, 5)}

    <!-- ===== Items ===== -->
    <div style="display: flex; justify-content: space-between; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; padding-bottom: 4px; border-bottom: 1px solid #000; margin-bottom: 6px;">
      <span>BIDHAA</span>
      <span>JUMLA</span>
    </div>
    <div>${itemsHtml}</div>

    <div style="border-top: 1px solid #000; margin: 4px 0 6px;"></div>
    <div style="display: flex; justify-content: space-between; font-size: 10px;">
      <span>Idadi ya bidhaa</span>
      <span style="font-weight: 700;">${totalQty}</span>
    </div>

    <!-- ===== Grand total (boxed) ===== -->
    <div style="border: 2px solid #000; padding: 7px 9px; margin: 8px 0 6px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 12px; font-weight: 800; letter-spacing: 0.5px;">JUMLA KUU</span>
        <span style="font-size: 16px; font-weight: 800;">${formatCurrency(data.totalAmount, data.currency)}</span>
      </div>
      ${data.isCredit ? `
        <div style="display: flex; justify-content: space-between; font-size: 10px; font-weight: 700; font-style: italic; margin-top: 4px; padding-top: 4px; border-top: 1px dashed #000;">
          <span>DENI JIPYA</span>
          <span>${formatCurrency(data.totalAmount, data.currency)}</span>
        </div>` : ''}
    </div>

    <!-- ===== Footer ===== -->
    <div style="text-align: center; margin-top: 8px;">
      <div style="font-size: 11px; font-weight: 800; letter-spacing: 1px;">ASANTE KWA KUNUNUA!</div>
      <div style="font-size: 9px; margin-top: 2px;">Karibu tena ${esc(data.shopName)}.</div>
      ${data.shopPhone ? `<div style="font-size: 9px; margin-top: 1px;">Mawasiliano: ${esc(data.shopPhone)}</div>` : ''}
    </div>

    ${rule('dashed', 8, 4)}
    <div style="text-align: center; font-size: 8px; letter-spacing: 0.5px;">Imetengenezwa na Venics Sales</div>
  `;

  document.body.appendChild(container);

  try {
    const originalTitle = document.title;
    document.title = `${data.shopName}_Risiti_${miniId}`;
    window.print();
    document.title = originalTitle;
  } catch (err) {
    console.error('Error invoking print:', err);
  } finally {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}
