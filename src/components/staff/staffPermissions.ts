/**
 * What staff may do: the five switches, in one list, used by the Wafanyakazi
 * section of Zaidi and by the gear on Ripoti za Wafanyakazi. The same list and
 * words as the Mobile app (2026-11-24).
 *
 * Every switch reads "Ruhusu…" and ON means staff are allowed. Two are STORED
 * as restrictions (hide_stock_from_staff, block_historia_for_staff) — the
 * pages, phones and chat enforce those flags — so only the switch is turned
 * round: allowed = !flag, and allowing writes flag = false.
 *
 * Desktop only: before those two became shop-wide they were saved on one
 * computer (settings.hideStockFromStaff / blockHistoriaForStaff). Until the
 * shop has a row (services/legacyRestrictions.ts promotes a `true`), that old
 * value is still what this computer enforces (hooks/useStaffRestrictions.ts),
 * so the switch shows it too.
 */
import { Boxes, History, Package, TrendingUp, Wallet } from 'lucide-react';
import { SyncService } from '../../services/sync';
import { TelemetryService } from '../../services/telemetry';
import { HIDE_STOCK_KEY, BLOCK_HISTORIA_KEY } from '../../hooks/useStaffRestrictions';
import { t } from '../../i18n';

export type PermissionTone = 'blue' | 'orange' | 'purple' | 'teal' | 'rose';

/** Box, title, description, switch-on colour for each tone. */
export const TONE: Record<PermissionTone, [string, string, string, string]> = {
  blue: ['bg-blue-50 border-blue-100', 'text-blue-900', 'text-blue-700', 'bg-blue-600'],
  orange: ['bg-orange-50 border-orange-100', 'text-orange-900', 'text-orange-700', 'bg-orange-600'],
  purple: ['bg-purple-50 border-purple-100', 'text-purple-900', 'text-purple-700', 'bg-purple-600'],
  teal: ['bg-teal-50 border-teal-100', 'text-teal-900', 'text-teal-700', 'bg-teal-600'],
  rose: ['bg-rose-50 border-rose-100', 'text-rose-900', 'text-rose-700', 'bg-rose-600'],
};

export type StaffPermission = {
  key: string;
  title: string;
  detail: string;
  icon: typeof Package;
  tone: PermissionTone;
  /** The stored flag stops staff; the switch shows the opposite. */
  storedAsRestriction?: boolean;
};

/** Built at render time so the words follow the chosen language. */
export function staffPermissions(): StaffPermission[] {
  return [
    { key: 'staff_product_management', title: t('Ruhusu Wafanyakazi Kuongeza Bidhaa'), detail: t('Wafanyakazi wataweza kuongeza, kuhariri na kuingiza bidhaa kwa Excel.'), icon: Package, tone: 'blue' },
    { key: 'staff_expense_management', title: t('Ruhusu Wafanyakazi Kuona/Kuongeza Matumizi'), detail: t('Wafanyakazi wataweza kuona na kuongeza matumizi ya duka.'), icon: Wallet, tone: 'orange' },
    { key: 'show_mapato_to_staff', title: t('Ruhusu Wafanyakazi Kuona Mapato'), detail: t('Wafanyakazi wataweza kuona mapato na mauzo yote kwenye Dashibodi na Historia.'), icon: TrendingUp, tone: 'purple' },
    { key: HIDE_STOCK_KEY, title: t('Ruhusu Wafanyakazi Kuona Idadi ya Bidhaa'), detail: t('Wafanyakazi wataona idadi iliyobaki stoo kwenye Bidhaa, Kikapu, Dashibodi na Historia. Ukizima, hawataiona popote.'), icon: Boxes, tone: 'teal', storedAsRestriction: true },
    { key: BLOCK_HISTORIA_KEY, title: t('Ruhusu Wafanyakazi Kuona Historia'), detail: t('Wafanyakazi wataweza kufungua ukurasa wa Historia. Ukizima, hautaonekana kwao kabisa.'), icon: History, tone: 'rose', storedAsRestriction: true },
  ];
}

/** The saved flag: the shop's row if it has one, else this computer's old setting. */
export function storedFlag(p: StaffPermission, features: Record<string, boolean>, settings?: any): boolean {
  if (typeof features[p.key] === 'boolean') return features[p.key];
  if (p.key === HIDE_STOCK_KEY) return settings?.hideStockFromStaff === true;
  if (p.key === BLOCK_HISTORIA_KEY) return settings?.blockHistoriaForStaff === true;
  return false;
}

/** Is the switch on (staff allowed), given the stored flag? */
export const isAllowed = (p: StaffPermission, flag: boolean) => (p.storedAsRestriction ? !flag : flag);

/** Turn the permission on or off; writes the stored flag the right way round. */
export async function setAllowed(p: StaffPermission, allow: boolean) {
  const flag = p.storedAsRestriction ? !allow : allow;
  await SyncService.toggleFeature(p.key, flag);
  TelemetryService.trackFeatureFlagToggle(p.key, flag);
}
