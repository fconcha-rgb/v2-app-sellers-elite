import { useEffect, useState } from 'react';
import { businessToday, type BusinessToday } from './period.ts';

const TODAY_REFRESH_MS = 60_000;

/** Unico punto de la UI que lee el reloj. Devuelve la fecha de negocio
 *  (America/Santiago) y se actualiza sola al cambiar el dia, de modo que un
 *  tab abierto el 31-dic pasa a enero sin recargar. */
export function useToday(): BusinessToday {
  const [today, setToday] = useState<BusinessToday>(() => businessToday(new Date()));
  useEffect(() => {
    const refresh = () =>
      setToday((prev) => {
        const next = businessToday(new Date());
        return next.date === prev.date ? prev : next;
      });
    const id = window.setInterval(refresh, TODAY_REFRESH_MS);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return today;
}
