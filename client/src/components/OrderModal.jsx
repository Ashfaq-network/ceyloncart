import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useLang } from '../i18n'

export default function OrderModal({ product, onClose }) {
  const { t } = useLang()
  const [step, setStep] = useState('form') // form | success | error
  const modalRef = useRef(null)
  const [cities, setCities] = useState([])
  const [cityLoading, setCityLoading] = useState(false)

  useEffect(() => {
    if (product.store !== 'kapruka') return
    setCityLoading(true)
    const timer = setTimeout(() => setCityLoading(false), 5000)
    fetch('/api/cities?limit=50')
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : data.cities || data.results || []
        setCities(Array.isArray(list) ? list : [])
      })
      .catch(() => setCities([]))
      .finally(() => { clearTimeout(timer); setCityLoading(false) })
  }, [product.store])

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    modalRef.current?.focus()
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])
  const [submitting, setSubmitting] = useState(false)
  const [orderResult, setOrderResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    city: '',
    delivery_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    instructions: '',
  })

  const handleChange = (e) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setErrorMsg('')

    try {
      const res = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart: [{ product_id: product.originalId, quantity: 1 }],
          recipient: { name: form.name, phone: form.phone },
          delivery: {
            address: form.address,
            city: form.city,
            date: form.delivery_date,
            instructions: form.instructions || null,
          },
          sender: { name: form.name, anonymous: false },
          currency: 'LKR',
        }),
      })

      const data = await res.json()
      if (data.error) throw new Error(data.error)

      const url = data.checkout_url || data.payment_url || data.url || data.redirect_url
        || data.result?.checkout_url || data.data?.checkout_url
      const orderRef = data.order_ref || data.order_number || data.orderId || data.reference || data.id
      data.checkout_url = url || (orderRef ? `https://www.kapruka.com/order/${orderRef}` : '')
      if (!url) data.order_ref = orderRef || data.order_ref || ''

      setOrderResult(data)
      setStep('success')
    } catch (err) {
      setErrorMsg(err.message)
      setStep('error')
    }
    setSubmitting(false)
  }

  const fromKapruka = product.store === 'kapruka'

  return (
    <motion.div
      className="modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="modal-content"
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Order ${product.name}`}
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {product.storeName}
            </div>
            <h3 style={{ fontSize: 18, marginBottom: 4 }}>{t('order.title')}</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {product.name}
            </p>
            <p style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)', marginTop: 4 }}>
              {product.priceFormatted}
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {step === 'form' && fromKapruka && (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Your Name</label>
              <input name="name" value={form.name} onChange={handleChange} required placeholder="Kamal Perera" />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Phone</label>
                <input name="phone" value={form.phone} onChange={handleChange} required placeholder="077 123 4567" />
              </div>
              <div className="form-group">
                <label>Delivery Date</label>
                <input type="date" name="delivery_date" value={form.delivery_date} onChange={handleChange} required />
              </div>
            </div>

            <div className="form-group">
              <label>Delivery Address</label>
              <input name="address" value={form.address} onChange={handleChange} required placeholder="123, Galle Road, Colombo 03" />
            </div>

            <div className="form-group">
              <label>City {cityLoading && <span style={{ fontSize: 11, color: '#888' }}>(loading...)</span>}</label>
              <input name="city" value={form.city} onChange={handleChange} required list="city-list" placeholder={cityLoading ? 'Loading cities...' : 'Type a city name...'} autoComplete="off" />
              <datalist id="city-list">
                {cities.map(c => {
                  const v = typeof c === 'string' ? c : c.name || c.city || ''
                  return <option key={v} value={v} />
                })}
              </datalist>
            </div>

            <div className="form-group">
              <label>Delivery Instructions (optional)</label>
              <textarea name="instructions" value={form.instructions} onChange={handleChange} placeholder="Leave at gate, call on arrival..." />
            </div>

            <button type="submit" className="submit-order-btn" disabled={submitting}>
              {submitting ? 'Placing Order...' : 'Place Order — Pay Later'}
            </button>

            <p style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 12 }}>
              You'll receive a payment link after placing the order. No account needed.
            </p>
          </form>
        )}

        {step === 'form' && !fromKapruka && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Ordering from {product.storeName} is not available yet. Visit their website to purchase.
            </p>
            <a
              href={product.url}
              target="_blank"
              rel="noopener noreferrer"
              className="checkout-link"
              style={{ display: 'inline-block' }}
            >
              {t('order.openStore', { store: product.storeName })}
            </a>
          </div>
        )}

        {step === 'success' && orderResult && (
          <div className="order-success">
            <div className="check-icon">✅</div>
            <h3>Order Placed!</h3>
            <p>Reference: {orderResult.order_ref}</p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Total: Rs. {orderResult.summary?.grand_total?.toLocaleString('en-LK', { minimumFractionDigits: 2 })}
            </p>
            {orderResult.checkout_url ? (
              <>
                <button
                  className="checkout-link"
                  onClick={() => {
                    const w = window.open(orderResult.checkout_url, '_blank')
                    if (!w) alert('Popup blocked! Please allow popups or click Done and visit Kapruka with your order reference.')
                  }}
                >
                  Pay Now →
                </button>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 12 }}>
                  Link expires in 60 minutes. Complete payment to confirm your order.
                </p>
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 12, textAlign: 'center' }}>
                You will receive a payment link via SMS/email from Kapruka to complete your order.
              </p>
            )}
            <button
              className="submit-order-btn"
              style={{ marginTop: 16, background: 'var(--surface2)', color: 'var(--text)' }}
              onClick={onClose}
            >
              Done
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className="order-success">
            <div className="check-icon" style={{ color: 'var(--red)' }}>❌</div>
            <h3>Order Failed</h3>
            <p style={{ color: 'var(--red)' }}>{errorMsg}</p>
            <button
              className="submit-order-btn"
              style={{ marginTop: 16 }}
              onClick={() => setStep('form')}
            >
              Try Again
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
