import { useContext } from 'react';
import { ToastContext } from '@/components/common/Toast';

export function useToast() {
  return useContext(ToastContext);
}
