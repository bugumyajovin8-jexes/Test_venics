import { supabase } from '../supabase';
import { normalizeTzPhone, formatTzPhone } from '../utils/phone';
import { TelemetryService } from './telemetry';

import { t } from '../i18n';
export interface InviteOutcome {
  ok: boolean;
  message: string;
  /** `255XXXXXXXXX` when the invitation was saved. */
  phone?: string;
  /** What happened to the SMS: sent | recent | daily_cap | failed | not_configured. */
  sms?: string;
}

/**
 * Invites an employee by phone number through the `invite-staff` Edge
 * Function, which saves the invitation for the boss's own shop (taken from the
 * boss's account on the server, never sent from here) and texts the employee.
 */
export async function inviteStaffByPhone(input: string): Promise<InviteOutcome> {
  const phone = normalizeTzPhone(input);
  if (!phone) {
    return { ok: false, message: t('Namba ya simu si sahihi. Andika namba ya Tanzania, mfano 0712 345 678.') };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, message: t('Unahitaji mtandao ili kutuma mwaliko.') };
  }

  const { data, error } = await supabase.functions.invoke('invite-staff', { body: { phone } });
  if (error) {
    let message = t('Imeshindikana kutuma mwaliko. Hakikisha una mtandao kisha ujaribu tena.');
    try {
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        if (body?.error) message = body.error;
      }
    } catch {
      /* keep the generic message */
    }
    return { ok: false, message };
  }

  const shown = formatTzPhone(phone);
  const sms: string = data?.sms ?? 'failed';
  let message: string;
  switch (sms) {
    case 'sent':
      message = t('Tumemtumia {shown} SMS ya mwaliko. Akijisajili kwa namba hii, atajiunga na biashara yako moja kwa moja.', { shown });
      break;
    case 'recent':
      message = t('Mwaliko kwa {shown} upo tayari, na SMS ilitumwa muda mfupi uliopita. Mwambie ajisajili kwa namba hii.', { shown });
      break;
    case 'daily_cap':
      message = t('Mwaliko umehifadhiwa, lakini SMS za mialiko za leo zimefika kikomo. Mwambie {shown} apakue Venics Sales na ajisajili kwa namba hii.', { shown });
      break;
    default:
      message = t('Mwaliko umehifadhiwa, lakini SMS haikuweza kutumwa. Mwambie {shown} apakue Venics Sales na ajisajili kwa namba hii.', { shown });
  }

  TelemetryService.trackAddStaff('employee', sms);
  return { ok: true, phone, sms, message };
}
