import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Sale } from '../db';
import { isOpenCreditSale, paidOn, hasOutstanding, outstanding } from '../utils/debt';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { format } from 'date-fns';
import { CheckCircle, Phone, User, History, Plus, X, CreditCard } from 'lucide-react';
import { SyncService } from '../services/sync';
import { TelemetryService } from '../services/telemetry';
import { v4 as uuidv4 } from 'uuid';
import NumberInput from '../components/NumberInput';
import { nowIso } from '../services/clock';

export default function Madeni() {
  const { user, showConfirm, showAlert } = useStore();
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';

  const [selectedDebt, setSelectedDebt] = useState<Sale | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [showHistory, setShowHistory] = useState<string | null>(null);
  
  // WhatsApp Reminder States
  const [whatsappDebt, setWhatsappDebt] = useState<Sale | null>(null);
  const [whatsappPhone, setWhatsappPhone] = useState<string>('');
  const [customMessage, setCustomMessage] = useState<string>('');

  const openWhatsAppModal = (debt: Sale, remaining: number) => {
    const shopName = settings?.shopName || 'duka letu';
    const text = `Habari ${debt.customer_name || 'Mteja'},\n\nHapa ni *${shopName}*. Tunakukumbusha kwa upendo salio la deni lako lililobaki la *${formatCurrency(remaining, currency)}* kwa ajili ya manunuzi uliyofanya hapa dukani.\n\nUnaweza kufanya malipo au kufika dukani kumalizia deni hili. Asante sana kwa kusaidia biashara yetu, tunathamini sana ushirikiano wako! 🙏✨`;
    setWhatsappDebt(debt);
    setWhatsappPhone(debt.customer_phone || '');
    setCustomMessage(text);
  };

  const executeWhatsAppSend = async () => {
    if (!whatsappDebt) return;
    
    // Normalize phone number (remove spaces, dashes)
    let cleanPhone = whatsappPhone.replace(/\s+/g, '').replace(/-/g, '').replace(/\+/g, '');
    if (!cleanPhone) {
      showAlert('Kosa', 'Tafadhali weka namba sahihi ya simu kabla ya kutuma.');
      return;
    }

    // Standardize East Africa code (e.g. TZS Tigo/Vodacom starts with 07/06)
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '255' + cleanPhone.substring(1);
    } else if (cleanPhone.length === 9) {
      cleanPhone = '255' + cleanPhone;
    }

    // Save phone number back to db if it has been updated, so the user doesn't have to re-enter it next time!
    if (whatsappPhone !== whatsappDebt.customer_phone) {
      await db.sales.update(whatsappDebt.id, {
        customer_phone: whatsappPhone,
        updated_at: nowIso(),
        synced: 0
      });
      SyncService.sync();
    }

    const encodedText = encodeURIComponent(customMessage);
    const whatsappUrl = `https://wa.me/${cleanPhone}/?text=${encodedText}`;
    
    // Open in a new tab
    window.open(whatsappUrl, '_blank');
    TelemetryService.trackWhatsAppDebtReminder(cleanPhone, whatsappDebt.total_amount);
    setWhatsappDebt(null);
  };
  
  const allSales = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.sales.filter(s => s.isDeleted !== 1 && s.shop_id === user.shopId).toArray();
  }, [user?.shopId]) || [];
  
  const saleItems = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.saleItems.filter(i => i.isDeleted !== 1 && i.shop_id === user.shopId).toArray();
  }, [user?.shopId]) || [];

  const debtPayments = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.debtPayments
      .where('shop_id')
      .equals(user.shopId)
      .filter(p => p.isDeleted !== 1)
      .toArray();
  }, [user?.shopId]) || [];
  
  // Same definition Dashibodi uses (utils/debt.ts), so the card and this list
  // can never show different totals again.
  const unpaidDebts = allSales
    .filter(s => isOpenCreditSale(s))
    .filter(s => hasOutstanding(s.total_amount, paidOn(s.id, debtPayments)))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const totalDebt = unpaidDebts.reduce(
    (sum, debt) => sum + outstanding(debt.total_amount, paidOn(debt.id, debtPayments)),
    0
  );

  const handleRecordPayment = async (saleId: string, amount: number) => {
    if (amount <= 0 || !user?.shopId) return;
    
    const sale = await db.sales.get(saleId);
    if (!sale) return;

    // Fetch current payments from DB to ensure accuracy
    const currentPayments = await db.debtPayments.where('sale_id').equals(saleId).toArray();
    const totalPaidSoFar = currentPayments.reduce((sum, p) => sum + p.amount, 0);
    const remaining = sale.total_amount - totalPaidSoFar;

    // Use a small epsilon (0.1) to handle floating point rounding issues
    if (amount > (remaining + 0.1)) {
      showAlert('Kosa', `Kiasi unacholipa (${formatCurrency(amount, currency)}) ni kikubwa kuliko deni lililobaki (${formatCurrency(remaining, currency)})`);
      return;
    }

    const paymentId = uuidv4();
    const now = nowIso();
    await db.debtPayments.add({
      id: paymentId,
      shop_id: user.shopId,
      sale_id: saleId,
      amount: amount,
      date: now,
      isDeleted: 0,
      created_at: now,
      updated_at: now,
      synced: 0
    });

    TelemetryService.trackDebtRepayment(amount);

    const currentHour = new Date().getHours();
    if ((currentHour >= 22 || currentHour <= 5) && amount >= 10000) {
      const settings = await db.settings.toCollection().last();
      if (!settings?.operate24Hours) {
        await SyncService.logAction('anomaly_debt_settle', {
          sale_id: saleId,
          amount_paid: amount,
          remaining_debt: remaining - amount,
          customer_name: sale.customer_name,
          employee_name: user?.name || 'Mhudumu',
          warning: `Kurejesha au kumalizika kwa deni la ${formatCurrency(amount, currency)} kumesajiliwa usiku wa manane (saa ${currentHour}:00). Hii inahitaji ukaguzi kwani ni nje ya masaa ya kawaida ya biashara yetu.`
        });
      }
    }

    // If the new total paid is equal to or very close to the total amount, mark as completed
    if ((totalPaidSoFar + amount) >= (sale.total_amount - 0.1)) {
      await db.sales.update(saleId, {
        status: 'completed',
        updated_at: nowIso(),
        synced: 0
      });
    } else {
      await db.sales.update(saleId, {
        updated_at: nowIso(),
        synced: 0
      });
    }
    
    SyncService.sync();
    setSelectedDebt(null);
    setPaymentAmount('');
  };

  const handleFullPayment = (debt: Sale) => {
    const payments = debtPayments.filter(p => p.sale_id === debt.id);
    const totalPaidSoFar = payments.reduce((sum, p) => sum + p.amount, 0);
    const remaining = debt.total_amount - totalPaidSoFar;

    showConfirm('Thibitisha Malipo', `Je, unathibitisha kuwa deni lote la ${formatCurrency(remaining, currency)} limelipwa?`, () => {
      handleRecordPayment(debt.id, remaining);
    });
  };

  return (
    <div className="max-w-7xl mx-auto w-full px-4 py-6 flex flex-col h-full bg-gray-50/20 font-sans gap-4">
      
      {/* Premium Adaptive Header & Debt Summary */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
        <div>
          <h1 className="text-xl font-black text-gray-950 tracking-tight">Daftari la Madeni (Credit Ledger)</h1>
          <p className="text-xs font-semibold text-gray-400 mt-0.5">
            Fuatilia mauzo ya mikopo na dhibiti malipo ya wateja
          </p>
        </div>

        <div className="bg-red-50 px-5 py-3 rounded-2xl border border-red-100/50 flex flex-col items-end shrink-0 select-none">
          <span className="text-[10px] uppercase font-black tracking-wider text-red-500">Jumla ya Madeni YOTE</span>
          <span className="text-xl font-black text-red-600 mt-0.5">{formatCurrency(totalDebt, currency)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between pb-1 border-b border-gray-100">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-400">Orodha ya Wanaodaiwa ({unpaidDebts.length})</h2>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {unpaidDebts.length === 0 ? (
          <div className="text-center text-gray-400 py-16 bg-white rounded-2xl border border-gray-100">
            Safi kabisa! Hakuna mteja anayedaiwa kwa sasa.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-6">
            {unpaidDebts.map(debt => {
              const payments = debtPayments.filter(p => p.sale_id === debt.id);
              const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
              const remaining = debt.total_amount - totalPaid;

              return (
                <div key={debt.id} className="bg-white p-5 rounded-2xl border border-gray-100 hover:border-red-100 hover:shadow-md transition-all flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-3 gap-2">
                      <div className="min-w-0">
                        <h3 className="font-extrabold text-gray-900 flex items-center text-sm truncate">
                          <User className="w-4 h-4 mr-1.5 text-blue-500 shrink-0" />
                          {debt.customer_name}
                        </h3>
                        {debt.customer_phone && (
                          <p className="text-xs font-semibold text-gray-400 flex items-center mt-1 truncate">
                            <Phone className="w-3.5 h-3.5 mr-1 text-gray-300" />
                            {debt.customer_phone}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-black text-red-600 text-sm">{formatCurrency(remaining, currency)}</div>
                        <div className="text-[10px] text-red-400 uppercase font-extrabold tracking-wider">Baki</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 mb-3.5">
                      <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                        <p className="text-[9px] text-gray-400 uppercase font-black tracking-wider">Bei ya Mwanzo</p>
                        <p className="text-xs font-black text-gray-700 mt-0.5">{formatCurrency(debt.total_amount, currency)}</p>
                      </div>
                      <div className="bg-green-50/50 p-2.5 rounded-xl border border-green-100/30">
                        <p className="text-[9px] text-green-500 uppercase font-black tracking-wider">Amelipa</p>
                        <p className="text-xs font-black text-green-700 mt-0.5">{formatCurrency(totalPaid, currency)}</p>
                      </div>
                    </div>

                    <div className="mb-4 bg-gray-50/60 p-3 rounded-xl border border-gray-100">
                      <div className="flex justify-between items-center mb-1.5">
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Bidhaa zilizochukuliwa:</p>
                        <button 
                          onClick={() => setShowHistory(showHistory === debt.id ? null : debt.id)}
                          className="text-[9px] font-black text-blue-600 hover:text-blue-700 uppercase flex items-center tracking-wider bg-blue-50 px-2 py-0.5 rounded"
                        >
                          <History className="w-2.5 h-2.5 mr-0.5" /> Historia
                        </button>
                      </div>
                      <div className="space-y-1">
                        {saleItems.filter(i => i.sale_id === debt.id).map((item, idx) => (
                          <div key={idx} className="text-xs text-gray-600 flex justify-between font-semibold">
                            <span className="truncate mr-2">{item.product_name} <span className="text-gray-400">x{item.qty}</span></span>
                            <span className="shrink-0">{formatCurrency(item.sell_price * item.qty, currency)}</span>
                          </div>
                        ))}
                      </div>

                      {showHistory === debt.id && payments.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-gray-200">
                          <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Historia ya Viwango vya Malipo:</p>
                          <div className="space-y-1">
                            {payments.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((p, idx) => (
                              <div key={idx} className="text-[10px] text-gray-500 flex justify-between font-bold">
                                <span>{format(new Date(p.created_at), 'dd/MM/yyyy')}</span>
                                <span className="text-green-600">+{formatCurrency(p.amount, currency)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t border-gray-100/80">
                    <button 
                      onClick={() => setSelectedDebt(debt)}
                      className="flex-1 flex items-center justify-center text-xs font-bold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 py-2.5 rounded-xl transition-all"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Lipa Kidogo
                    </button>
                    <button 
                      onClick={() => handleFullPayment(debt)}
                      className="flex-1 flex items-center justify-center text-xs font-bold text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100 py-2.5 rounded-xl transition-all"
                    >
                      <CheckCircle className="w-3.5 h-3.5 mr-1" />
                      Lipa Zote
                    </button>
                    <button 
                      onClick={() => openWhatsAppModal(debt, remaining)}
                      className="flex-1 flex items-center justify-center text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 py-2.5 rounded-xl border border-emerald-100 transition-all shadow-sm"
                    >
                      <span className="mr-1 text-[13px]">💬</span>
                      WhatsApp
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Partial Payment Modal */}
      {selectedDebt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-800">Rekodi Malipo</h3>
              <button onClick={() => setSelectedDebt(null)} className="p-1 text-gray-400">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="mb-4">
              <p className="text-sm text-gray-500 mb-1">Mteja: <span className="font-bold text-gray-800">{selectedDebt.customer_name}</span></p>
              <p className="text-sm text-gray-500">Deni Lililobaki: <span className="font-bold text-red-600">{formatCurrency(selectedDebt.total_amount - (debtPayments.filter(p => p.sale_id === selectedDebt.id).reduce((s, p) => s + p.amount, 0)), currency)}</span></p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Kiasi cha Malipo</label>
                <div className="relative">
                  <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <NumberInput
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder="Weka kiasi..."
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-bold text-lg"
                    autoFocus
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setSelectedDebt(null)}
                  className="py-3 bg-gray-100 text-gray-600 rounded-xl font-bold"
                >
                  Ghairi
                </button>
                <button 
                  onClick={() => handleRecordPayment(selectedDebt.id, Number(paymentAmount))}
                  disabled={!paymentAmount || Number(paymentAmount) <= 0}
                  className="py-3 bg-blue-600 text-white rounded-xl font-bold shadow-md shadow-blue-200 disabled:opacity-50"
                >
                  Hifadhi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Reminder Prompt Modal */}
      {whatsappDebt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl border border-slate-100 transform scale-100 transition-all">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-1.5">
                  <span className="text-xl">💬</span>
                  Kumbusha kwa WhatsApp
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Tuma ujumbe wa upole wa kukumbusha deni</p>
              </div>
              <button 
                onClick={() => setWhatsappDebt(null)} 
                className="p-1 px-2.5 py-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-full text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* Receiver Info */}
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100/60 flex flex-col space-y-1">
                <div className="text-xs font-bold text-slate-400 uppercase">Mteja Mdeni</div>
                <div className="text-sm font-black text-slate-800 flex items-center">
                  <User className="w-4 h-4 mr-1 text-slate-500" />
                  {whatsappDebt.customer_name}
                </div>
              </div>

              {/* Editable Phone input */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Namba ya Simu ya WhatsApp</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={whatsappPhone}
                    onChange={(e) => setWhatsappPhone(e.target.value)}
                    placeholder="Weka namba (mfano: 0712345678)"
                    className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none font-bold text-slate-700"
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Sajili/hariri namba hapa. Itahifadhiwa kiotomatiki kwa mteja huyu.</p>
              </div>

              {/* Message Draft */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Ujumbe wa Kikumbusho</label>
                <textarea
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  rows={5}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-slate-700 text-xs font-medium leading-relaxed resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <button 
                  onClick={() => setWhatsappDebt(null)}
                  className="py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs"
                >
                  Ghairi
                </button>
                <button 
                  onClick={executeWhatsAppSend}
                  disabled={!whatsappPhone.trim() || !customMessage.trim()}
                  className="py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-lg shadow-emerald-100 flex items-center justify-center space-x-1 disabled:opacity-50 transition-all cursor-pointer"
                >
                  <span>Tuma WhatsApp</span>
                  <span>🚀</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
