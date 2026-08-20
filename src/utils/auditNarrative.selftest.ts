/** npx tsx src/utils/auditNarrative.selftest.ts */
import { describeAudit } from './auditNarrative';

const show = (label: string, log: any) => {
  const n = describeAudit(log, 'TZS');
  console.log(`\n${label}  [${n.accent}]`);
  console.log(`  ${n.sentence}`);
  if (n.note) console.log(`  ↳ ${n.note}`);
};

show('discounted_sale', {
  action: 'discounted_sale',
  user_name: 'John',
  created_at: '2026-04-30T12:49:00',
  details: { original_price: 112000, price_on_discount: 100000, name_of_product: 'Apple' },
});

show('refund_sale (plural)', {
  action: 'refund_sale',
  user_name: 'Joyce',
  created_at: '2026-07-03T14:57:00',
  details: {
    amount: 123000,
    items: [{ name: 'Glass', qty: 1 }, { name: 'Chocolate', qty: 2 }],
    sale_date: '2026-07-03T09:15:00',
  },
});

show('refund_sale (singular, legacy row without sale_date)', {
  action: 'refund_sale',
  user_name: 'Joyce',
  created_at: '2026-07-03T14:57:00',
  details: { amount: 45000, items: [{ name: 'Glass', qty: 1 }], customer: 'Mama Asha' },
});

show('edit_product (two fields)', {
  action: 'edit_product',
  user_name: 'John',
  created_at: '2026-05-02T09:10:00',
  details: {
    name: 'Sukari 1kg',
    changes: { sell_price: { old: 5000, new: 6000 }, stock: { old: 20, new: 35 } },
  },
});

show('add_product', {
  action: 'add_product',
  user_name: 'Amina',
  created_at: '2026-05-02T10:00:00',
  details: { name: 'Maziwa 500ml', stock: 24, sell_price: 1500 },
});

show('delete_product', {
  action: 'delete_product', user_name: 'John',
  created_at: '2026-05-03T16:20:00', details: { name: 'Soda ya zamani' },
});

show('add_expense', {
  action: 'add_expense', user_name: 'Amina', created_at: '2026-05-03T18:05:00',
  details: { amount: 15000, category: 'Umeme', description: 'kununua luku' },
});

show('anomaly_heavy_discount', {
  action: 'anomaly_heavy_discount', user_name: 'John', created_at: '2026-05-04T11:30:00',
  details: { warning: 'Amepunguza bei chini ya bei ya kununulia. Bidhaa: Apple (Ameuza 800, Badala ya 1200)' },
});

console.log('');
