import React from 'react';
import { useStore } from '../store';
import { AlertCircle, HelpCircle } from 'lucide-react';

export const GlobalModal: React.FC = () => {
  const { modal, hideModal } = useStore();

  if (!modal.isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6">
          <div className="flex items-center justify-center mb-4">
            {modal.type === 'alert' ? (
              <div className="bg-red-100 p-3 rounded-full">
                <AlertCircle className="w-8 h-8 text-red-600" />
              </div>
            ) : (
              <div className="bg-blue-100 p-3 rounded-full">
                <HelpCircle className="w-8 h-8 text-blue-600" />
              </div>
            )}
          </div>
          <h3 className="text-lg font-bold text-center text-gray-900 mb-2">
            {modal.title}
          </h3>
          <p className="text-center text-gray-600">
            {modal.message}
          </p>
        </div>
        <div className="bg-gray-50 px-6 py-4 flex justify-end space-x-3">
          {modal.type === 'confirm' && (
            <button
              onClick={() => {
                if (modal.onCancel) modal.onCancel();
                hideModal();
              }}
              className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
            >
              Hapana
            </button>
          )}
          <button
            onClick={() => {
              if (modal.onConfirm) modal.onConfirm();
              hideModal();
            }}
            className={`px-4 py-2 text-white rounded-lg font-medium ${
              modal.type === 'alert' ? 'bg-blue-600 hover:bg-blue-700 w-full' : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {modal.type === 'alert' ? 'Sawa' : 'Ndiyo'}
          </button>
        </div>
      </div>
    </div>
  );
};
