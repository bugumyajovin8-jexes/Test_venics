import { useEffect, useRef, useState } from 'react';
import { List, RowComponentProps } from 'react-window';
import { Trash2, Info } from 'lucide-react';
import { CatalogDraft, numToInput, inputToNum } from '../../services/catalog';

interface RowProps {
  drafts: CatalogDraft[];
  update: (id: string, patch: Partial<CatalogDraft>) => void;
  remove: (id: string) => void;
  expiryEnabled: boolean;
  stockEnabled: boolean;
  gridTemplate: string;
}

const cell =
  'w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900 bg-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500';

function Row({ index, style, drafts, update, remove, expiryEnabled, stockEnabled, gridTemplate }: RowComponentProps<RowProps>) {
  const d = drafts[index];
  if (!d) return <div style={style} />;
  const badMargin = d.buy_price !== '' && d.sell_price !== '' && Number(d.sell_price) < Number(d.buy_price);
  return (
    <div style={style}>
      <div
        className="grid items-center gap-1 px-2 h-full border-b border-gray-100 hover:bg-blue-50/40"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <input value={d.name} onChange={(e) => update(d.catalogId, { name: e.target.value })} className={cell + ' font-medium'} />
        <input
          inputMode="numeric"
          value={numToInput(d.buy_price)}
          onChange={(e) => update(d.catalogId, { buy_price: inputToNum(e.target.value) })}
          className={cell + ' text-right'}
        />
        <input
          inputMode="numeric"
          value={numToInput(d.sell_price)}
          onChange={(e) => update(d.catalogId, { sell_price: inputToNum(e.target.value) })}
          className={`w-full px-2 py-1.5 border rounded text-sm bg-white outline-none text-right ${
            badMargin ? 'border-red-400 text-red-600 focus:ring-1 focus:ring-red-500' : 'border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
          }`}
        />
        {stockEnabled && (
          <input
            inputMode="numeric"
            placeholder="0"
            value={numToInput(d.stock)}
            onChange={(e) => update(d.catalogId, { stock: inputToNum(e.target.value) })}
            className={cell + ' text-right'}
          />
        )}
        {expiryEnabled && (
          <input
            type="date"
            value={d.expiry_date}
            onChange={(e) => update(d.catalogId, { expiry_date: e.target.value })}
            className={cell}
          />
        )}
        <button type="button" onClick={() => remove(d.catalogId)} className="flex justify-center text-red-400 hover:text-red-600">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function CatalogDetailsStep({
  drafts,
  update,
  remove,
  applyBulk,
  expiryEnabled,
  stockEnabled,
  listHeight,
}: {
  drafts: CatalogDraft[];
  update: (id: string, patch: Partial<CatalogDraft>) => void;
  remove: (id: string) => void;
  applyBulk: (patch: Partial<CatalogDraft>) => void;
  expiryEnabled: boolean;
  stockEnabled: boolean;
  listHeight: number;
}) {
  const [notifyDays, setNotifyDays] = useState('30');
  const onNotifyChange = (v: string) => {
    setNotifyDays(v);
    applyBulk({ notify_expiry_days: inputToNum(v) });
  };

  // Measure the actual table-body area so the virtualized list is exactly the right height.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(listHeight || 400);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = ['minmax(220px,1fr)', '130px', '130px'];
  if (stockEnabled) cols.push('120px');
  if (expiryEnabled) cols.push('170px');
  cols.push('44px');
  const gridTemplate = cols.join(' ');

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg p-2.5 mb-2">
        <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-800">
          Kwa kila bidhaa: <b>hakiki bei ya kununua na kuuza</b>
          {stockEnabled && <>, kisha <b>weka idadi ya stock</b> uliyonayo</>}
          {expiryEnabled ? ', na uchague expiry date' : ''}. Kisha bonyeza <b>Hifadhi</b>.
        </p>
      </div>

      {expiryEnabled && (
        <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2 mb-2 w-fit">
          <span className="text-sm text-gray-600">Nikumbushe kabla ya ku-expire — bidhaa zote (siku):</span>
          <input
            value={notifyDays}
            onChange={(e) => onNotifyChange(e.target.value)}
            inputMode="numeric"
            className="w-20 bg-white border border-gray-300 rounded px-2 py-1 text-sm text-gray-900 outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Table header */}
      <div
        className="grid items-center gap-1 px-2 py-2 bg-gray-100 border border-gray-200 rounded-t-lg text-[11px] font-bold text-gray-500 uppercase tracking-wide"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <span>Jina la Bidhaa</span>
        <span className="text-right">Bei kununua</span>
        <span className="text-right">Bei kuuza</span>
        {stockEnabled && <span className="text-right">Idadi (stock)</span>}
        {expiryEnabled && <span>Tarehe ya mwisho</span>}
        <span></span>
      </div>

      {/* Table body (virtualized) */}
      <div ref={wrapRef} className="flex-1 min-h-0 border border-t-0 border-gray-200 rounded-b-lg overflow-hidden bg-white">
        <List
          rowCount={drafts.length}
          rowHeight={44}
          rowComponent={Row}
          rowProps={{ drafts, update, remove, expiryEnabled, stockEnabled, gridTemplate }}
          style={{ height: h, width: '100%' }}
        />
      </div>
    </div>
  );
}
