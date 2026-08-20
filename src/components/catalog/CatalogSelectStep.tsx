import { useMemo, useState } from 'react';
import { List, RowComponentProps } from 'react-window';
import { Search, Check } from 'lucide-react';
import { CatalogItem } from '../../services/catalog';

interface RowProps {
  items: CatalogItem[];
  selected: Set<string>;
  owned: Set<string>;
  toggle: (id: string) => void;
  currency: string;
}

function Row({ index, style, items, selected, owned, toggle, currency }: RowComponentProps<RowProps>) {
  const item = items[index];
  const isSel = selected.has(item.id);
  const isOwned = owned.has(item.id);
  return (
    <div style={style} className="px-0.5 pb-1.5">
      <button
        type="button"
        onClick={() => toggle(item.id)}
        className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
          isSel ? 'bg-blue-50 border-blue-400' : isOwned ? 'bg-green-50/60 border-green-200' : 'bg-white border-gray-200'
        }`}
      >
        <span className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 border ${isSel ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300'}`}>
          {isSel && <Check className="w-4 h-4" />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-gray-900 text-sm truncate">{item.name}</span>
          <span className="block text-xs text-gray-500 truncate">
            {item.sub_category ? item.sub_category + ' · ' : ''}{currency} {(item.default_sell_price || 0).toLocaleString()}
          </span>
        </span>
        {isOwned && (
          <span className="ml-auto shrink-0 text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">✓ Unayo</span>
        )}
      </button>
    </div>
  );
}

export default function CatalogSelectStep({
  items,
  selected,
  setSelected,
  currency,
  owned,
  listHeight,
}: {
  items: CatalogItem[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  currency: string;
  owned: Set<string>;
  listHeight: number;
}) {
  const [query, setQuery] = useState('');
  const [hideOwned, setHideOwned] = useState(false);

  const searchFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.name.toLowerCase().includes(q) || (i.sub_category || '').toLowerCase().includes(q)
    );
  }, [items, query]);

  const ownedCount = useMemo(
    () => searchFiltered.reduce((n, i) => n + (owned.has(i.id) ? 1 : 0), 0),
    [searchFiltered, owned]
  );
  const newCount = searchFiltered.length - ownedCount;

  const shown = useMemo(
    () => (hideOwned ? searchFiltered.filter((i) => !owned.has(i.id)) : searchFiltered),
    [searchFiltered, hideOwned, owned]
  );

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  // "Select all" adds only the NEW (unowned) visible items, so re-opening to "import the rest"
  // never re-selects the products the shop already has.
  const selectAllNew = () => {
    const next = new Set(selected);
    shown.forEach((i) => { if (!owned.has(i.id)) next.add(i.id); });
    setSelected(next);
  };
  const clearShown = () => {
    const next = new Set(selected);
    shown.forEach((i) => next.delete(i.id));
    setSelected(next);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tafuta bidhaa..."
          className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-xl text-sm bg-white text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2 text-xs">
        <span className="text-gray-500">
          Mpya <span className="text-blue-600 font-semibold">{newCount}</span>
          {ownedCount > 0 && <> · Unazo <span className="text-green-700 font-semibold">{ownedCount}</span></>}
          {' · '}{selected.size} zimechaguliwa
        </span>
        <div className="flex items-center gap-3">
          {ownedCount > 0 && (
            <label className="flex items-center gap-1 text-gray-500 select-none">
              <input type="checkbox" checked={hideOwned} onChange={(e) => setHideOwned(e.target.checked)} className="accent-blue-600" />
              Ficha nilizonazo
            </label>
          )}
          <button type="button" onClick={selectAllNew} className="text-blue-600 font-semibold">{ownedCount > 0 ? 'Chagua mpya' : 'Chagua zote'}</button>
          <button type="button" onClick={clearShown} className="text-gray-500 font-semibold">Ondoa</button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {shown.length > 0 ? (
          <List
            rowCount={shown.length}
            rowHeight={64}
            rowComponent={Row}
            rowProps={{ items: shown, selected, owned, toggle, currency }}
            style={{ height: listHeight, width: '100%' }}
          />
        ) : (
          <p className="text-center text-gray-400 text-sm py-8">Hakuna bidhaa iliyopatikana.</p>
        )}
      </div>
    </div>
  );
}
