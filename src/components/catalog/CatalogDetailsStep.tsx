import { useState } from 'react';
import { List, RowComponentProps } from 'react-window';
import { Trash2, Info } from 'lucide-react';
import { CatalogDraft, numToInput, inputToNum } from '../../services/catalog';
import { useTap } from '../../utils/useTap';

interface RowProps {
  drafts: CatalogDraft[];
  update: (id: string, patch: Partial<CatalogDraft>) => void;
  remove: (id: string) => void;
  expiryEnabled: boolean;
  stockEnabled: boolean;
}

function Row({ index, style, drafts, update, remove, expiryEnabled, stockEnabled }: RowComponentProps<RowProps>) {
  const tap = useTap();
  const d = drafts[index];
  if (!d) return <div style={style} />;
  const badMargin = d.buy_price !== '' && d.sell_price !== '' && Number(d.sell_price) < Number(d.buy_price);
  const inputCls =
    'w-full mt-0.5 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div style={style} className="px-0.5 pb-2">
      <div className="bg-white border border-gray-200 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-2">
          <input
            value={d.name}
            onChange={(e) => update(d.catalogId, { name: e.target.value })}
            className="flex-1 font-semibold text-sm text-gray-900 bg-transparent border-b border-transparent focus:border-blue-400 outline-none"
          />
          <button type="button" onClick={tap(() => remove(d.catalogId))} onPointerUp={tap(() => remove(d.catalogId))} className="text-red-400 p-1">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="text-[11px] text-gray-500">
            Bei ya kununua
            <input
              inputMode="numeric"
              value={numToInput(d.buy_price)}
              onChange={(e) => update(d.catalogId, { buy_price: inputToNum(e.target.value) })}
              className={inputCls}
            />
          </label>
          <label className={`text-[11px] ${badMargin ? 'text-red-500' : 'text-gray-500'}`}>
            Bei ya kuuza
            <input
              inputMode="numeric"
              value={numToInput(d.sell_price)}
              onChange={(e) => update(d.catalogId, { sell_price: inputToNum(e.target.value) })}
              className={`w-full mt-0.5 px-2 py-1.5 border rounded-lg text-sm text-gray-900 bg-white outline-none focus:ring-1 ${
                badMargin ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
              }`}
            />
          </label>
        </div>

        {stockEnabled && (
          <label className="block text-[11px] font-semibold text-blue-600">
            Idadi ya stock uliyonayo
            <input
              inputMode="numeric"
              placeholder="Weka idadi..."
              value={numToInput(d.stock)}
              onChange={(e) => update(d.catalogId, { stock: inputToNum(e.target.value) })}
              className="w-full mt-0.5 px-2 py-1.5 border border-blue-300 rounded-lg text-sm text-gray-900 bg-white outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400"
            />
          </label>
        )}

        {expiryEnabled && (
          <label className="block text-[11px] text-gray-500 mt-2">
            Tarehe ya mwisho wa matumizi (expiry date)
            <input
              type="date"
              value={d.expiry_date}
              onChange={(e) => update(d.catalogId, { expiry_date: e.target.value })}
              className={inputCls}
            />
          </label>
        )}
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
    applyBulk({ notify_expiry_days: inputToNum(v) }); // live-update every product card
  };

  return (
    <div className="flex flex-col h-full">
      {/* Plain-language instructions */}
      <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg p-2.5 mb-2">
        <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
        <p className="text-[11px] text-blue-800 leading-snug">
          Kwa kila bidhaa: <b>hakiki bei ya kununua na kuuza</b>
          {stockEnabled && <>, kisha <b>weka idadi ya stock</b> uliyonayo</>}
          {expiryEnabled ? ', na uchague expiry date' : ''}. Kisha bonyeza <b>Hifadhi</b>.
        </p>
      </div>

      {expiryEnabled && (
        <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2 mb-2">
          <span className="text-xs text-gray-600 flex-1 leading-tight">Nikumbushe kabla ya ku-expire — bidhaa zote (siku):</span>
          <input
            value={notifyDays}
            onChange={(e) => onNotifyChange(e.target.value)}
            inputMode="numeric"
            className="w-16 bg-white border border-gray-300 rounded px-2 py-1 text-sm text-gray-900 outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}

      <div className="flex-1 min-h-0">
        <List
          rowCount={drafts.length}
          rowHeight={122 + (stockEnabled ? 50 : 0) + (expiryEnabled ? 50 : 0)}
          rowComponent={Row}
          rowProps={{ drafts, update, remove, expiryEnabled, stockEnabled }}
          style={{ height: listHeight, width: '100%' }}
        />
      </div>
    </div>
  );
}
