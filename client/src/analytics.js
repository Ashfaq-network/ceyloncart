const GA_ID = 'G-G9BBCKRZ3Y'

export function track(type, data = {}) {
  if (typeof window === 'undefined') return

  if (typeof window.gtag === 'function') {
    window.gtag('event', type, data)
  }
}

export function pageview(path) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return
  window.gtag('config', GA_ID, { page_path: path })
}
