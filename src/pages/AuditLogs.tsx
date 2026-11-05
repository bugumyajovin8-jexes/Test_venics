/**
 * "Shughuli za Wafanyakazi" — what staff did, as the Mobile app reports it
 * (Mobile app/src/pages/AuditLogs.tsx): one section per month, each entry one
 * calm sentence saying who did what, to which product, for how much and when
 * (utils/auditNarrative.ts).
 *
 * Months are counted first and a month's entries are read only when it is
 * opened, both from the [shop_id+isDeleted+created_at] index, so a busy shop's
 * years of history never load at once.
 */

import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import ListSkeleton from '../components/ListSkeleton';
import { format } from 'date-fns';
import {
  Trash2, Clock, User, Package, Edit, Plus, AlertCircle, RotateCcw,
  Wallet, Tag, ChevronDown, ChevronRight, Calendar
} from 'lucide-react';
import { useStore } from '../store';
import { describeAudit, ACCENT_STYLES, auditActor, isActivityNoise } from '../utils/auditNarrative';
import { SyncService } from '../services/sync';
import { TelemetryService } from '../services/telemetry';
import { nowIso } from '../services/clock';

import { t, monthNames } from '../i18n';

/** Sign-ins and app opens are attendance (Ripoti za Wafanyakazi), not activity. */
const NOT_ACTIVITY = ['login', 'logout', 'app_opened'];

