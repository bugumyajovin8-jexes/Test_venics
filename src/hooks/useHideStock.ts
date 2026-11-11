/**
 * Moved. The restriction is now a shop-wide synced feature, not a device
 * setting — see `useStaffRestrictions.ts` for why and for the legacy fallback.
 *
 * Re-exported from here so the four pages that already import it keep working
 * unchanged.
 */
export { useHideStock } from './useStaffRestrictions';
