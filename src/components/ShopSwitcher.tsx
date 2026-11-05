/**
 * "Usimamizi wa Maduka": the owner's shops, "Hamia Hapa" to move to one, and
 * "Ongeza Duka" to open another — as the Mobile app's Zaidi has it.
 *
 * Shown in Zaidi, and on the licence screen (LicenseGuard) without "Ongeza
 * Duka": an owner whose shop has lapsed can always leave it for another of
 * their shops, but opening a new one there would be the way around renewing.
 */

import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Store, X } from 'lucide-react';
import { useStore } from '../store';
import { createShop, fetchOwnShops, switchToShop, SWITCH_NEEDS_INTERNET, type OwnShop } from '../services/shopSwitch';
import { t } from '../i18n';

export default function ShopSwitcher({ allowCreate, onSwitched, variant = 'section' }: {
  allowCreate: boolean;
  /** After a move: where the page goes next (Zaidi opens the new shop's dashboard). */
  onSwitched?: () => void;
  /** 'lapsed': the short list on the licence screen, shown only if there is somewhere to go. */
  variant?: 'section' | 'lapsed';
}) {
  const { user, showAlert, showConfirm } = useStore();
  const [shops, setShops] = useState<OwnShop[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const load = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      setShops(await fetchOwnShops(user.id));
    } catch (err) {
      // Offline, or a wifi with no internet behind it: there is nothing to
      // switch to without the server anyway.
      console.warn('[ShopSwitcher] could not read the shops:', err);
      setShops(prev => prev ?? []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [user?.id]);

  const handleSwitch = (shop: OwnShop) => {
    if (!user) return;
    if (user.shopId === shop.id) {
      showAlert(t('Taarifa'), t('Tayari upo kwenye duka hili.'));
      return;
    }
    // Said before the question, not after it: the move happens on the server.
    if (!navigator.onLine) {
      showAlert(t('Hakuna Intaneti'), SWITCH_NEEDS_INTERNET);
      return;
    }
    showConfirm(
      t('Badilisha Duka'),
      t('Je, una uhakika unataka kuhamia kwenye duka la "{targetShopName}"? Kikapu cha sasa kitafutwa. Kompyuta hii itapakua data za duka hilo; za duka hili zimehifadhiwa mtandaoni na zitarudi ukihamia tena.', { targetShopName: shop.name }),
      async () => {
        setSwitchingId(shop.id);
        try {
          await switchToShop(shop.id);
          showAlert(t('Imefanikiwa'), t('Umehamia kwenye duka la "{targetShopName}" kwa mafanikio! Mfumo unaanza kusawazisha bidhaa na rekodi.', { targetShopName: shop.name }));
          onSwitched?.();
        } catch (err: any) {
          console.error('Error switching shop:', err);
          showAlert(t('Kosa'), err?.message || t('Imeshindwa kuhamia kwenye duka jingine.'));
        } finally {
          setSwitchingId(null);
        }
      },
    );
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      await createShop(name);
      setShowAdd(false);
      setNewName('');
      showAlert(t('Imefanikiwa'), t('Duka jipya "{newShopName}" limeundwa kikamilifu. Bonyeza "Hamia Hapa" kuanza kulitumia: kama ni duka lako la kwanza kupata trial, siku 14 zitaanza; vinginevyo utahitaji kifurushi.', { newShopName: name }));
      void load();
    } catch (err: any) {
      console.error('Error adding shop:', err);
      showAlert(t('Kosa'), err?.message || t('Imeshindwa kuongeza duka.'));
    } finally {
      setAdding(false);
    }
  };

  const others = (shops ?? []).filter(s => s.id !== user?.shopId);

  const row = (s: OwnShop) => {
    const isActive = s.id === user?.shopId;
    const isSwitching = switchingId === s.id;
    return (
      <div key={s.id} data-testid="shop-row"
        className={`flex items-center justify-between p-3 rounded-xl border ${isActive ? 'bg-blue-50/70 border-blue-200' : 'bg-gray-50 border-gray-100'}`}>
        <div className="flex items-center flex-1 min-w-0 mr-2">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${isActive ? 'bg-blue-100 border-blue-300 text-blue-600' : 'bg-white border-gray-200 text-gray-400'} mr-3 shrink-0`}>
            <Store className="w-5 h-5" />
          </div>
          <p className={`truncate text-left text-sm font-bold ${isActive ? 'text-blue-900' : 'text-gray-900'}`}>{s.name}</p>
        </div>
        {isActive ? (
          <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-2 py-1 rounded-lg">{t('Unalotumia sasa')}</span>
        ) : (
          <button
            disabled={!!switchingId}
            onClick={() => handleSwitch(s)}
            className="text-xs font-bold text-blue-600 bg-white border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-xl transition-all disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5"
          >
            {isSwitching && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            {isSwitching ? t('Inahamisha...') : t('Hamia Hapa')}
          </button>
        )}
      </div>
    );
  };

  if (variant === 'lapsed') {
    // Nowhere to go: the licence screen stays as it was.
    if (!others.length) return null;
    return (
      <div className="w-full max-w-md mb-6 text-left" data-testid="shop-switcher-lapsed">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 text-center">{t('Au hamia kwenye duka lako jingine')}</p>
        <div className="space-y-2">{others.map(row)}</div>
      </div>
    );
  }

  return (
    <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100" data-testid="shop-switcher">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <div className="bg-blue-100 p-2 rounded-xl mr-3">
            <Store className="w-6 h-6 text-blue-600" />
          </div>
          <div className="text-left">
            <h2 className="text-lg font-semibold text-gray-800">{t('Usimamizi wa Maduka')}</h2>
            <p className="text-xs text-gray-500">{t('Menejimenti na kubadili duka lako')}</p>
          </div>
        </div>
        {allowCreate && (
          <button
            onClick={() => setShowAdd(true)}
            className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md transition-colors flex items-center space-x-1 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span className="text-xs font-bold">{t('Ongeza Duka')}</span>
          </button>
        )}
      </div>

      {loading && shops === null ? (
        <div className="flex justify-center py-4">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
        </div>
      ) : (shops ?? []).length > 0 ? (
        <div className="space-y-3">{(shops ?? []).map(row)}</div>
      ) : (
        <p className="text-xs text-gray-400 text-center py-4 italic">{t('Hakuna maduka mengine yaliyopatikana.')}</p>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center text-blue-600">
                <Store className="w-6 h-6 mr-2" />
                <h2 className="text-xl font-bold">{t('Ongeza Duka')}</h2>
              </div>
              <button onClick={() => { setShowAdd(false); setNewName(''); }} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full cursor-pointer" aria-label={t('Funga')}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">{t('Jina la Duka')}</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder={t('mfano: Duka la Kariakoo')}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-700"
                  autoFocus
                  required
                />
              </div>

              <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl text-blue-700 text-[10px] leading-relaxed">
                {/* The trial is one per owner (init-license), so a second shop is
                    not promised one. */}
                <b>{t('Maelezo:')}</b> {t('Duka jipya lina leseni yake mwenyewe. Trial ya siku 14 ni kwa duka lako la kwanza tu; duka la pili linahitaji kifurushi. Unaweza kuongeza wafanyakazi maalum kwa ajili ya duka hili pekee.')}
              </div>

              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowAdd(false); setNewName(''); }}
                  className="flex-1 py-4 text-gray-500 font-bold bg-gray-100 hover:bg-gray-200 rounded-2xl cursor-pointer"
                >
                  {t('Ghairi')}
                </button>
                <button
                  type="submit"
                  disabled={adding || !newName.trim()}
                  className="flex-1 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-blue-100 cursor-pointer transition-all"
                >
                  {adding ? t('Inatengeneza...') : t('Tengeneza Duka')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
