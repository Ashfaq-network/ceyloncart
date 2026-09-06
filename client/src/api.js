const API_KEY = 'bf86aa4a89c343c216927904ab3f11da2b876d8b06ece2e3'

export function apiFetch(url, opts = {}) {
  const isFormData = typeof FormData !== 'undefined' && opts.headers instanceof FormData
  const headers = isFormData ? opts.headers : new Headers(opts.headers || {})
  if (!isFormData && !headers.has('x-api-key')) {
    headers.set('x-api-key', API_KEY)
  }
  return fetch(url, { ...opts, headers })
}
