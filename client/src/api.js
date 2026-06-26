const API_KEY = 'bf86aa4a89c343c216927904ab3f11da2b876d8b06ece2e3'

export function apiFetch(url, opts = {}) {
  const headers = opts.headers || {}
  const isFormData = typeof FormData !== 'undefined' && headers instanceof FormData
  if (!isFormData) {
    headers['x-api-key'] = API_KEY
  }
  return fetch(url, { ...opts, headers })
}
