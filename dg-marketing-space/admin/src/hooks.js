import { useEffect, useRef, useState } from 'react';

// Runs `fn` now and every `ms` while mounted; re-starts when deps change.
export function usePoll(fn, deps, ms = 15000) {
  const [state, setState] = useState({ data: null, error: null, loading: true, updatedAt: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer;
    setState((s) => ({ ...s, loading: true }));
    const run = async () => {
      try {
        const data = await fnRef.current();
        if (alive) setState({ data, error: null, loading: false, updatedAt: new Date() });
      } catch (err) {
        if (alive) setState((s) => ({ ...s, error: err.message, loading: false }));
      }
      if (alive && ms) timer = setTimeout(run, ms);
    };
    run();
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}
