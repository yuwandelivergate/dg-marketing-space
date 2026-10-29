export function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

export function allow(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader('Allow', methods.join(', '));
  send(res, 405, { error: 'Method not allowed' });
  return false;
}

// Wraps a handler so unexpected errors become a clean 500 instead of a crash page.
export function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong on the server. Try again in a moment.' });
    }
  };
}

export const isUuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
