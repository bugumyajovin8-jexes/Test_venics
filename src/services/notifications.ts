import { db } from '../db';
import { useStore } from '../store';
import { getValidStock, getSales30DaysVelocityMap, getDynamicThreshold, isBatchExpiringSoon } from '../utils/stock';
import { addDays, isAfter, isBefore } from 'date-fns';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

// Fixed ids so re-scheduling replaces (rather than duplicates) each notification.
const IDS = {
  morning: 1001,
  midday: 1002,
  evening: 1003,
  night: 1004,
  weekly: 1005,
  lowStock: 2001,
  expiry: 2002,
  debtDue: 2003,
  inactivity: 3001,
  license: 4001,
  audit: 300,
};
const ALL_IDS = Object.values(IDS);

const SMALL_ICON = 'ic_stat_venics'; // add a white-silhouette drawable in android/.../res
const ICON_COLOR = '#2563EB';

class NotificationService {
  private static instance: NotificationService;
  private constructor() {}

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  public async requestPermission(): Promise<boolean> {
    try {
      if (Capacitor.isNativePlatform()) {
        const status = await LocalNotifications.requestPermissions();
        return status.display === 'granted';
      }
      if (!('Notification' in window)) return false;
      if (Notification.permission === 'granted') return true;
      if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        return permission === 'granted';
      }
      return false;
    } catch (e) {
      console.error('requestPermission failed', e);
      return false;
    }
  }

  // Kept for API compatibility — local notifications are used instead of push.
  public async initPushNotifications() {}

  // Low-level scheduler. Omit `schedule` for an immediate notification.
  private async fire(n: {
    id: number;
    title: string;
    body: string;
    largeBody?: string;
    summaryText?: string;
    schedule?: any;
  }) {
    try {
      if (Capacitor.isNativePlatform()) {
        await LocalNotifications.schedule({
          notifications: [
            {
              id: n.id,
              title: n.title,
              body: n.body,
              // largeBody + summaryText give Android's expandable BigText style so
              // the full multi-line message shows when the notification is expanded.
              largeBody: n.largeBody ?? n.body,
              summaryText: n.summaryText ?? 'Venics Sales',
              schedule: n.schedule
                ? { allowWhileIdle: true, ...n.schedule }
                : { at: new Date(Date.now() + 1500), allowWhileIdle: true },
              // NO custom smallIcon on purpose: a smallIcon pointing to a drawable
              // that doesn't exist makes Android drop the notification silently, so
              // Android uses the app's default icon instead. Re-add
              //   smallIcon: SMALL_ICON, iconColor: ICON_COLOR,
              // here ONLY after ic_stat_venics.png exists in res/drawable-*/.
              sound: 'default',
            },
          ],
        });
      } else if ('Notification' in window && Notification.permission === 'granted') {
        // Web fallback (foreground only).
        new Notification(n.title, { body: n.largeBody ?? n.body, icon: '/logo.png', badge: '/logo.png' });
      }
    } catch (e) {
      console.error('Failed to fire notification:', e);
    }
  }

  // Public: immediate one-off (used by the Settings "test notification" button).
  public async sendNotification(title: string, body: string, id: number = Math.floor(Math.random() * 100000)) {
    await this.fire({ id, title, body });
  }

  // Main entry. Schedules every OS-delivered reminder and refreshes the snapshot
  // alerts. Idempotent — safe to call on app start and on every foreground.
  public async startService() {
    const user = useStore.getState().user;
    if (user?.role !== 'boss') return;
    // Background delivery only exists on native; web notifications need the tab open.
    if (!Capacitor.isNativePlatform()) return;

    try {
      await this.scheduleDailyReminders();
      await this.armInactivity();
      await this.refreshSnapshotAlerts();
      await this.scheduleLicenseAlert();
    } catch (e) {
      console.error('startService (notifications) failed', e);
    }
  }

  // --- Recurring, purely time-based reminders (delivered even when app is closed) ---
  private async scheduleDailyReminders() {
    await this.fire({
      id: IDS.morning,
      title: '☀️ Habari Boss!',
      body: 'Fungua duka na uanze kurekodi mauzo ya leo.',
      schedule: { on: { hour: 8, minute: 0 }, repeats: true },
    });
    await this.fire({
      id: IDS.midday,
      title: '📊 Ripoti ya Asubuhi',
      body: 'Gusa kuona mauzo, faida na bidhaa zinazopungua leo.',
      schedule: { on: { hour: 12, minute: 0 }, repeats: true },
    });
    await this.fire({
      id: IDS.evening,
      title: '📈 Ripoti ya Mchana',
      body: 'Gusa kuona mwenendo wa mauzo ya leo hadi sasa.',
      schedule: { on: { hour: 18, minute: 0 }, repeats: true },
    });
    await this.fire({
      id: IDS.night,
      title: '🏆 Ripoti Kamili ya Leo',
      body: 'Funga siku — gusa kuona mchanganuo kamili wa mauzo, faida na matumizi ya leo.',
      schedule: { on: { hour: 22, minute: 0 }, repeats: true },
    });
    // Weekday: 1=Sunday ... 2=Monday
    await this.fire({
      id: IDS.weekly,
      title: '🗓️ Ripoti ya Wiki',
      body: 'Wiki mpya imeanza! Gusa kuona ripoti ya wiki iliyopita ya duka lako.',
      schedule: { on: { weekday: 2, hour: 9, minute: 0 }, repeats: true },
    });
  }

  // "We miss you" — scheduled 3 days out and pushed forward on every app open, so it
  // only ever fires if the boss stops opening the app (inactivity win-back).
  private async armInactivity() {
    const at = addDays(new Date(), 3);
    at.setHours(18, 0, 0, 0);
    await this.fire({
      id: IDS.inactivity,
      title: '👋 Tunakukumbuka, Boss',
      body: 'Duka lako linakusubiri. Fungua kuendelea kurekodi mauzo na kufuatilia faida.',
      schedule: { at },
    });
  }

  // Data-driven alerts. Recomputed on each foreground (numbers refresh) and scheduled
  // for the next report slot so they still arrive if the app is closed afterwards.
  private async refreshSnapshotAlerts() {
    const user = useStore.getState().user;
    const shopId = user?.shopId;
    if (!shopId) return;

    const slot = this.nextReportSlot();
    const now = new Date();

    const shop = await db.shops.get(shopId);
    const isExpiryEnabled = shop?.enable_expiry === true;
    const velocity = await getSales30DaysVelocityMap(shopId);
    const products = await db.products.where('[shop_id+isDeleted]').equals([shopId, 0]).toArray();

    // Low stock
    const lowStock = products.filter(
      (p) => getValidStock(p, isExpiryEnabled) <= getDynamicThreshold(p.id, p.min_stock, velocity)
    );
    if (lowStock.length > 0) {
      const names = lowStock.slice(0, 6).map((p) => p.name).join(', ');
      await this.fire({
        id: IDS.lowStock,
        title: '📦 Bidhaa Zinapungua Stock',
        body: `Bidhaa ${lowStock.length} zimefika kiwango cha chini. Gusa kuagiza upya.`,
        largeBody: `Bidhaa ${lowStock.length} zimefika kiwango cha chini cha stock: ${names}${lowStock.length > 6 ? ` na nyingine ${lowStock.length - 6}` : ''}. Gusa kuona orodha kamili na kuagiza upya.`,
        schedule: { at: slot },
      });
    } else {
      await this.cancel(IDS.lowStock);
    }

    // Expiry (only when the shop tracks expiry)
    if (isExpiryEnabled) {
      const notifyDays = shop?.notify_expiry_days ?? 30;
      let expiring = 0;
      for (const p of products) {
        for (const b of p.batches || []) {
          if (Number(b.stock) > 0 && isBatchExpiringSoon(b.expiry_date, notifyDays)) expiring++;
        }
      }
      if (expiring > 0) {
        await this.fire({
          id: IDS.expiry,
          title: '⏰ Bidhaa Zinakaribia Kuisha Muda',
          body: `Bidhaa ${expiring} zinaisha muda ndani ya siku ${notifyDays}. Gusa kuona na kuchukua hatua.`,
          schedule: { at: slot },
        });
      } else {
        await this.cancel(IDS.expiry);
      }
    }

    // Debt due soon (credit sales with a due date within ~3 days)
    const creditSales = await db.sales
      .where('[shop_id+isDeleted]')
      .equals([shopId, 0])
      .filter((s) => s.payment_method === 'credit' && s.status !== 'completed')
      .toArray();
    const dueSoon = creditSales.filter((s) => {
      if (!s.due_date) return false;
      const d = new Date(s.due_date);
      return isAfter(d, addDays(now, -1)) && isBefore(d, addDays(now, 3));
    });
    if (dueSoon.length > 0) {
      await this.fire({
        id: IDS.debtDue,
        title: '💳 Madeni Yanayofika Muda',
        body: `Wateja ${dueSoon.length} wana madeni yanayofika muda karibuni. Gusa kuwakumbusha.`,
        schedule: { at: slot },
      });
    } else {
      await this.cancel(IDS.debtDue);
    }
  }

  // License expiry — scheduled precisely for 3 days before expiry at 9 AM.
  private async scheduleLicenseAlert() {
    const license = await db.license.get(1);
    if (!license?.expiryDate) {
      await this.cancel(IDS.license);
      return;
    }
    const at = new Date(license.expiryDate - 3 * 24 * 60 * 60 * 1000);
    at.setHours(9, 0, 0, 0);
    if (at.getTime() > Date.now()) {
      await this.fire({
        id: IDS.license,
        title: '⏳ Leseni Inaisha Karibuni',
        body: 'Leseni yako ya Venics Sales inakaribia kuisha. Piga simu 0787979273 kuiongeza kabla haijaisha.',
        schedule: { at },
      });
    } else {
      await this.cancel(IDS.license);
    }
  }

  // Immediate alert when a cashier voids/refunds a sale (delivers when boss app is open).
  public async sendAuditAlert(saleAmount: number, employeeName: string) {
    const user = useStore.getState().user;
    if (user?.role !== 'boss') return;
    await this.fire({
      id: IDS.audit,
      title: '⚠️ Onyo: Mabadiliko ya Mauzo',
      body: `Mauzo ya ${saleAmount.toLocaleString()} TZS yamefutwa na ${employeeName}. Gusa kuhakiki.`,
    });
  }

  private nextReportSlot(): Date {
    const now = new Date();
    for (const h of [12, 18, 22]) {
      const d = new Date(now);
      d.setHours(h, 0, 0, 0);
      if (d.getTime() > now.getTime() + 60_000) return d;
    }
    const tomorrow = addDays(now, 1);
    tomorrow.setHours(8, 0, 0, 0);
    return tomorrow;
  }

  private async cancel(id: number) {
    try {
      if (Capacitor.isNativePlatform()) {
        await LocalNotifications.cancel({ notifications: [{ id }] });
      }
    } catch {
      /* ignore */
    }
  }

  // On logout / non-boss: clear every app-scheduled notification.
  public async stopService() {
    try {
      if (Capacitor.isNativePlatform()) {
        await LocalNotifications.cancel({ notifications: ALL_IDS.map((id) => ({ id })) });
      }
    } catch (e) {
      console.error('stopService (notifications) failed', e);
    }
  }
}

export const notifications = NotificationService.getInstance();
