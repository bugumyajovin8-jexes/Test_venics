/**
 * Every page, loaded when first opened (utils/lazyPage.tsx). App.tsx draws
 * them inside <Suspense> and warms the rest in the background after start-up.
 * Import pages from here, never from ./pages directly, or a page's code is
 * pulled back into the start-up file.
 */
import { lazyPage } from './utils/lazyPage';

export const Login = lazyPage(() => import('./pages/Login'));
export const Register = lazyPage(() => import('./pages/Register'));
export const ForgotPassword = lazyPage(() => import('./pages/ForgotPassword'));
export const ResetPassword = lazyPage(() => import('./pages/ResetPassword'));
export const SetupShop = lazyPage(() => import('./pages/SetupShop'));

export const Dashibodi = lazyPage(() => import('./pages/Dashibodi'));
export const Bidhaa = lazyPage(() => import('./pages/Bidhaa'));
export const Kikapu = lazyPage(() => import('./pages/Kikapu'));
export const Madeni = lazyPage(() => import('./pages/Madeni'));
export const Historia = lazyPage(() => import('./pages/Historia'));
export const HesabuYaStoo = lazyPage(() => import('./pages/HesabuYaStoo'));
export const Matumizi = lazyPage(() => import('./pages/Matumizi'));
export const Zaidi = lazyPage(() => import('./pages/Zaidi'));
export const AuditLogs = lazyPage(() => import('./pages/AuditLogs'));
export const ExecutiveDashboard = lazyPage(() => import('./pages/ExecutiveDashboard'));

/** Venics Smart's chat: the biggest piece, drawn by ExecutiveDashboard just after the page itself. */
export const MshauriChat = lazyPage(() => import('./components/MshauriChat'));

/** Dashibodi's revenue chart, drawn just after the page's figures. */
export const RevenueBars = lazyPage(() => import('./components/RevenueBars'));

/** The staff reports, opened from ExecutiveDashboard. */
export const EmployeeReports = lazyPage(() => import('./components/EmployeeReports'));

/** Warmed in this order once signed in: the pages used most first. */
export function signedInPages(isBoss: boolean) {
  return isBoss
    ? [ExecutiveDashboard, MshauriChat, EmployeeReports, Kikapu, Bidhaa, Dashibodi, RevenueBars, Madeni, Historia, Matumizi, HesabuYaStoo, Zaidi, AuditLogs, SetupShop]
    : [Dashibodi, RevenueBars, Kikapu, Bidhaa, Madeni, Matumizi, HesabuYaStoo, Zaidi, Historia, AuditLogs, ExecutiveDashboard, SetupShop];
}

export const signedOutPages = [Login, Register, ForgotPassword, ResetPassword];
