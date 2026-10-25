import { useEffect, useState } from 'react';

import type { OfficePresenceSnapshot } from '../../../core/src/officePresence.js';
import { isBrowserRuntime } from '../runtime.js';

export function useOfficePresence() {
  const [presence, setPresence] = useState<OfficePresenceSnapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isBrowserRuntime || import.meta.env.DEV) return;
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch('/api/office/presence', { signal: controller.signal });
        if (response.status === 404) return;
        if (!response.ok) throw new Error();
        const next: OfficePresenceSnapshot = await response.json();
        if (!controller.signal.aborted) {
          setPresence(next);
          setError('');
        }
      } catch {
        if (!controller.signal.aborted)
          setError('No se puede actualizar el estado de las sesiones.');
      } finally {
        pending = false;
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 2000);
    return () => {
      clearInterval(interval);
      controller.abort();
    };
  }, []);
  return { presence, error };
}
