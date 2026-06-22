const SESSION_KEY = 'cc_session'

function getSession() {
  try {
    let id = localStorage.getItem(SESSION_KEY)
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(SESSION_KEY, id) }
    return id
  } catch { return '' }
}

export function track(type, data = {}) {
  try {
    const payload = { type, session_id: getSession(), data }
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/analytics', JSON.stringify(payload))
    } else {
      fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }
  } catch (_) {}
}
