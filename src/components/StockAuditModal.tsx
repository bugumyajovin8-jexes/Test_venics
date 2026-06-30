import React, { useState, useRef } from 'react';
import { Camera, Upload, X, Check, Loader2, AlertCircle, ShoppingBag, Eye, TrendingDown, TrendingUp } from 'lucide-react';
import { auditProductsFromImage, AuditResult } from '../services/aiBoarding';
import { db, Product } from '../db';
import { SyncService } from '../services/sync';

interface StockAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  onSuccess: (message: string) => void;
}

export default function StockAuditModal({ isOpen, onClose, products, onSuccess }: StockAuditModalProps) {
  const [step, setStep] = useState<'upload' | 'processing' | 'results'>('upload');
  const [auditResults, setAuditResults] = useState<AuditResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Tafadhali chagua picha sahihi.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      startAudit(base64, file.type);
    };
    reader.readAsDataURL(file);
  };

  const startAudit = async (base64: string, mimeType: string) => {
    setStep('processing');
    setError(null);
    try {
      const inventory = products.map(p => ({ name: p.name, stock: p.stock }));
      const foundItems = await auditProductsFromImage(base64, mimeType, inventory);
      
      const results: AuditResult[] = foundItems.map(item => {
        const systemProduct = products.find(p => p.name.toLowerCase().includes(item.name.toLowerCase()) || item.name.toLowerCase().includes(p.name.toLowerCase()));
        const expected = systemProduct ? systemProduct.stock : 0;
        const actual = item.actual_stock;
        const diff = actual - expected;
        
        return {
          product_id: systemProduct?.id,
          name: systemProduct?.name || item.name,
          expected_stock: expected,
          actual_stock: actual,
          discrepancy: diff,
          status: diff === 0 ? 'match' : (diff < 0 ? 'missing' : 'extra')
        };
      });

      setAuditResults(results);
      setStep('results');
    } catch (err: any) {
      setError(err.message || 'Kushindwa kukagua picha. Jaribu upate picha yenye mwanga wa kutosha.');
      setStep('upload');
    }
  };

  const handleApplyAudit = async () => {
    try {
      let updatedCount = 0;
      for (const res of auditResults) {
        if (res.product_id && res.discrepancy !== 0) {
          const product = await db.products.get(res.product_id);
          if (product) {
            await db.products.update(res.product_id, {
              stock: res.actual_stock,
              stock_delta: (product.stock_delta || 0) + res.discrepancy,
              updated_at: new Date().toISOString(),
              synced: 0
            });
            
            SyncService.logAction('edit_product', {
              product_id: res.product_id,
              name: res.name,
              changes: {
                stock: { old: res.expected_stock, new: res.actual_stock },
                audit_discrepancy: res.discrepancy
              }
            });
            updatedCount++;
          }
        }
      }
      
      SyncService.sync();
      onSuccess(`Ukaguzi umekamilika. Bidhaa ${updatedCount} zimeidhinishwa na kurekebishwa idadi yake.`);
      onClose();
    } catch (err) {
      setError('Tatizo lilitokea wakati wa kuhifadhi ukaguzi.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        
        <div className="p-6 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-xl font-bold text-gray-900">AI Stock Audit</h2>
            <p className="text-sm text-gray-500">Kagua idadi ya bidhaa rafu kwa kutumia picha</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full transition-colors">
            <X className="w-6 h-6 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start text-red-600">
              <AlertCircle className="w-5 h-5 mr-3 shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          {step === 'upload' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-3xl p-10 flex flex-col items-center justify-center bg-gray-50 transition-all cursor-pointer group"
                >
                  <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center mb-4 group-">
                    <Camera className="w-8 h-8" />
                  </div>
                  <p className="font-bold text-gray-900">Piga Picha Rafu</p>
                  <input type="file" ref={cameraInputRef} onChange={handleFileChange} accept="image/*" className="hidden" capture="environment" />
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-3xl p-10 flex flex-col items-center justify-center bg-gray-50 transition-all cursor-pointer group"
                >
                  <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mb-4 group-">
                    <Upload className="w-8 h-8" />
                  </div>
                  <p className="font-bold text-gray-900">Pakia Picha</p>
                  <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                </button>
              </div>

              <div className="bg-orange-50 p-4 rounded-2xl border border-orange-100">
                <p className="text-xs text-orange-800 font-bold mb-2 uppercase tracking-wide">UKAGUZI WA USALAMA:</p>
                <p className="text-xs text-orange-700">
                  AI italinganisha idadi uliyopiga picha na idadi iliyopo kwenye mfumo. Ukikubali, stock itarekebishwa moja kwa moja.
                </p>
              </div>
            </div>
          )}

          {step === 'processing' && (
            <div className="py-20 flex flex-col items-center justify-center space-y-4">
              <div className="w-20 h-20 border-4 border-orange-100 border-t-orange-600 rounded-full animate-spin"></div>
              <div className="text-center">
                <p className="text-lg font-bold text-gray-900">AI Inasoma na Kuhesabu...</p>
                <p className="text-sm text-gray-500 italic">Hii inahusisha kulinganisha stock ya mfumo</p>
              </div>
            </div>
          )}

          {step === 'results' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                 <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest">Matokeo ya Ukaguzi</h3>
                 <button onClick={() => setStep('upload')} className="text-xs text-orange-600 font-bold">Piga picha upya</button>
              </div>

              <div className="space-y-3">
                {auditResults.map((result, idx) => (
                  <div key={idx} className="bg-gray-50 border border-gray-100 p-4 rounded-2xl flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-800 truncate">{result.name}</p>
                      <div className="flex items-center mt-1 space-x-3">
                        <p className="text-xs text-gray-500">Mfumo: <span className="font-bold">{result.expected_stock}</span></p>
                        <p className="text-xs text-gray-500">Picha: <span className="font-bold text-blue-600">{result.actual_stock}</span></p>
                      </div>
                    </div>
                    
                    <div className="flex items-center ml-4">
                      {result.discrepancy === 0 ? (
                        <div className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold flex items-center">
                          <Check className="w-3 h-3 mr-1" /> Sawa
                        </div>
                      ) : (
                        <div className={`px-3 py-1 rounded-full text-xs font-bold flex items-center ${result.discrepancy < 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                          {result.discrepancy < 0 ? <TrendingDown className="w-3 h-3 mr-1" /> : <TrendingUp className="w-3 h-3 mr-1" />}
                          {result.discrepancy > 0 ? '+' : ''}{result.discrepancy}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {auditResults.length === 0 && (
                  <div className="text-center py-10 bg-gray-50 rounded-2xl border border-dashed">
                    <p className="text-gray-500 italic text-sm">Hakuna bidhaa zilizolinganishwa. Jaribu kupiga picha iliyo karibu zaidi.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {step === 'results' && auditResults.length > 0 && (
          <div className="p-6 border-t border-gray-100 bg-white sticky bottom-0">
            <button 
              onClick={handleApplyAudit}
              className="w-full bg-orange-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-orange-100 transition-all flex items-center justify-center"
            >
              <Check className="w-5 h-5 mr-2" /> Idhinisha na Rekebisha Stock
            </button>
            <p className="text-center text-[10px] text-gray-400 mt-3">
              Stock za mfumo zitasasishwa kulingana na idadi ya kwenye picha.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
