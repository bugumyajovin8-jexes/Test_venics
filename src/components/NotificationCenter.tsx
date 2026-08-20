import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { Bell, BellRing, X, Check, ArrowRight, MessageSquare, AlertTriangle, HelpCircle, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useLocation } from 'react-router-dom';

export default function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const { 
    notificationsList, 
    dismissNotification, 
    clearNotificationList,
    setMshauriOpen
  } = useStore();

  // Close dropdown clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Hide completely unless we are on the Mshauri/Executive page
  if (location.pathname !== '/executive') {
    return null;
  }

  const visibleNotifications = notificationsList.filter(n => !n.isHidden);
  const unreadNotifications = visibleNotifications.filter(n => !n.isRead);
  const hasUnread = unreadNotifications.length > 0;
  
  // Show only ONE active unread notification pop-out at a time!
  const activeNotification = unreadNotifications[0];

  const handleSeeMore = (page: string, id: string) => {
    dismissNotification(id);
    setIsOpen(false);
    
    switch (page) {
      case 'stock':
        navigate('/bidhaa');
        break;
      case 'sales':
        navigate('/dashibodi');
        break;
      case 'expenses':
        navigate('/matumizi');
        break;
      case 'security':
        navigate('/audit-logs');
        break;
      case 'license':
        navigate('/zaidi');
        break;
      default:
        navigate('/');
    }
  };

  const handleReply = (chatPrompt: string, id: string) => {
    dismissNotification(id);
    setIsOpen(false);
    setMshauriOpen(true, chatPrompt);
  };

  return (
    <>
      {/* 1. AUTO POP-OUT TOAST BANNER (One unread at a time, sliding down from top center) */}
      <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center w-full max-w-[92vw] sm:max-w-md pointer-events-none">
        <AnimatePresence mode="wait">
          {activeNotification && (
            <motion.div
              key={activeNotification.id}
              initial={{ opacity: 0, y: -40, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95, transition: { duration: 0.2 } }}
              className="pointer-events-auto w-full bg-white border border-slate-100 shadow-2xl rounded-2xl flex flex-col overflow-hidden ring-1 ring-black/5"
            >
              {/* Top accent header based on notification category */}
              <div className={`p-3.5 flex items-center justify-between border-b ${
                activeNotification.type === 'critical'
                  ? 'bg-rose-50/55 border-rose-100 text-rose-800'
                  : activeNotification.type === 'warning'
                    ? 'bg-amber-50/55 border-amber-100 text-amber-800'
                    : 'bg-indigo-50/55 border-indigo-100 text-indigo-800'
              }`}>
                <div className="flex items-center space-x-2">
                  <div className={`p-1.5 rounded-lg ${
                    activeNotification.type === 'critical' ? 'bg-rose-600 text-white animate-pulse' :
                    activeNotification.type === 'warning' ? 'bg-amber-500 text-white' :
                    'bg-indigo-600 text-white'
                  }`}>
                    {activeNotification.type === 'critical' || activeNotification.type === 'warning' ? (
                      <AlertTriangle className="w-4 h-4" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                  </div>
                  <span className="text-xs font-black tracking-wider uppercase font-sans">
                    {activeNotification.type === 'critical' ? '🚨 TATIZO KUU' :
                     activeNotification.type === 'warning' ? '⚠️ SHAKA' : '📢 ALERT YA DUKA'}
                  </span>
                </div>

                <div className="flex items-center space-x-1">
                  <span className="text-[10px] text-gray-400 font-mono">
                    {new Date(activeNotification.timestamp).toLocaleTimeString('sw-TZ', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <button
                    onClick={() => dismissNotification(activeNotification.id)}
                    className="p-2 rounded-full text-slate-400 transition-colors cursor-pointer"
                    title="Ondoa"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Message Details */}
              <div className="p-4 bg-white">
                <h4 className="font-extrabold text-slate-900 text-sm mb-1.5">{activeNotification.title}</h4>
                <p className="text-slate-600 text-xs sm:text-[13px] leading-relaxed">
                  {activeNotification.message}
                </p>
              </div>

              {/* Action Buttons Footer */}
              <div className="px-4 pb-4 pt-1 flex items-center justify-end gap-2 bg-slate-50 border-t border-slate-100">
                <button
                  onClick={() => dismissNotification(activeNotification.id)}
                  className="text-xs font-bold text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-xl transition-all cursor-pointer shadow-sm active:scale-95"
                >
                  Ondoa
                </button>
                <button
                  onClick={() => handleSeeMore(activeNotification.page, activeNotification.id)}
                  className="text-xs font-bold text-slate-700 bg-white border border-slate-200 px-3 py-1.5 rounded-xl transition-all flex items-center space-x-1 cursor-pointer shadow-sm active:scale-95"
                >
                  <span>Mengi zaidi</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleReply(activeNotification.chatPrompt, activeNotification.id)}
                  className="text-xs font-bold text-white bg-indigo-600 px-3.5 py-1.5 rounded-xl transition-all flex items-center space-x-1 cursor-pointer shadow-md active:scale-95"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Chat</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 2. FLOATING BELL BUTTON & DROP-DOWN PANEL (Positioned beautifully at the top right of Mshauri page) */}
      <div className="fixed top-4 right-4 z-[48] outline-none" ref={dropdownRef}>
        <button 
          id="notification-bell-btn"
          onClick={() => setIsOpen(!isOpen)}
          className={`relative flex items-center justify-center p-3 rounded-full shadow-lg border cursor-pointer transition-all duration-300 ${
            hasUnread 
              ? 'bg-amber-500 text-white border-amber-600  focus:ring-4 focus:ring-amber-300 animate-pulse' 
              : 'bg-white text-gray-700 border-gray-200   focus:ring-4 focus:ring-gray-100'
          }`}
        >
          {hasUnread ? (
            <BellRing className="w-5.5 h-5.5 animate-bounce" />
          ) : (
            <Bell className="w-5.5 h-5.5" />
          )}

          {hasUnread && (
            <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[11px] font-black w-6 h-6 rounded-full flex items-center justify-center shadow border-2 border-white animate-scale">
              {unreadNotifications.length}
            </span>
          )}
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div 
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className="absolute right-0 mt-3 w-[350px] sm:w-[420px] max-w-[92dvw] bg-white border border-gray-100/90 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-md ring-1 ring-black/5 z-50 flex flex-col max-h-[500px]"
            >
              <div className="bg-gradient-to-r from-slate-900 to-indigo-950 px-4.5 py-4 flex items-center justify-between shadow">
                <div className="flex items-center space-x-2">
                  <span className="text-lg">📢</span>
                  <span className="font-bold text-white text-sm sm:text-base">Alert na Ripoti za Duka</span>
                </div>
                
                {hasUnread && (
                  <button 
                    onClick={() => clearNotificationList()}
                    className="text-xs text-indigo-200 font-medium bg-white/10 px-2.5 py-1 rounded-lg transition-all cursor-pointer"
                  >
                    Soma Zote
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto max-h-[380px] p-2 bg-slate-50/50 space-y-2 no-scrollbar">
                {visibleNotifications.length === 0 ? (
                  <div className="py-12 px-6 text-center flex flex-col items-center justify-center">
                    <div className="p-4 bg-emerald-50 rounded-full text-emerald-600 mb-3 border border-emerald-100">
                      <Check className="w-7 h-7" />
                    </div>
                    <h4 className="font-semibold text-gray-800 text-sm sm:text-base">Kila Kitu Kiko Salama!</h4>
                    <p className="text-gray-500 text-xs mt-1 max-w-[240px]">Hakuna alert, taarifa za shaka au hatari ya kumalizika kwa muda wa Mfumo kwa sasa.</p>
                  </div>
                ) : (
                  visibleNotifications.map((notification) => {
                    const isCritical = notification.type === 'critical';
                    const isWarning = notification.type === 'warning';
                    
                    return (
                      <div 
                        key={notification.id}
                        className={`relative p-3.5 border rounded-xl shadow-sm transition-all flex flex-col bg-white outline-none ${
                          notification.isRead 
                            ? 'opacity-65 border-slate-100 ' 
                            : isCritical
                              ? 'border-l-4 border-l-rose-500 border-rose-100 bg-rose-50/15'
                              : isWarning
                                ? 'border-l-4 border-l-amber-500 border-amber-100 bg-amber-50/15'
                                : 'border-l-4 border-l-blue-500 border-blue-100 bg-blue-50/15'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center space-x-2">
                            {!notification.isRead && (
                              <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping absolute top-4 left-4" />
                            )}
                            <div className={`p-1.5 rounded-lg ${
                              isCritical ? 'bg-rose-50 border border-rose-100 text-rose-600' :
                              isWarning ? 'bg-amber-50 border border-amber-100 text-amber-600' :
                              'bg-blue-50 border border-blue-100 text-blue-600'
                            }`}>
                              {isCritical || isWarning ? (
                                <AlertTriangle className="w-4 h-4" />
                              ) : (
                                <HelpCircle className="w-4 h-4" />
                              )}
                            </div>
                            <div>
                              <h5 className="font-extrabold text-gray-900 text-xs sm:text-sm">{notification.title}</h5>
                              <span className="text-[10px] text-gray-400 font-mono block mt-0.5">
                                {new Date(notification.timestamp).toLocaleString('sw-TZ', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>

                          <button 
                            onClick={() => dismissNotification(notification.id)}
                            className="text-gray-400 p-1 rounded-full leading-none transition-colors"
                            title="Futa arifa hii"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <p className="text-gray-700 text-xs mt-2 line-clamp-3 leading-relaxed">
                          {notification.message}
                        </p>

                        <div className="flex border-t border-slate-100 mt-2.5 pt-2 items-center justify-end gap-1.5">
                          <button
                            onClick={() => dismissNotification(notification.id)}
                            className="text-[10.5px] font-bold text-gray-500 bg-gray-50 px-2.5 py-1 rounded transition-all cursor-pointer"
                          >
                            Ondoa
                          </button>
                          <button
                            onClick={() => handleSeeMore(notification.page, notification.id)}
                            className="text-[10.5px] font-bold text-indigo-600 px-2.5 py-1 rounded transition-all flex items-center space-x-0.5 cursor-pointer animate-none"
                          >
                            <span>See More</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleReply(notification.chatPrompt, notification.id)}
                            className="text-[10.5px] font-bold text-white bg-indigo-600 px-2.5 py-1 rounded transition-all flex items-center space-x-0.5 shadow-sm cursor-pointer animate-none"
                          >
                            <MessageSquare className="w-3 h-3" />
                            <span>Reply</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
