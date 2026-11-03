const HEARTBEAT_MS = 25000;
const RETRY_MS = 5000;

// Tells open monitors the moment something is saved. The ping keeps proxies from closing a quiet connection.
function createLiveStream(subscribe, heartbeatMs = HEARTBEAT_MS) {
  return (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`retry: ${RETRY_MS}\n\n`);

    const unsubscribe = subscribe(() => res.write('data: schimbare\n\n'));
    const heartbeat = setInterval(() => res.write(': ping\n\n'), heartbeatMs);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  };
}

module.exports = { createLiveStream };
