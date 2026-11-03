// Calls the backend under /api/v1 with relative URLs; the gateway adds the user's token.
// Usage: api.get('/spaces?type=meeting_room'), api.post('/reservations', body), api.del(path, body?).

export class ApiError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status // 0 when the network failed
    this.code = code // the backend's {"detail": "<CODE>"}, else NETWORK or HTTP_<status>
  }
}

async function request(method, path, body) {
  let res
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      redirect: 'manual',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK')
  }
  // An expired session gets the gateway's redirect to Keycloak: treated as a 401.
  const status = res.type === 'opaqueredirect' ? 401 : res.status
  const data = status === 204 ? null : await res.json().catch(() => null)
  if (res.ok) return data
  // App.jsx listens to this to show the expired-session page.
  if (status === 401) window.dispatchEvent(new Event('api:unauthorized'))
  throw new ApiError(status, typeof data?.detail === 'string' ? data.detail : `HTTP_${status}`)
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path, body) => request('DELETE', path, body),
}
