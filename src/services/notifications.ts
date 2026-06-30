import { db } from '../db';
import { useStore } from '../store';
import { getValidStock, getSales30DaysVelocityMap, getDynamicThreshold } from '../utils/stock';
import { subHours, startOfDay, endOfDay, isWithinInterval, format } from 'date-fns';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../supabase';

class NotificationService {
  private static instance: NotificationService;
  private checkInterval: NodeJS.Timeout | null = null;

  private constructor() {}

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  public async requestPermission(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      const localStatus = await LocalNotifications.requestPermissions();
      return localStatus.display === 'granted';
    }

    if (!('Notification' in window)) {
      console.warn('This browser does not support desktop notification');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }

    return false;
  }

  public async initPushNotifications() {
    // Push notifications are removed. Local Notifications are used instead.
  }

  public async sendNotification(title: string, body: string, id: number = Math.floor(Math.random() * 10000)) {
    try {
      if (Capacitor.isNativePlatform()) {
        await LocalNotifications.schedule({
          notifications: [
            {
              title,
              body,
              id,
              schedule: { at: new Date(Date.now() + 1000) },
              sound: 'default',
              attachments: [],
              actionTypeId: '',
              extra: null
            }
          ]
        });
      } else if (Notification.permission === 'granted') {
        new Notification(title, {
          body,
          icon: '/logo.png',
          badge: '/logo.png'
        });
      }
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  }

  public async checkAndSendPulse() {
    const user = useStore.getState().user;
    const isBoss = user?.role === 'admin' || user?.role === 'boss';
    if (!isBoss) return;

    const now = new Date();
    const currentHour = now.getHours();
    const dateKey = format(now, 'yyyy-MM-dd');
    
    // Pulse 1: 12:00 PM (Covers 6 AM - 12 PM)
    if (currentHour >= 12) {
      const lastPulse12Key = `last_pulse_12_${dateKey}`;
      if (!localStorage.getItem(lastPulse12Key)) {
        await this.executePulse(12, 6);
        localStorage.setItem(lastPulse12Key, 'true');
      }
    }

    // Pulse 2: 6:00 PM (Covers 12 PM - 6 PM)
    if (currentHour >= 18) {
      const lastPulse18Key = `last_pulse_18_${dateKey}`;
      if (!localStorage.getItem(lastPulse18Key)) {
        await this.executePulse(18, 6);
        localStorage.setItem(lastPulse18Key, 'true');
      }
    }
  }

  private async executePulse(hour: number, hoursBack: number) {
    const now = new Date();
    const startTime = subHours(now, hoursBack);
    const recentSales = await db.sales
      .where('created_at')
      .above(startTime.toISOString())
      .toArray();
    
    const activeSales = recentSales.filter(s => s.isDeleted !== 1);
    const revenue = activeSales.reduce((acc, s) => acc + s.total_amount, 0);
    const profit = activeSales.reduce((acc, s) => acc + (s.total_profit || 0), 0);

    const user = useStore.getState().user;
    const shopId = user?.shopId;
    const shop = shopId ? await db.shops.get(shopId) : null;
    const isExpiryEnabled = shop?.enable_expiry === true;
    const velocityMap = shopId ? await getSales30DaysVelocityMap(shopId) : {};

    const allProducts = shopId 
      ? await db.products.where('[shop_id+isDeleted]').equals([shopId, 0]).toArray()
      : await db.products.filter(p => p.isDeleted !== 1).toArray();

    const lowStockCount = allProducts.filter(p => {
      const validStock = getValidStock(p, isExpiryEnabled);
      const threshold = getDynamicThreshold(p.id, p.min_stock, velocityMap);
      return validStock <= threshold;
    }).length;

    this.sendNotification(
      `⚡ Venics Sales: Taarifa ya Saa ${hour === 12 ? '6' : '12'}`,
      `Habari Boss, katika saa ${hoursBack} zilizopita:\n💰 Mauzo: ${revenue.toLocaleString()} TZS\n📈 Faida: ${profit.toLocaleString()} TZS\n📦 Bidhaa ${lowStockCount} zimepungua stock.`,
      100 + hour
    );
  }

  public async checkAndSendMaster() {
    const user = useStore.getState().user;
    const isBoss = user?.role === 'admin' || user?.role === 'boss';
    if (!isBoss) return;

    const now = new Date();
    const currentHour = now.getHours();
    const dateKey = format(now, 'yyyy-MM-dd');
    
    // Master: 10:00 PM (Covers full day)
    if (currentHour >= 22) {
      const lastMasterKey = `last_master_${dateKey}`;
      if (!localStorage.getItem(lastMasterKey)) {
        const todayInterval = { start: startOfDay(now), end: endOfDay(now) };
        const todaySales = await db.sales
          .filter(s => isWithinInterval(new Date(s.created_at), todayInterval) && s.isDeleted !== 1)
          .toArray();
        
        const revenue = todaySales.reduce((acc, s) => acc + s.total_amount, 0);
        const profit = todaySales.reduce((acc, s) => acc + (s.total_profit || 0), 0);
        
        const todayExpenses = await db.expenses
          .filter(e => isWithinInterval(new Date(e.date), todayInterval) && e.isDeleted !== 1)
          .toArray();
        const totalExpenses = todayExpenses.reduce((acc, e) => acc + e.amount, 0);

        this.sendNotification(
          `🏆 RIPOTI YA LEO: Taarifa ya mwenendo wa biashara`,
          `Habari Boss, taarifa ya leo ni;\n💵 Mauzo: ${revenue.toLocaleString()} TZS\n💎 Faida: ${profit.toLocaleString()} TZS\n📉 Matumizi: ${totalExpenses.toLocaleString()} TZS\nGusa kuona mchanganuo kamili.`,
          200
        );

        localStorage.setItem(lastMasterKey, 'true');
      }
    }
  }

  public async sendAuditAlert(saleAmount: number, employeeName: string) {
    const user = useStore.getState().user;
    const isBoss = user?.role === 'admin' || user?.role === 'boss';
    if (!isBoss) return;

    this.sendNotification(
      `⚠️ ONYO: Mabadiliko ya Mauzo`,
      `Boss, mauzo ya ${saleAmount.toLocaleString()} TZS yamefutwa na ${employeeName}. Gusa hapa kuhakiki.`,
      300
    );
  }

  public startService() {
    if (this.checkInterval) return;
    
    // Check every minute
    this.checkInterval = setInterval(() => {
      this.checkAndSendPulse();
      this.checkAndSendMaster();
      this.checkAndSendLicenseExpiry();
    }, 60000);

    // Initial check
    this.checkAndSendPulse();
    this.checkAndSendMaster();
    this.checkAndSendLicenseExpiry();
  }

  public async checkAndSendLicenseExpiry() {
    const user = useStore.getState().user;
    const isBoss = user?.role === 'admin' || user?.role === 'boss';
    if (!isBoss) return;

    const now = new Date();
    const currentHour = now.getHours();
    const dateKey = format(now, 'yyyy-MM-dd');
    
    // License check: 9:00 AM or 9:00 PM
    if (currentHour >= 9) {
      const lastCheckKey = `last_license_check_${currentHour >= 21 ? '21' : '9'}_${dateKey}`;
      if (!localStorage.getItem(lastCheckKey)) {
        const license = await db.license.get(1);
        if (!license || !license.expiryDate) return;

        const daysRemaining = Math.ceil((license.expiryDate - now.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysRemaining <= 5 && daysRemaining > 0) {
          this.sendNotification(
            `⏳ ONYO: Muda wa Mfumo Unaisha Karibuni`,
            `Habari Boss, leseni yako ya Venics Sales inaisha baada ya siku ${daysRemaining}.\nTafadhali piga simu 0787979273 kupata leseni mpya.`,
            400
          );
        }
        localStorage.setItem(lastCheckKey, 'true');
      }
    }
  }

  public stopService() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

export const notifications = NotificationService.getInstance();