function MonthSection({
  monthKey,
  count,
  isExpanded,
  onToggle,
  isCurrentMonth,
  currency,
  hidden
}: {
  monthKey: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  isCurrentMonth: boolean;
  currency: string;
  /** Entries left off the page (see isActivityNoise). */
  hidden?: Set<string>;
}) {
  const shopId = useStore(state => state.user?.shopId);
  const [yearStr, monthStr] = monthKey.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;

  const monthLogs = useLiveQuery(
    async () => {
      if (!isExpanded || !shopId) return [];
      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 1);
      const rows = await db.auditLogs
        .where('[shop_id+isDeleted+created_at]')
        .between([shopId, 0, startDate.toISOString()], [shopId, 0, endDate.toISOString()], true, false)
        .toArray();
      return rows.filter(log => !NOT_ACTIVITY.includes(log.action) && !hidden?.has(log.id)).reverse();
    },
    [isExpanded, year, month, shopId, hidden]
  ) || [];

  /**
   * Icons inherit the card's calm accent. This page is for review, not alarm —
   * the boss already knows why they opened it, so red on every entry only adds
   * pressure. (Genuinely destructive controls, like "Futa Zote", stay red.)
   */
  const getActionIcon = (action: string) => {
    if (action.startsWith('anomaly_')) return <AlertCircle className="w-4 h-4" />;
    switch (action) {
      case 'add_product': return <Plus className="w-4 h-4" />;
      case 'edit_product': return <Edit className="w-4 h-4" />;
      case 'delete_product': return <Trash2 className="w-4 h-4" />;
      case 'import_products': return <Package className="w-4 h-4" />;
      case 'refund_sale': return <RotateCcw className="w-4 h-4" />;
      case 'add_expense': return <Wallet className="w-4 h-4" />;
      case 'discounted_sale': return <Tag className="w-4 h-4" />;
      default: return <AlertCircle className="w-4 h-4" />;
    }
  };

  const monthLabel = `${monthNames()[month]} ${year}`;

  return (
    <div className="flex flex-col space-y-2">
      <button
        onClick={onToggle}
        data-testid="audit-month"
        className={`flex items-center justify-between p-4 rounded-2xl transition-all cursor-pointer ${
          isCurrentMonth
            ? 'bg-indigo-600 text-white shadow-md hover:bg-indigo-700'
            : 'bg-white text-gray-700 shadow-sm border border-gray-100 hover:border-indigo-200'
        }`}
      >
        <div className="flex items-center space-x-3">
          <Calendar className={`w-5 h-5 ${isCurrentMonth ? 'text-indigo-200' : 'text-indigo-500'}`} />
          <div className="text-left">
            <h3 className="font-bold text-sm sm:text-base uppercase tracking-wide">
              {monthLabel}
            </h3>
            <p className={`text-[10px] sm:text-xs font-medium ${isCurrentMonth ? 'text-indigo-100' : 'text-gray-400'}`}>
              {t('Shughuli {count} zilizorekodiwa', { count })}
            </p>
          </div>
        </div>
        {isExpanded ? <ChevronDown className="w-5 h-5 opacity-70" /> : <ChevronRight className="w-5 h-5 opacity-70" />}
      </button>

      {isExpanded && (
        <div className="space-y-3 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
          {/* `count` comes from the month index, which is already on screen, so a
              month that reports entries but has none loaded yet is still reading.
              Skeleton rows show the shape of what is coming instead of a spinner. */}
          {monthLogs.length === 0 && count > 0 && (
            <div className="py-1">
              <ListSkeleton rows={Math.min(count, 4)} />
            </div>
          )}
          {monthLogs.map((log) => {
            const narrative = describeAudit(log, currency);
            return (
              <div key={log.id} data-testid="audit-entry" className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex">
                {/* Calm accent stripe instead of an alarming card */}
                <div className={`w-1.5 shrink-0 ${ACCENT_STYLES[narrative.accent].bar}`} />

                <div className="flex-1 p-4 min-w-0">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-xl shrink-0 ${ACCENT_STYLES[narrative.accent].chip}`}>
                      {getActionIcon(log.action)}
                    </div>

                    <div className="min-w-0 flex-1">
                      {/* Everything in one sentence: who, what, how much, which item, when */}
                      <p className="text-[13.5px] leading-relaxed text-gray-800 font-medium">
                        {narrative.sentence}
                      </p>

                      {narrative.note && (
                        <p className="text-[11.5px] leading-relaxed text-gray-500 mt-1.5">
                          {narrative.note}
                        </p>
                      )}

                      <div className="flex items-center gap-3 mt-2.5 text-[10.5px] text-gray-400 font-semibold">
                        <span className="flex items-center">
                          <User className="w-3 h-3 mr-1" />
                          {auditActor(log)}
                        </span>
                        <span className="flex items-center">
                          <Clock className="w-3 h-3 mr-1" />
                          {format(new Date(log.created_at), 'HH:mm')}, {format(new Date(log.created_at), 'dd')} {monthNames()[new Date(log.created_at).getMonth()].slice(0, 3)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AuditLogs() {
  const { isBoss, showAlert, showConfirm, user } = useStore();
  const shopId = user?.shopId || user?.shop_id;
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';

  useEffect(() => {
    TelemetryService.trackMabadilikoYaBidhaaView();
  }, []);

  // The current month opens by itself; older ones on a click.
  const currentMonthKey = format(new Date(), 'yyyy-MM');
  const [expandedMonths, setExpandedMonths] = useState<string[]>([currentMonthKey]);

  // How many entries each month has. Read in the index's own date order, so no
  // sort; scoped to the active shop (the local cache keeps every shop this
  // computer has signed in to).
  // Also which entries are left off the page (isActivityNoise): oversell
  // notices for deleted products and their repeats, and the boss's own.
  const availableMonthsRaw = useLiveQuery(
    async () => {
      if (!shopId) return { groups: {} as Record<string, number>, hidden: new Set<string>() };
      const liveProductIds = new Set((await db.products.where('[shop_id+isDeleted]').equals([shopId, 0]).primaryKeys()) as string[]);
      const bossIds = new Set((await db.users.where('shop_id').equals(shopId).toArray())
        .filter(u => u.role === 'boss' || u.role === 'admin' || u.role === 'superadmin').map(u => u.id));
      const groups: Record<string, number> = {};
      const hidden = new Set<string>();
      const seen = new Set<string>();
      // Oldest first, so of repeated notices the first one is the one kept.
      await db.auditLogs
        .where('[shop_id+isDeleted+created_at]')
        .between([shopId, 0, ''], [shopId, 0, '￿'])
        .each(log => {
          if (NOT_ACTIVITY.includes(log.action)) return;
          if (isActivityNoise(log, liveProductIds, bossIds, seen)) { hidden.add(log.id); return; }
          const mKey = format(new Date(log.created_at), 'yyyy-MM');
          groups[mKey] = (groups[mKey] || 0) + 1;
        });
      return { groups, hidden };
    },
    [shopId]
  );
  // Not flattened with `|| {}`: until the months are counted, "Hakuna shughuli
  // iliyorekodiwa bado" would tell the boss their staff history was gone.
  const monthsLoading = availableMonthsRaw === undefined;
  const availableMonths = availableMonthsRaw?.groups || {};
  const hiddenIds = availableMonthsRaw?.hidden;

  const sortedMonthKeys = useMemo(() => {
    return Object.keys(availableMonths).sort((a, b) => b.localeCompare(a));
  }, [availableMonths]);

  const toggleMonth = (month: string) => {
    setExpandedMonths(prev =>
      prev.includes(month)
        ? prev.filter(m => m !== month)
        : [...prev, month]
    );
  };

  const handleDeleteAll = () => {
    showConfirm(
      t('Futa Kumbukumbu Zote'),
      t('Je, una uhakika unataka kufuta kumbukumbu zote za mabadiliko? Kitendo hiki hakiwezi kutenguliwa.'),
      async () => {
        if (!shopId) return;
        // This shop's activity only, sign-ins left for the attendance report
        // (as before), and marked deleted for the sync to carry, not erased.
        await db.auditLogs.where('[shop_id+isDeleted]').equals([shopId, 0])
          .filter(log => !NOT_ACTIVITY.includes(log.action))
          .modify({ isDeleted: 1, synced: 0, updated_at: nowIso() });
        SyncService.sync();
        showAlert(t('Mafanikio'), t('Kumbukumbu zote zimefutwa.'));
      }
    );
  };

  if (!isBoss()) {
    return (
      <div className="p-10 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-800">{t('Huna Ruhusa')}</h2>
        <p className="text-gray-500 mt-2">{t('Ukurasa huu ni kwa ajili ya mmiliki wa duka pekee.')}</p>
      </div>
    );
  }

  return (
    // The page itself scrolls (as Historia's reports do), not a box inside it.
    <div className="p-4 md:p-5 bg-gray-50">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{t('Shughuli za Wafanyakazi')}</h1>
          {sortedMonthKeys.length > 0 && (
            <button
              onClick={handleDeleteAll}
              className="flex items-center space-x-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors border border-red-100 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span className="text-sm font-bold">{t('Futa Zote')}</span>
            </button>
          )}
        </div>

        <div className="space-y-4 pb-10">
          {monthsLoading ? (
            <ListSkeleton rows={4} />
          ) : sortedMonthKeys.length > 0 ? (
            sortedMonthKeys.map((monthKey) => (
              <MonthSection
                key={monthKey}
                monthKey={monthKey}
                count={availableMonths[monthKey]}
                isExpanded={expandedMonths.includes(monthKey)}
                onToggle={() => toggleMonth(monthKey)}
                isCurrentMonth={monthKey === currentMonthKey}
                currency={currency}
                hidden={hiddenIds}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Clock className="w-12 h-12 mb-4 opacity-20" />
              <p className="font-medium">{t('Hakuna shughuli iliyorekodiwa bado.')}</p>
              <p className="text-xs mt-1">{t('Shughuli za wafanyakazi zitaonekana hapa.')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
