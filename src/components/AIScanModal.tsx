import React, { useState, useRef } from 'react';
import { Camera, Upload, X, Check, Loader2, AlertCircle, Trash2 } from 'lucide-react';
import { extractProductsFromImage, ExtractedProduct } from '../services/aiBoarding';
import { db } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { SyncService } from '../services/sync';
import { TelemetryService } from '../services/telemetry';
import { useStore } from '../store';
import VenicsLogo from './VenicsLogo';

interface AIScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  shopId: string;
  onSuccess: () => void;
}

export default function AIScanModal({ isOpen, onClose, shopId, onSuccess }: AIScanModalProps) {
  const { isFeatureEnabled } = useStore();
  const isExpiryEnabled = isFeatureEnabled('expiry');

  const [step, setStep] = useState<'upload' | 'processing' | 'review'>('upload');
  const [image, setImage] = useState<string | null>(null);
  const [extractedProducts, setExtractedProducts] = useState<ExtractedProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isFromCamera = e.target === cameraInputRef.current;

    if (!file.type.startsWith('image/')) {
      setError('Tafadhali chagua picha sahihi.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      setImage(reader.result as string);
      processImage(base64, file.type, isFromCamera);
    };
    reader.readAsDataURL(file);
  };

  const processImage = async (base64: string, mimeType: string, isFromCamera: boolean) => {
    setStep('processing');
    setError(null);
    try {
      const result = await extractProductsFromImage(base64, mimeType);
      setExtractedProducts(result.map(p => ({
        ...p,
        sell_price: p.sell_price !== undefined && p.sell_price !== null ? p.sell_price : Math.round(Number(p.buy_price || 0) * 1.2)
      })));
      setStep('review');
      TelemetryService.trackCameraProductScan(isFromCamera ? 'camera' : 'upload', result.length);
    } catch (err: any) {
      setError(err.message || 'Kuna tatizo lilitokea wakati wa kusoma picha.');
      setStep('upload');
    }
  };

  const handleSave = async () => {
    try {
      const shop = await db.shops.get(shopId);
      const globalStockEnabled = shop?.enable_stock !== false;
      const now = new Date().toISOString();
      const productsToSave = extractedProducts.map(p => {
        const parsedBuyPrice = Number(p.buy_price) || 0;
        const parsedSellPrice = Number(p.sell_price) || Math.round(parsedBuyPrice * 1.2);
        const parsedStock = Number(p.stock) || 0;

        const product: any = {
          id: uuidv4(),
          shop_id: shopId,
          name: p.name || 'Bidhaa',
          buy_price: parsedBuyPrice,
          sell_price: parsedSellPrice,
          stock: parsedStock,
          min_stock: 5,
          unit: 'pcs',
          stock_delta: parsedStock,
          batches: [],
          track_stock: globalStockEnabled,
          created_at: now,
          updated_at: now,
          synced: 0,
          isDeleted: 0
        };

        if (isExpiryEnabled && p.expiry_date) {
            product.batches = [{
                id: uuidv4(),
                batch_number: `B-${Date.now()}`,
                stock: parsedStock,
                expiry_date: new Date(p.expiry_date).toISOString(),
                created_at: now
            }];
            product.notify_expiry_days = 30; // default
        }

        return product;
      });

      for (const product of productsToSave) {
        await db.products.put(product);
        SyncService.logAction('add_product', {
          product_id: product.id,
          name: product.name,
          stock: product.stock,
          sell_price: product.sell_price,
          buy_price: product.buy_price
        });
      }

      TelemetryService.trackInstantProductMessageShare();
      SyncService.sync();
      onSuccess();
      onClose();
    } catch (err) {
      setError('Imeshindwa kuhifadhi bidhaa. Tafadhali jaribu tena.');
    }
  };

  const removeItem = (index: number) => {
    setExtractedProducts(prev => prev.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof ExtractedProduct, value: string | number) => {
    setExtractedProducts(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0 z-10">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2.5">
              <VenicsLogo size={24} animate="idle" />
              Venics Smart Assistant (Product Scanner)
            </h2>
            <p className="text-sm text-gray-500">Piga picha risiti au rafu kusajili bidhaa</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full transition-colors">
            <X className="w-6 h-6 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start text-red-600 animate-in slide-in-from-top-2">
              <AlertCircle className="w-5 h-5 mr-3 shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          {step === 'upload' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-3xl p-8 flex flex-col items-center justify-center bg-gray-50 transition-all cursor-pointer group"
                >
                  <div className="w-14 h-14 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mb-4 group- transition-transform">
                    <Camera className="w-7 h-7" />
                  </div>
                  <p className="text-sm font-bold text-gray-900 mb-1 text-center">Piga Picha</p>
                  <p className="text-[10px] text-gray-500 text-center">Tumia Kamera</p>
                  <input 
                    type="file" 
                    ref={cameraInputRef} 
                    onChange={handleFileChange} 
                    accept="image/*" 
                    className="hidden" 
                    capture="environment"
                  />
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-3xl p-8 flex flex-col items-center justify-center bg-gray-50 transition-all cursor-pointer group"
                >
                  <div className="w-14 h-14 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center mb-4 group- transition-transform">
                    <Upload className="w-7 h-7" />
                  </div>
                  <p className="text-sm font-bold text-gray-900 mb-1 text-center">Pakia Picha</p>
                  <p className="text-[10px] text-gray-500 text-center">Kutoka Gallery</p>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange} 
                    accept="image/*" 
                    className="hidden"
                  />
                </button>
              </div>

              <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                <p className="text-xs text-blue-800 font-medium mb-2 uppercase tracking-wider">Tips za kupata matokeo mazuri:</p>
                <ul className="text-xs text-blue-700 space-y-2 list-disc list-inside">
                  <li>Hakikisha kuna mwanga wa kutosha.</li>
                  <li>Weka risiti iwe imenyooka na ionekane yote.</li>
                  <li>Venics Smart Assistant itatambua Majina, Bei za Kununua, na Idadi zenyewe.</li>
                </ul>
              </div>
            </div>
          )}

          {step === 'processing' && (
            <div className="py-12 flex flex-col items-center justify-center space-y-4">
              <div className="relative flex items-center justify-center">
                {/* Embedded animated Venics SVG Logo doing high speed rotations of orbital curves when processing */}
                <VenicsLogo size={80} animate="loading" />
              </div>
              <div className="text-center pt-2">
                <p className="text-lg font-bold text-gray-900">Venics Smart Assistant Inasoma Picha...</p>
                <p className="text-sm text-gray-500">Hapa tunajaza taarifa zako chache</p>
              </div>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center mb-2">
                <p className="text-sm font-bold text-gray-500 uppercase tracking-widest">Bidhaa Zilizotambuliwa ({extractedProducts.length})</p>
                {image && (
                   <button 
                    onClick={() => setStep('upload')}
                    className="text-xs font-bold text-blue-600"
                   >
                    Badilisha Picha
                   </button>
                )}
              </div>

              <div className="space-y-3">
                {extractedProducts.map((product, index) => (
                  <div key={index} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 animate-in slide-in-from-bottom-2" style={{ animationDelay: `${index * 50}ms` }}>
                    <div className="flex justify-between items-start mb-3 gap-3">
                      <div className="flex-1">
                        <input 
                          value={product.name}
                          onChange={(e) => updateItem(index, 'name', e.target.value)}
                          className="w-full bg-transparent font-bold text-gray-900 border-none p-0 focus:ring-0 text-sm"
                          placeholder="Jina la bidhaa"
                        />
                      </div>
                      <button onClick={() => removeItem(index)} className="p-2 text-gray-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Idadi</label>
                        <input 
                          type="number"
                          value={product.stock === 0 && typeof product.stock !== 'string' ? '' : product.stock}
                          onChange={(e) => updateItem(index, 'stock', e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs font-bold"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Bei (Buy)</label>
                        <input 
                          type="number"
                          value={product.buy_price === 0 && typeof product.buy_price !== 'string' ? '' : product.buy_price}
                          onChange={(e) => updateItem(index, 'buy_price', e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs font-bold"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Bei (Sell)</label>
                        <input 
                          type="number"
                          value={product.sell_price === 0 && typeof product.sell_price !== 'string' ? '' : product.sell_price}
                          onChange={(e) => updateItem(index, 'sell_price', e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-full bg-blue-50 border border-blue-100 rounded-lg p-2 text-xs font-bold text-blue-700"
                          placeholder="0"
                        />
                      </div>
                      {isExpiryEnabled && (
                        <div className="col-span-3">
                          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Inaisha Lini (Expiry)</label>
                          <input 
                            type="date"
                            value={product.expiry_date || ''}
                            onChange={(e) => updateItem(index, 'expiry_date', e.target.value)}
                            className="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs font-bold"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {extractedProducts.length === 0 && (
                <div className="text-center py-12 bg-gray-50 rounded-3xl border border-dashed border-gray-200">
                  <p className="text-gray-500 italic">Hakuna bidhaa zilizotambuliwa. Jaribu kupiga picha upya.</p>
                  <button 
                    onClick={() => setStep('upload')}
                    className="mt-4 text-blue-600 font-bold"
                  >
                    Piga Picha Tena
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'review' && extractedProducts.length > 0 && (
          <div className="p-6 border-t border-gray-100 bg-white sticky bottom-0">
            <button 
              onClick={handleSave}
              className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-100 transition-all flex items-center justify-center"
            >
              <Check className="w-5 h-5 mr-2" /> Hifadhi Bidhaa Zote
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
