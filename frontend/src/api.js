// Calls the backend under /api/v1 with relative URLs; the gateway adds the user's token.
// Usage: api.get('/spaces?type=meeting_room'), api.post('/reservations', body).

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
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK')
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (res.ok) return data
  // App.jsx listens to this to show the expired-session page.
  if (res.status === 401) window.dispatchEvent(new Event('api:unauthorized'))
  throw new ApiError(res.status, typeof data?.detail === 'string' ? data.detail : `HTTP_${res.status}`)
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
}
