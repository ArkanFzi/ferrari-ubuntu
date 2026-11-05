import React from 'react';
import { Bell, X, ExternalLink } from 'lucide-react';
import type { NotificationItem } from '../types/island';

interface NotificationCardProps {
  notification: NotificationItem;
  onDismiss: () => void;
  onOpen?: () => void;
}

export const NotificationCard: React.FC<NotificationCardProps> = ({
  notification,
  onDismiss,
  onOpen,
}) => {
  return (
    <div className="w-[420px] p-3 flex items-start gap-3 select-none">
      <div className="w-8 h-8 rounded-full bg-red-950/60 border border-red-800/50 flex items-center justify-center shrink-0 mt-0.5">
        <Bell className="w-4 h-4 text-red-500 animate-bounce" />
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-red-500 uppercase tracking-wider">
            {notification.app || 'Notifikasi Sistem'}
          </span>
          <span className="text-[10px] text-neutral-500">Baru saja</span>
        </div>

        <h4 className="text-xs font-semibold text-neutral-100 truncate mt-0.5">
          {notification.title}
        </h4>
        <p className="text-[11px] text-neutral-300 line-clamp-2 mt-0.5">
          {notification.body}
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {onOpen && (
          <button
            onClick={onOpen}
            className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            title="Buka"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={onDismiss}
          className="p-1 rounded-md text-neutral-400 hover:text-red-400 hover:bg-neutral-800 transition-colors"
          title="Tutup"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
