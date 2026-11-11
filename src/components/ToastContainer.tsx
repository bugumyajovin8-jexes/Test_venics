import React from 'react';
import { useStore } from '../store';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function ToastContainer() {
  const { toasts, removeToast } = useStore();

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center space-y-2 w-full max-w-sm px-4 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            className={`
              pointer-events-auto flex items-center p-3 rounded-2xl shadow-lg border w-full
              ${toast.type === 'success' ? 'bg-green-50 border-green-100 text-green-800' : ''}
              ${toast.type === 'error' ? 'bg-red-50 border-red-100 text-red-800' : ''}
              ${toast.type === 'info' ? 'bg-blue-50 border-blue-100 text-blue-800' : ''}
            `}
          >
            <div className="mr-3 shrink-0">
              {toast.type === 'success' && <CheckCircle className="w-5 h-5 text-green-600" />}
              {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-red-600" />}
              {toast.type === 'info' && <Info className="w-5 h-5 text-blue-600" />}
            </div>
            <p className="text-sm font-bold flex-1">{toast.message}</p>
            <button 
              onClick={() => removeToast(toast.id)}
              className="ml-3 p-1 hover:bg-black/5 rounded-full transition-colors"
            >
              <X className="w-4 h-4 opacity-50" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
