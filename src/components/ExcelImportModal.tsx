import React, { useState, useRef } from 'react';
// NOTE: xlsx is intentionally NOT imported statically. It is one of the heaviest
// libraries in the app (~400 kB) but is only needed when a user actually imports or
// exports a spreadsheet. It is lazy-loaded via `await import('xlsx')` at each use site
// so it stays out of the initial bundle and off the first-load critical path.
import { X, Upload, CheckCircle, AlertCircle, Download, ChevronRight } from 'lucide-react';
import { db, Product } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { SyncService } from '../services/sync';
import { TelemetryService } from '../services/telemetry';

// Import safety limits — reject files that could freeze the device or bloat the DB.
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_ROWS = 10000;                // data rows (excludes the header row)
const MAX_COLUMNS = 30;
const MAX_NAME_LEN = 100;
const MAX_BARCODE_LEN = 50;

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  shopId: string;
}

interface Mapping {
  name: string;
  buy_price: string;
  sell_price: string;
  stock: string;
  min_stock: string;
  barcode: string;
  expiry_date: string;
  notify_expiry_days: string;
}

interface ConstantValues {
  min_stock: string;
  notify_expiry_days: string;
}

export default function ExcelImportModal({ isOpen, onClose, shopId }: ExcelImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<any[]>([]);
  const [step, setStep] = useState<'upload' | 'mapping' | 'options' | 'processing' | 'summary'>('upload');
  const [mapping, setMapping] = useState<Mapping>({
    name: '',
    buy_price: '',
    sell_price: '',
    stock: '',
    min_stock: '',
    barcode: '',
    expiry_date: '',
    notify_expiry_days: ''
  });
  const [constants, setConstants] = useState<ConstantValues>({
    min_stock: '5',
    notify_expiry_days: '30'
  });
  const [options, setOptions] = useState({
    rejectEmptyBuyPrice: true,
    rejectEmptySellPrice: true,
    mergeDuplicates: true
  });
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{ 
    success: number; 
    failed: any[]; 
    duplicates: number;
    merged: number;
    warnings: string[];
  }>({ 
    success: 0, 
    failed: [], 
    duplicates: 0,
    merged: 0,
    warnings: []
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  if (!isOpen) return null;

  const resetFileInput = () => { if (fileInputRef.current) fileInputRef.current.value = ''; };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    setImportError(null);

    // Guard 1: file size (before we even read it into memory).
    if (selectedFile.size > MAX_FILE_SIZE) {
      setImportError(`Faili ni kubwa mno (${(selectedFile.size / 1024 / 1024).toFixed(1)}MB). Kiwango cha juu ni ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
      resetFileInput();
      return;
    }

    setFile(selectedFile);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const XLSX = await import('xlsx');
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const jsonData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[];

        if (jsonData.length === 0) {
          setImportError('Faili halina data yoyote.');
          resetFileInput();
          return;
        }
        // Guard 2: row limit (exclude the header row).
        const dataRowCount = jsonData.length - 1;
        if (dataRowCount > MAX_ROWS) {
          setImportError(`Faili lina safu (rows) ${dataRowCount.toLocaleString()}. Kiwango cha juu ni ${MAX_ROWS.toLocaleString()}. Tafadhali gawanya faili katika sehemu ndogo.`);
          resetFileInput();
          return;
        }
        const sheetHeaders = (jsonData[0] as string[]) || [];
        // Guard 3: column limit.
        if (sheetHeaders.length > MAX_COLUMNS) {
          setImportError(`Faili lina safu wima (columns) ${sheetHeaders.length}. Kiwango cha juu ni ${MAX_COLUMNS}.`);
          resetFileInput();
          return;
        }

        setHeaders(sheetHeaders);
        setData(XLSX.utils.sheet_to_json(ws));

        // Auto-mapping attempt
        const newMapping = { ...mapping };
        sheetHeaders.forEach(h => {
          const lowerH = String(h).toLowerCase();
          if (lowerH.includes('name') || lowerH.includes('bidhaa') || lowerH.includes('jina')) newMapping.name = h;
          if (lowerH.includes('buy') || lowerH.includes('kununua')) newMapping.buy_price = h;
          if (lowerH.includes('sell') || lowerH.includes('kuuza')) newMapping.sell_price = h;
          if (lowerH.includes('stock') || lowerH.includes('idadi')) newMapping.stock = h;
          if (lowerH.includes('min') || lowerH.includes('tahadhari')) newMapping.min_stock = h;
          if (lowerH.includes('bar') || lowerH.includes('code')) newMapping.barcode = h;
          if (lowerH.includes('exp') || lowerH.includes('isha')) newMapping.expiry_date = h;
          if (lowerH.includes('notify') || lowerH.includes('siku')) newMapping.notify_expiry_days = h;
        });
        setMapping(newMapping);
        setStep('mapping');
      } catch (err) {
        console.error('Excel parse failed:', err);
        setImportError('Imeshindwa kusoma faili. Hakikisha ni faili sahihi la Excel (.xlsx/.xls/.csv) na halijaharibika.');
        resetFileInput();
      }
    };
    reader.onerror = () => { setImportError('Imeshindwa kusoma faili.'); resetFileInput(); };
    reader.readAsBinaryString(selectedFile);
  };

  const handleImport = async () => {
    setStep('processing');
    setProgress(0);

    const failedRows: any[] = [];
    let duplicatesCount = 0;
    let mergedCount = 0;
    let successCount = 0;
    
    const processedData = new Map<string, { product: any; totalStock: number; originalRow: any }>();
    const seenExactRows = new Set<string>();

    const totalRows = data.length;
    const shop = await db.shops.get(shopId);
    const enableExpiry = shop?.enable_expiry === true;
    const globalStockEnabled = shop?.enable_stock !== false;

    // Helper to convert Excel serial date to YYYY-MM-DD
    const excelDateToJSDate = (serial: number) => {
      const utc_days = Math.floor(serial - 25569);
      const utc_value = utc_days * 86400;
      const date_info = new Date(utc_value * 1000);
      const fractional_day = serial - Math.floor(serial) + 0.0000001;
      let total_seconds = Math.floor(86400 * fractional_day);
      const seconds = total_seconds % 60;
      total_seconds -= seconds;
      const hours = Math.floor(total_seconds / (60 * 60));
      const minutes = Math.floor(total_seconds / 60) % 60;
      // Use UTC getters (date_info represents a UTC-midnight instant) so the
      // result doesn't shift a day depending on the device's local timezone.
      return new Date(date_info.getUTCFullYear(), date_info.getUTCMonth(), date_info.getUTCDate(), hours, minutes, seconds);
    };

    const sanitizeNumber = (val: any): number => {
      if (val === undefined || val === null || val === '') return 0;
      if (typeof val === 'number') return val;
      // Remove commas and convert to float
      const cleaned = String(val).replace(/,/g, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? 0 : num;
    };

    const sanitizeDate = (val: any): string => {
      if (!val) return '';
      if (typeof val === 'number') {
        // Handle Excel serial date
        try {
          const date = excelDateToJSDate(val);
          return date.toISOString().split('T')[0];
        } catch (e) {
          return '';
        }
      }
      const str = String(val).trim();
      if (!str) return '';
      // Try to parse standard date string
      const d = new Date(str);
      return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
    };
    
    // Step 3, 4, 5: Data Cleaning, Validation, and Merging
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      
      if (i % 100 === 0 || i === totalRows - 1) {
        setProgress(Math.round(((i + 1) / totalRows) * 30)); 
      }

      try {
        // Step 4: Mandatory Name
        const name = String(row[mapping.name] || '').trim();
        if (!name) throw new Error('Jina la Bidhaa limekosekana');
        if (name.length > MAX_NAME_LEN) throw new Error(`Jina refu mno (zaidi ya herufi ${MAX_NAME_LEN})`);

        // Step 3: Sanitize Numbers
        const buyPriceRaw = row[mapping.buy_price];
        const sellPriceRaw = row[mapping.sell_price];
        
        let buyPrice = sanitizeNumber(buyPriceRaw);
        let sellPrice = sanitizeNumber(sellPriceRaw);

        // Step 4: Price Checks
        if (buyPrice <= 0 && options.rejectEmptyBuyPrice) {
          throw new Error('Bei ya kununua ni sifuri, hasi, au imekosekana');
        }
        if (sellPrice <= 0 && options.rejectEmptySellPrice) {
          throw new Error('Bei ya kuuza ni sifuri, hasi, au imekosekana');
        }

        const stock = sanitizeNumber(row[mapping.stock]);
        const expiry = sanitizeDate(row[mapping.expiry_date]);
        
        // Step 1: Manual Overrides & Constants
        let minStock = 0;
        if (mapping.min_stock && row[mapping.min_stock] !== undefined) {
          minStock = sanitizeNumber(row[mapping.min_stock]);
        } else {
          minStock = sanitizeNumber(constants.min_stock) || 5;
        }

        let notifyDays = 30;
        if (mapping.notify_expiry_days && row[mapping.notify_expiry_days] !== undefined) {
          notifyDays = sanitizeNumber(row[mapping.notify_expiry_days]);
        } else {
          notifyDays = sanitizeNumber(constants.notify_expiry_days) || 30;
        }

        // Step 5: Deduplication & Merging Logic
        const exactKey = `${name.toLowerCase()}|${buyPrice}|${sellPrice}|${stock}|${expiry}`;
        if (seenExactRows.has(exactKey)) {
          duplicatesCount++;
          continue;
        }
        seenExactRows.add(exactKey);

        const mergeKey = `${name.toLowerCase()}|${buyPrice}|${sellPrice}|${expiry}`;
        
        if (options.mergeDuplicates && processedData.has(mergeKey)) {
          const existing = processedData.get(mergeKey)!;
          existing.totalStock += stock;
          mergedCount++;
        } else {
          // If mergeDuplicates is OFF, we use a unique key to keep them separate
          const finalKey = options.mergeDuplicates ? mergeKey : uuidv4();
          processedData.set(finalKey, {
            product: { 
              name, 
              buy_price: buyPrice, 
              sell_price: sellPrice, 
              expiry, 
              min_stock: minStock, 
              barcode: row[mapping.barcode] ? String(row[mapping.barcode]).slice(0, MAX_BARCODE_LEN) : undefined, 
              notify_expiry_days: notifyDays 
            },
            totalStock: stock,
            originalRow: row
          });
        }
      } catch (err: any) {
        // Step 4: Error Tracking
        failedRows.push({ ...row, _error: err.message });
      }
    }

    // Step 6: Chunked Database Insertion
    const uniqueEntries = Array.from(processedData.values());
    const totalToSave = uniqueEntries.length;
    const CHUNK_SIZE = 500;

    for (let i = 0; i < uniqueEntries.length; i += CHUNK_SIZE) {
      const chunk = uniqueEntries.slice(i, i + CHUNK_SIZE);
      const productsToSave: Product[] = chunk.map(entry => {
        const product: Product = {
          id: uuidv4(),
          shop_id: shopId,
          name: entry.product.name,
          buy_price: entry.product.buy_price,
          sell_price: entry.product.sell_price,
          stock: entry.totalStock,
          stock_delta: entry.totalStock,
          min_stock: entry.product.min_stock,
          notify_expiry_days: enableExpiry ? entry.product.notify_expiry_days : undefined,
          unit: 'pcs',
          batches: [],
          track_stock: globalStockEnabled,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          synced: 0, // Step 6: Marked as synced: 0
          isDeleted: 0
        };

        if (enableExpiry && entry.product.expiry) {
          product.batches = [{
            id: uuidv4(),
            batch_number: 'IMP-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5),
            expiry_date: new Date(entry.product.expiry).toISOString(),
            stock: entry.totalStock
          }];
        }
        return product;
      });

      await db.transaction('rw', db.products, async () => {
        await db.products.bulkPut(productsToSave);
      });
      successCount += productsToSave.length;
      
      const currentProgress = 30 + Math.round(((i + chunk.length) / totalToSave) * 70);
      setProgress(currentProgress);
    }

    // Step 7: Report Generation
    setResults({ 
      success: successCount, 
      failed: failedRows, 
      duplicates: duplicatesCount, 
      merged: mergedCount, 
      warnings: [] 
    });

    // Log action
    if (successCount > 0) {
      SyncService.logAction('import_products', { 
        count: successCount, 
        merged: mergedCount, 
        duplicates: duplicatesCount 
      });
      TelemetryService.trackBulkImport(successCount);
    }

    setStep('summary');
    SyncService.sync();
  };

  const downloadErrors = async () => {
    if (results.failed.length === 0) return;
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(results.failed);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Errors");
    XLSX.writeFile(wb, "makosa_ya_kuingiza_bidhaa.xlsx");
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800">Ingiza Bidhaa (Excel)</h2>
          <button onClick={onClose} className="p-2 rounded-full transition-colors">
            <X className="w-6 h-6 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === 'upload' && (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-200 rounded-2xl p-12 flex flex-col items-center justify-center cursor-pointer transition-all w-full"
              >
                <Upload className="w-12 h-12 text-blue-500 mb-4" />
                <p className="text-gray-600 font-medium text-center">Bonyeza hapa kupakia faili la Excel (.xlsx, .xls, .csv)</p>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                  accept=".xlsx, .xls, .csv"
                />
              </button>
              <p className="text-[11px] text-gray-400 text-center mt-3">
                Kiwango cha juu: bidhaa {MAX_ROWS.toLocaleString()}, ukubwa {MAX_FILE_SIZE / 1024 / 1024}MB kwa faili moja.
              </p>
              {importError && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}
            </>
          )}

          {step === 'mapping' && (
            <div className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-2xl mb-4">
                <p className="text-xs text-blue-700 leading-relaxed">
                  <strong>Mwongozo:</strong> Linganisha vichwa vya habari vya faili lako na sehemu za mfumo. 
                  Jina la Bidhaa pekee ndilo lazima. Sehemu nyingine unaweza kuziacha tupu na kuweka thamani za kudumu katika hatua inayofuata.
                </p>
              </div>
              <div className="space-y-4">
                {Object.keys(mapping).map((key) => (
                  <div key={key} className="flex flex-col space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                      {key.replace(/_/g, ' ')} {key === 'name' && <span className="text-red-500">*</span>}
                    </label>
                    <select 
                      value={mapping[key as keyof Mapping]} 
                      onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Acha Tupu (Tumia Thamani ya Kudumu) --</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <button 
                onClick={() => setStep('options')}
                disabled={!mapping.name}
                className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl mt-6 disabled:opacity-50 shadow-lg shadow-blue-100"
              >
                Endelea kwenye Mipangilio
              </button>
            </div>
          )}

          {step === 'options' && (
            <div className="space-y-6">
              <div className="bg-orange-50 p-4 rounded-2xl">
                <h4 className="font-bold text-orange-800 mb-2">Mipangilio ya Uingizaji</h4>
                <p className="text-sm text-orange-700">Sanidi jinsi data itakavyoshughulikiwa:</p>
              </div>

              <div className="space-y-6">
                {/* Constants Section */}
                <div className="space-y-4">
                  <h5 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Thamani za Kudumu (Kwa safu tupu)</h5>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500">Min Stock</label>
                      <input 
                        type="number"
                        value={constants.min_stock}
                        onChange={(e) => setConstants({...constants, min_stock: e.target.value})}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500">Siku za Tahadhari</label>
                      <input 
                        type="number"
                        value={constants.notify_expiry_days}
                        onChange={(e) => setConstants({...constants, notify_expiry_days: e.target.value})}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Price Handling */}
                <div className="space-y-3">
                  <h5 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Bei Zinazokosekana</h5>
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                    <div>
                      <p className="font-bold text-gray-800 text-sm">Bei ya Kununua tupu</p>
                    </div>
                    <div className="flex bg-white rounded-lg p-1 border border-gray-200">
                      <button 
                        onClick={() => setOptions({...options, rejectEmptyBuyPrice: true})}
                        className={`px-3 py-1 text-xs font-bold rounded-md ${options.rejectEmptyBuyPrice ? 'bg-red-500 text-white' : 'text-gray-500'}`}
                      >
                        Kataa
                      </button>
                      <button 
                        onClick={() => setOptions({...options, rejectEmptyBuyPrice: false})}
                        className={`px-3 py-1 text-xs font-bold rounded-md ${!options.rejectEmptyBuyPrice ? 'bg-green-500 text-white' : 'text-gray-500'}`}
                      >
                        Weka 0
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                    <div>
                      <p className="font-bold text-gray-800 text-sm">Bei ya Kuuza tupu</p>
                    </div>
                    <div className="flex bg-white rounded-lg p-1 border border-gray-200">
                      <button 
                        onClick={() => setOptions({...options, rejectEmptySellPrice: true})}
                        className={`px-3 py-1 text-xs font-bold rounded-md ${options.rejectEmptySellPrice ? 'bg-red-500 text-white' : 'text-gray-500'}`}
                      >
                        Kataa
                      </button>
                      <button 
                        onClick={() => setOptions({...options, rejectEmptySellPrice: false})}
                        className={`px-3 py-1 text-xs font-bold rounded-md ${!options.rejectEmptySellPrice ? 'bg-green-500 text-white' : 'text-gray-500'}`}
                      >
                        Weka 0
                      </button>
                    </div>
                  </div>
                </div>

                {/* Duplicates Handling */}
                <div className="space-y-3">
                  <h5 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Bidhaa Zinazojirudia</h5>
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                    <div>
                      <p className="font-bold text-gray-800 text-sm">Unganisha (Merge)</p>
                      <p className="text-[10px] text-gray-500">Jina, Bei na Tarehe zikifanana</p>
                    </div>
                    <button 
                      onClick={() => setOptions({...options, mergeDuplicates: !options.mergeDuplicates})}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${options.mergeDuplicates ? 'bg-blue-600' : 'bg-gray-200'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${options.mergeDuplicates ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex space-x-3">
                <button 
                  onClick={() => setStep('mapping')}
                  className="flex-1 py-4 border border-gray-200 text-gray-600 font-bold rounded-2xl"
                >
                  Rudi
                </button>
                <button 
                  onClick={handleImport}
                  className="flex-2 bg-blue-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-100"
                >
                  Anza Kuingiza
                </button>
              </div>
            </div>
          )}

          {step === 'processing' && (
            <div className="text-center py-12">
              <div className="w-24 h-24 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mx-auto mb-6"></div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">Inachakata Data...</h3>
              <p className="text-gray-500 mb-6">Tafadhali usifunge dirisha hili. Tunashughulikia bidhaa {data.length.toLocaleString()}</p>
              <div className="w-full bg-gray-100 rounded-full h-4 overflow-hidden">
                <div 
                  className="bg-blue-600 h-full transition-all duration-300" 
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <p className="text-sm font-bold text-blue-600 mt-2">{progress}% imekamilika</p>
            </div>
          )}

          {step === 'summary' && (
            <div className="py-4">
              <div className="text-center mb-8">
                {results.failed.length === 0 ? (
                  <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                ) : (
                  <AlertCircle className="w-16 h-16 text-orange-500 mx-auto mb-4" />
                )}
                <h3 className="text-2xl font-bold text-gray-800">Ripoti ya Kuagiza</h3>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-green-50 p-4 rounded-2xl text-center">
                  <p className="text-2xl font-bold text-green-600">{results.success.toLocaleString()}</p>
                  <p className="text-xs text-green-700 font-medium uppercase tracking-wider">Zimeingizwa</p>
                </div>
                <div className="bg-red-50 p-4 rounded-2xl text-center">
                  <p className="text-2xl font-bold text-red-600">{results.failed.length.toLocaleString()}</p>
                  <p className="text-xs text-red-700 font-medium uppercase tracking-wider">Zimekataliwa</p>
                </div>
                <div className="bg-blue-50 p-4 rounded-2xl text-center">
                  <p className="text-2xl font-bold text-blue-600">{results.duplicates.toLocaleString()}</p>
                  <p className="text-xs text-blue-700 font-medium uppercase tracking-wider">Nakala (Skipped)</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-2xl text-center">
                  <p className="text-2xl font-bold text-purple-600">{results.merged.toLocaleString()}</p>
                  <p className="text-xs text-purple-700 font-medium uppercase tracking-wider">Zimeunganishwa</p>
                </div>
              </div>

              {results.failed.length > 0 && (
                <div className="mb-6">
                  <p className="text-sm text-gray-500 mb-3">Kuna makosa yamejitokeza. Unaweza kupakua faili la Excel lenye data zilizofeli pekee ili kuzirekebisha:</p>
                  <button 
                    onClick={downloadErrors}
                    className="flex items-center justify-center space-x-2 w-full p-4 bg-gray-100 text-gray-700 rounded-2xl font-bold transition-colors"
                  >
                    <Download className="w-5 h-5" />
                    <span>Pakua Faili la Makosa (Excel)</span>
                  </button>
                </div>
              )}

              <button 
                onClick={onClose}
                className="w-full bg-gray-800 text-white font-bold py-4 rounded-2xl shadow-lg"
              >
                Kamilisha
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
