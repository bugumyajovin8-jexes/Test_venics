import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Expense } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { Plus, Trash2, Calendar, Tag, FileText, Wallet, ChevronDown, ChevronUp } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { SyncService } from '../services/sync';
import { TelemetryService } from '../services/telemetry';
import { format, startOfMonth } from 'date-fns';
import { nowIso } from '../services/clock';

const CATEGORIES = [
  'Kodi',
  'Umeme',
  'Maji',
  'Usafiri',
  'Mishahara',
  'Chakula',
  'Matengenezo',
  'Mengineyo'
];

const SWAHILI_MONTHS: Record<string, string> = {
  'January': 'Januari',
  'February': 'Februari',
  'March': 'Machi',
  'April': 'Aprili',
  'May': 'Mei',
  'June': 'Juni',
  'July': 'Julai',
  'August': 'Agosti',
  'September': 'Septemba',
  'October': 'Oktoba',
  'November': 'Novemba',
  'December': 'Desemba'
};

const formatSwahiliMonthYear = (dateStr: string) => {
  const d = new Date(dateStr);
  const monthName = format(d, 'MMMM');
  const year = format(d, 'yyyy');
  const swahiliMonth = SWAHILI_MONTHS[monthName] || monthName;
  return `${swahiliMonth} ${year}`;
};

