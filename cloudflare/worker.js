const PLATFORM_PATHS = new Set(['win/x64', 'mac/universal', 'linux/x64', 'linux/arm64']);
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:\+build\.\d+)?$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,240}$/;

function validKey(pathname) {
  let parts;
  try { parts = pathname.split('/').filter(Boolean).map(decodeURIComponent); }
  catch { return null; }
  if (parts.some(part => !SAFE_NAME.test(part) || part.includes('..'))) return null;
  if (parts.length === 2 && PLATFORM_PATHS.has(parts.join('/'))) return null;
  if (parts.length === 3 && PLATFORM_PATHS.has(`${parts[0]}/${parts[1]}`)) return parts.join('/');
  if (parts.length === 3 && parts[0] === 'releases' && RELEASE_TAG.test(parts[1])) return parts.join('/');
  return null;
}

function cacheControl(key) {
  return key.endsWith('.yml') || key.endsWith('.yaml')
    ? 'public, max-age=60, must-revalidate'
    : 'public, max-age=31536000, immutable';
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const key = validKey(new URL(request.url).pathname);
    if (!key) return new Response('Not found', { status: 404 });

    const object = await env.UPDATES.get(key, request.headers.has('Range') ? { range: request.headers } : undefined);
    if (!object) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Cache-Control', cacheControl(key));
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Length', String(object.range?.length ?? object.size));
    if (object.range) {
      const start = object.range.offset;
      const end = start + object.range.length - 1;
      headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`);
    }
    if (request.headers.get('If-None-Match') === object.httpEtag) return new Response(null, { status: 304, headers });
    return new Response(request.method === 'HEAD' ? null : object.body, { status: object.range ? 206 : 200, headers });
  },
};
