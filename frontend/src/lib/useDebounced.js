import { useEffect, useState } from "react";

/** Returns `value` after it has stopped changing for `delay` ms (keeps typing in a search box from firing a request per key). */
export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return v;
}