export default function Matumizi() {
  const { user, showConfirm, showAlert, isBoss, isFeatureEnabled } = useStore();
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';

  const expenses = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    const list = await db.expenses.filter(e => e.isDeleted !== 1 && e.shop_id === user.shopId).toArray();
    return list.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (dateA !== dateB) return dateB - dateA;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [user?.shopId]) || [];
  
  const [isAdding, setIsAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formAmount, setFormAmount] = useState('');
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});

  const toggleMonth = (monthKey: string) => {
    setExpandedMonths(prev => ({
      ...prev,
      [monthKey]: !prev[monthKey]
    }));
  };

  if (!isBoss() && !isFeatureEnabled('staff_expense_management')) {
    return (
      <div className="p-8 text-center flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-4">
          <Wallet className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Hauna Ruhusa</h2>
        <p className="text-gray-500">Meneja wako hajakupa ruhusa ya kuona au kuongeza matumizi.</p>
      </div>
    );
  }

  const formatInputNumber = (val: string) => {
    let clean = val.replace(/[^0-9.]/g, '');
    const parts = clean.split('.');
    if (parts.length > 2) {
      clean = parts[0] + '.' + parts.slice(1).join('');
    }
    if (!clean) return '';
    if (clean.includes('.')) {
      const [integerPart, decimalPart] = clean.split('.');
      const formattedInt = integerPart ? Number(integerPart).toLocaleString() : '';
      return formattedInt + '.' + decimalPart;
    }
    return Number(clean).toLocaleString();
  };

  const parseInputNumber = (val: string) => {
    return Number(val.replace(/,/g, '')) || 0;
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      const formData = new FormData(e.currentTarget);
      const rawAmount = parseInputNumber(formAmount);
      const expense: Expense = {
        id: uuidv4(),
        shop_id: user?.shopId || '',
        amount: rawAmount,
        category: formData.get('category') as string,
        description: (formData.get('description') as string)?.trim() || 'Maelezo hayakuwekwa',
        date: formData.get('date') as string || nowIso(),
        created_at: nowIso(),
        updated_at: nowIso(),
        isDeleted: 0,
        synced: 0
      };

      await db.expenses.add(expense);
      TelemetryService.trackExpense(expense.category, expense.amount);
      
      // Anomaly Detection: Vague Round-Number Expenses
      const isRoundLarge = rawAmount >= 10000 && rawAmount % 5000 === 0;
      const descWords = expense.description.trim().split(/\s+/).length;
      const descLower = expense.description.toLowerCase();
      const isVague = descWords <= 2 || descLower === 'matumizi' || descLower === 'matumizi mengine';
      if (isRoundLarge && isVague) {
        await SyncService.logAction('anomaly_expense_vague_round', {
          expense_id: expense.id,
          amount: rawAmount,
          employee_name: user?.name || 'Mhudumu',
          description: expense.description,
          warning: `Gharama ya nambari kamili thubutu yenye maelezo mafupi mno yasiyojitosheleza duka. (Imeandikwa: "${expense.description}")`
        });
      }

      // Anomaly Detection: End-of-Day Sudden Expenses
      const currentHour = new Date().getHours();
      if ((currentHour >= 19 || currentHour <= 2) && !isVague) { 
        await SyncService.logAction('anomaly_expense_late', {
          expense_id: expense.id,
          amount: rawAmount,
          employee_name: user?.name || 'Mhudumu',
          description: expense.description,
          warning: `Matumizi yamesajiliwa kwa ghafla karibu au baada ya masaa ya kufunga duka (saa ${currentHour}:00).`
        });
      }

      // Anomaly Detection: Unusually High Daily Expenses
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentExpenses = expenses.filter(e => new Date(e.date) >= thirtyDaysAgo);
      const totalLast30Days = recentExpenses.reduce((sum, e) => sum + e.amount, 0);
      const averageDaily = totalLast30Days / 30;
      
      const today = new Date().toDateString();
      const todayTotal = expenses.filter(e => new Date(e.date).toDateString() === today).reduce((sum, e) => sum + e.amount, 0) + rawAmount;

      if (todayTotal > (averageDaily * 3) && rawAmount >= 20000 && averageDaily > 0) {
        await SyncService.logAction('anomaly_expense_spike', {
          expense_id: expense.id,
          amount: rawAmount,
          employee_name: user?.name || 'Mhudumu',
          today_total: todayTotal,
          average_daily: Math.round(averageDaily),
          warning: `Jumla ya matumizi ya leo (${formatCurrency(todayTotal, currency)}) ni makubwa sana ukilinganisha na wastani wa siku 30 zilizopita.`
        });
      }

      // Log audit for boss to see
      await SyncService.logAction('add_expense', {
        category: expense.category,
        amount: rawAmount,
        description: expense.description
      });

      setIsAdding(false);
      setFormAmount('');
      SyncService.sync().catch(err => console.error('Sync failed:', err));
    } catch (err: any) {
      console.error('Failed to save expense:', err);
      setError('Imeshindwa kuhifadhi matumizi. Tafadhali jaribu tena.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (id: string) => {
    const isBoss = user?.role === 'admin' || user?.role === 'boss';
    if (!isBoss) {
      showAlert('Kizuizi', 'Huna ruhusa ya kufuta matumizi haya.');
      return;
    }
    showConfirm('Futa Matumizi', 'Una uhakika unataka kufuta matumizi haya?', async () => {
      await db.expenses.update(id, { 
        isDeleted: 1,
        updated_at: nowIso(),
        synced: 0
      });
      SyncService.sync();
    });
  };

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  const currentMonthStart = startOfMonth(new Date()).getTime();
  const currentMonthExpenses = expenses
    .filter(e => new Date(e.date).getTime() >= currentMonthStart)
    .reduce((sum, e) => sum + e.amount, 0);
  const currentMonthLabel = formatSwahiliMonthYear(nowIso());

  interface GroupedExpenses {
    monthKey: string;
    isCurrentMonth: boolean;
    expenses: Expense[];
    totalAmount: number;
  }

  const grouped: GroupedExpenses[] = [];

  expenses.forEach(e => {
    const eDate = new Date(e.date);
    const monthKey = formatSwahiliMonthYear(e.date);
    const isCurrent = eDate.getTime() >= currentMonthStart;

    let group = grouped.find(g => g.monthKey === monthKey);
    if (!group) {
      group = {
        monthKey,
        isCurrentMonth: isCurrent,
        expenses: [],
        totalAmount: 0
      };
      grouped.push(group);
    }
    group.expenses.push(e);
    group.totalAmount += e.amount;
  });

  if (isAdding) {
    return (
      <div className="p-4 lg:p-8 bg-gray-50/50 min-h-full font-sans">
        <div className="max-w-2xl mx-auto bg-white p-6 md:p-8 rounded-3xl border border-gray-100 shadow-sm">
          <div className="flex items-center mb-6 pb-4 border-b border-gray-100">
            <button 
              onClick={() => setIsAdding(false)}
              className="text-blue-600 font-bold text-sm bg-blue-50 px-4 py-1.5 rounded-xl mr-4 hover:bg-blue-100 transition-all cursor-pointer"
            >
              ← Nyuma
            </button>
            <h1 className="text-lg font-black text-gray-900 tracking-tight">Ongeza Matumizi Mapya</h1>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-1">Kiasi cha Matumizi ({currency})</label>
              <input 
                required 
                type="text" 
                inputMode="numeric" 
                value={formAmount}
                onChange={e => setFormAmount(formatInputNumber(e.target.value))}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white outline-none transition-all text-sm font-semibold text-red-600" 
                placeholder="0"
                autoFocus
              />
            </div>
            
            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-1">Kundi (Category)</label>
              <select 
                required 
                name="category" 
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white outline-none transition-all text-sm font-semibold"
              >
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-1">Maelezo (Description)</label>
              <textarea 
                name="description" 
                rows={3}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white outline-none transition-all text-sm font-semibold"
                placeholder="Elezea kwa kifupi madhumuni ya matumizi haya..."
              ></textarea>
            </div>

            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-1">Tarehe ya Matumizi</label>
              <input 
                type="date" 
                name="date" 
                defaultValue={nowIso().split('T')[0]}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white outline-none transition-all text-sm font-semibold" 
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl font-bold">
                {error}
              </div>
            )}

            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-4 rounded-2xl mt-6 transition-all active:scale-95 shadow-lg shadow-blue-500/10 cursor-pointer"
            >
              {loading ? 'Inahifadhi...' : 'Hifadhi Matumizi'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto w-full px-4 py-6 flex flex-col h-full bg-gray-50/20 font-sans gap-4">
      
      {/* Premium Adaptive Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
        <div>
          <h1 className="text-xl font-black text-gray-950 tracking-tight">Matumizi ya Duka (Expenses)</h1>
          <p className="text-xs font-semibold text-gray-400 mt-0.5">
            Sajili na udhibiti matumizi ya duka ili kupata faida halisi
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 shrink-0">
          <div className="bg-orange-50 px-5 py-3 rounded-2xl border border-orange-100/50 flex flex-col items-end select-none">
            <span className="text-[10px] uppercase font-black tracking-wider text-orange-600">Jumla Matumizi Yote</span>
            <span className="text-xl font-black text-orange-700 mt-0.5">{formatCurrency(totalExpenses, currency)}</span>
          </div>

          <button 
            onClick={() => setIsAdding(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-xl shadow-lg shadow-blue-500/10 font-bold text-xs transition-all active:scale-95 flex items-center space-x-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Rekodi Matumizi</span>
          </button>
        </div>
      </div>

      <div className="flex items-center pb-1 border-b border-gray-100">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-400 animate-fade-in">Historia ya Matumizi ({expenses.length})</h2>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pb-6">
        {expenses.length === 0 ? (
          <div className="text-center text-gray-400 py-16 bg-white rounded-2xl border border-gray-100">
            <div className="bg-gray-100 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
              <FileText className="w-6 h-6 text-gray-400" />
            </div>
            Hakuna matumizi yoyote yaliyorekodiwa kwa sasa.
          </div>
        ) : (
          grouped.map(group => {
            const isCurrent = group.isCurrentMonth;
            const isOpen = isCurrent || !!expandedMonths[group.monthKey];

            return (
              <div key={group.monthKey} className="space-y-3">
                {isCurrent ? (
                  <div className="flex justify-between items-center px-1">
                    <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest leading-none">
                      Matumizi ya Mwezi Huu ({group.monthKey})
                    </h3>
                    <span className="text-[11px] bg-orange-100 text-orange-700 font-extrabold px-3 py-1 rounded-full border border-orange-200/50">
                      Mwezi huu: {formatCurrency(group.totalAmount, currency)}
                    </span>
                  </div>
                ) : (
                  <div 
                    onClick={() => toggleMonth(group.monthKey)}
                    className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center cursor-pointer hover:border-blue-200 transition-all duration-200 select-none"
                  >
                    <div className="flex items-center">
                      <div className="bg-slate-50 border border-slate-100 text-slate-600 p-2.5 rounded-xl mr-3.5">
                        <Calendar className="w-4.5 h-4.5 text-blue-500" />
                      </div>
                      <div>
                        <h4 className="font-extrabold text-slate-800 text-sm">{group.monthKey}</h4>
                        <p className="text-xs text-slate-400 font-semibold mt-0.5">Matumizi mapya {group.expenses.length}</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="text-right">
                        <span className="text-[9px] text-slate-400 uppercase tracking-wider block font-bold">Jumla</span>
                        <span className="text-xs font-black text-orange-600">{formatCurrency(group.totalAmount, currency)}</span>
                      </div>
                      {isOpen ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      )}
                    </div>
                  </div>
                )}

                {isOpen && (
                  <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${!isCurrent ? 'pl-3 border-l-2 border-slate-200' : ''}`}>
                    {group.expenses.map(expense => (
                      <div key={expense.id} className="bg-white p-4 rounded-xl border border-gray-100 hover:border-orange-100 hover:shadow-md transition-all flex justify-between items-center">
                        <div className="flex items-center min-w-0 mr-2">
                          <div className="bg-orange-50 p-2.5 rounded-xl mr-3 shrink-0 border border-orange-100/30">
                            <Tag className="w-4.5 h-4.5 text-orange-600" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-extrabold text-gray-900 text-sm truncate">{expense.category}</h4>
                            <p className="text-[10px] font-bold text-gray-400 flex items-center mt-0.5 truncate">
                              <Calendar className="w-3 h-3 mr-1 text-gray-300" />
                              {format(new Date(expense.date), 'dd MMM yyyy')}
                            </p>
                            {expense.description && (
                              <p className="text-[11px] font-bold text-gray-400 mt-1 italic truncate">"{expense.description}"</p>
                            )}
                          </div>
                        </div>
                        <div className="text-right flex flex-col items-end shrink-0 select-none">
                          <div className="font-black text-red-600 text-xs">{formatCurrency(expense.amount, currency)}</div>
                          {(user?.role === 'admin' || user?.role === 'boss') && (
                            <button 
                              onClick={() => expense.id && handleDelete(expense.id)} 
                              className="mt-2 text-gray-300 hover:text-red-500 bg-gray-50 hover:bg-red-50 p-1 rounded-lg transition-colors cursor-pointer"
                              title="Futa matumizi haya"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
