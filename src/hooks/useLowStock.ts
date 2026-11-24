import { useLiveQuery } from 'dexie-react-hooks';
import { useStore } from '../store';
import { loadLowStockContext, type LowStockContext } from '../utils/stock';

/**
 * The low-stock context for the signed-in shop, kept up to date as sales and
 * stock change (the rule itself is in utils/stock.ts). With `enabled` false
 * nothing is read. Undefined until the first read finishes.
 */
export function useLowStockContext(enabled = true): LowStockContext | undefined {
  const shopId = useStore(s => s.user?.shopId);
  // Staff have no shops row, so whether stock is tracked comes from this flag.
  const tracking = useStore(s => s.features?.['stock_tracking_enabled']);
  return useLiveQuery(
    async () => (enabled && shopId ? loadLowStockContext(shopId) : undefined),
    [shopId, enabled, tracking],
  );
}
