import { useEffect, useRef, useState } from 'react';
import { logEvent } from './api.js';

// Live results over Server-Sent Events. The browser keeps one connection
// open; the server pushes a "results" event every second. EventSource
// reconnects automatically if the connection drops (for example when the API
// server holding it restarts), usually to a different server.
export function useLiveResults(pollId, enabled = true) {
  const [results, setResults] = useState(null);
  const [status, setStatus] = useState('connecting');
  const lastServer = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const es = new EventSource(`/api/polls/${pollId}/stream`);
    es.addEventListener('results', (e) => {
      const data = JSON.parse(e.data);
      setResults(data);
      setStatus('live');
      if (data.servedBy !== lastServer.current) {
        lastServer.current = data.servedBy;
        logEvent({ method: 'SSE', path: `/polls/${pollId.slice(0, 8)}…/stream`, status: 'open', servedBy: data.servedBy, readFrom: 'push 1/s', ms: 0 });
      }
    });
    es.addEventListener('error-status', () => setStatus('degraded'));
    es.onerror = () => setStatus('reconnecting');
    return () => es.close();
  }, [pollId, enabled]);

  return { results, status };
}
