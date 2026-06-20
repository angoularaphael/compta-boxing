'use client';

import { useCallback, useRef, useState } from 'react';

export function useSingleAction() {
  const lockRef = useRef(false);
  const [pending, setPending] = useState(false);

  const run = useCallback(async (fn, { resetOnError = true, resetOnSuccess = true } = {}) => {
    if (lockRef.current) return undefined;
    lockRef.current = true;
    setPending(true);
    try {
      const result = await fn();
      if (resetOnSuccess) {
        lockRef.current = false;
        setPending(false);
      }
      return result;
    } catch (err) {
      if (resetOnError) {
        lockRef.current = false;
        setPending(false);
      }
      throw err;
    }
  }, []);

  const reset = useCallback(() => {
    lockRef.current = false;
    setPending(false);
  }, []);

  return { run, pending, reset };
}
