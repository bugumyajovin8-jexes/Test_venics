import { useState } from 'react';
import { useTap } from '../utils/useTap';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Expense } from '../db';
import { useStore } from '../store';
import { formatCurrency, formatInputNumber, parseInputNumber } from '../utils/format';
import { Plus, Trash2, Calendar, Tag, FileText, Wallet, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { SyncService } from '../services/sync';
import { TelemetryService } from '../services/telemetry';
import { format, startOfMonth } from 'date-fns';
import { useNavigate } from 'react-router-dom';

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
  const tap = useTap();
  const { user, showConfirm, showAlert, isBoss, isFeatureEnabled } = useStore();
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';
  const navigate = useNavigate();
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
        date: formData.get('date') as string || new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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
        // If it's already flagged as vague, we skip to avoid duplicate noisy alerts, but actually let's just log it anyway or independently.
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
          warning: `Ongezeko kubwa na la ghafla la matumizi ya leo (${formatCurrency(todayTotal, currency)}) ukilinganisha na wastani wetu wa kawaida wa siku 30 zilizopita.`
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
        updated_at: new Date().toISOString(),
        synced: 0
      });
      SyncService.sync();
    });
  };

  const currentMonthStart = startOfMonth(new Date()).getTime();
  const currentMonthExpenses = expenses
    .filter(e => new Date(e.date).getTime() >= currentMonthStart)
    .reduce((sum, e) => sum + e.amount, 0);
  const currentMonthLabel = formatSwahiliMonthYear(new Date().toISOString());

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

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
      <div className="p-4 pt-safe pt-safe-standalone h-full overflow-y-auto">
        <div className="flex items-center mb-6">
          <button
            onClick={tap(() => setIsAdding(false))}
            onPointerUp={tap(() => setIsAdding(false))}
            className="text-blue-600 font-medium mr-4"
          >
            Nyuma
          </button>
          <h1 className="text-xl font-bold text-gray-800">Ongeza Matumizi</h1>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Kiasi (Amount)</label>
            <input 
              required 
              type="text" 
              inputMode="numeric" 
              value={formAmount}
              onChange={e => setFormAmount(formatInputNumber(e.target.value))}
              className="w-full p-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-lg font-bold" 
              placeholder="0"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Kundi (Category)</label>
            <select 
              required 
              name="category" 
              className="w-full p-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            >
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Maelezo (Description)</label>
            <textarea 
              name="description" 
              rows={3}
              className="w-full p-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Elezea matumizi haya..."
            ></textarea>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tarehe</label>
            <input 
              type="date" 
              name="date" 
              defaultValue={new Date().toISOString().split('T')[0]}
              className="w-full p-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none" 
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl">
              {error}
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl mt-6 shadow-lg shadow-blue-100 cursor-pointer touch-manipulation select-none transition-all"
            style={{ 
              WebkitTapHighlightColor: 'transparent',
              WebkitTouchCallout: 'none',
              touchAction: 'manipulation'
            }}>
            {loading ? 'Inahifadhi...' : 'Hifadhi Matumizi'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col h-full pt-safe pt-safe-standalone">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center">
          <button
            onClick={tap(() => navigate(-1))}
            onPointerUp={tap(() => navigate(-1))}
            className="mr-3 p-2 bg-white rounded-full shadow-sm cursor-pointer touch-manipulation select-none transition-all"
            style={{
              WebkitTapHighlightColor: 'transparent',
              WebkitTouchCallout: 'none',
              touchAction: 'manipulation'
            }}
          >
             <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-gray-800">Matumizi</h1>
        </div>
        <button
          onClick={tap(() => setIsAdding(true))}
          onPointerUp={tap(() => setIsAdding(true))}
          className="bg-blue-600 text-white p-3 rounded-2xl shadow-lg shadow-blue-100 cursor-pointer touch-manipulation select-none transition-all"
          style={{
            WebkitTapHighlightColor: 'transparent',
            WebkitTouchCallout: 'none',
            touchAction: 'manipulation'
          }}
        >
          <Plus className="w-6 h-6" />
        </button>
      </div>

      <div className="bg-orange-500 text-white p-6 rounded-3xl shadow-lg mb-8 relative overflow-hidden">
        <div className="relative z-10 flex justify-between items-start">
          <div>
            <p className="text-orange-100 text-sm font-medium mb-1">Matumizi ya Mwezi Huu ({currentMonthLabel})</p>
            <p className="text-3xl font-bold">{formatCurrency(currentMonthExpenses, currency)}</p>
            <p className="text-xs text-orange-200 mt-2 font-medium">Jumla ya muda wote: {formatCurrency(totalExpenses, currency)}</p>
          </div>
          <div className="bg-orange-600/50 text-orange-100 text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-full border border-orange-400/20">
            Mwezi Huu
          </div>
        </div>
        <Wallet className="absolute -right-4 -bottom-4 w-32 h-32 text-white opacity-10 rotate-12" />
      </div>

      <div className="flex-1 overflow-y-auto space-y-6 pb-4">
        {expenses.length === 0 ? (
          <div className="text-center text-gray-500 py-10">
            <div className="bg-gray-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-gray-400" />
            </div>
            Hakuna matumizi yaliyorekodiwa bado.
          </div>
        ) : (
          grouped.map(group => {
            const isCurrent = group.isCurrentMonth;
            const isOpen = isCurrent || !!expandedMonths[group.monthKey];

            return (
              <div key={group.monthKey} className="space-y-3">
                {isCurrent ? (
                  <div className="flex justify-between items-center px-1">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                      Matumizi ya Mwezi Huu ({group.monthKey})
                    </h2>
                    <span className="text-xs bg-orange-100 text-orange-700 font-bold px-2.5 py-1 rounded-full">
                      Kiasi: {formatCurrency(group.totalAmount, currency)}
                    </span>
                  </div>
                ) : (
                  <div
                    role="button"
                    onClick={tap(() => toggleMonth(group.monthKey))}
                    onPointerUp={tap(() => toggleMonth(group.monthKey))}
                    className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center cursor-pointer transition-all duration-200"
                    style={{ touchAction: 'manipulation' }}
                  >
                    <div className="flex items-center">
                      <div className="bg-blue-50 p-3 rounded-xl mr-4">
                        <Calendar className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-800">{group.monthKey}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">Matumizi {group.expenses.length}</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="text-right">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-semibold">Jumla</span>
                        <span className="text-sm font-bold text-red-600">{formatCurrency(group.totalAmount, currency)}</span>
                      </div>
                      {isOpen ? (
                        <ChevronUp className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </div>
                )}

                {isOpen && (
                  <div className={`space-y-3 ${!isCurrent ? 'pl-3 border-l-2 border-blue-100' : ''}`}>
                    {group.expenses.map(expense => (
                      <div key={expense.id} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center">
                        <div className="flex items-center">
                          <div className="bg-orange-100 p-3 rounded-xl mr-4">
                            <Tag className="w-5 h-5 text-orange-600" />
                          </div>
                          <div>
                            <h3 className="font-bold text-gray-800">{expense.category}</h3>
                            <p className="text-xs text-gray-500 flex items-center mt-1">
                              <Calendar className="w-3 h-3 mr-1" />
                              {format(new Date(expense.date), 'dd MMM yyyy')}
                            </p>
                            {expense.description && (
                              <p className="text-xs text-gray-400 mt-1 italic">"{expense.description}"</p>
                            )}
                          </div>
                        </div>
                        <div className="text-right flex flex-col items-end">
                          <div className="font-bold text-red-600">{formatCurrency(expense.amount, currency)}</div>
                          {(user?.role === 'admin' || user?.role === 'boss') && (
                            <button
                              onClick={tap(() => expense.id && handleDelete(expense.id))}
                              onPointerUp={tap(() => expense.id && handleDelete(expense.id))}
                              className="mt-2 text-gray-300 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
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
