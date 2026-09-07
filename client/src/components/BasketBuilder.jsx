import { useState } from 'react'
import { motion } from 'framer-motion'
import { useLang } from '../i18n'
import { apiFetch } from '../api'
import { track } from '../analytics'

const STORE_ORDER = ['kapruka', 'gfc', 'spar', 'cargills', 'glomark', 'arpico']
const STORE_COLORS = {
  kapruka: '#e53935', gfc: '#1565c0', spar: '#f9a825',
  cargills: '#ff8f00', glomark: '#7b1fa2', arpico: '#0b2545',
}
const STORE_NAMES = {
  kapruka: 'Kapruka', gfc: 'Global Food City', spar: 'SPAR',
  cargills: 'Cargills', glomark: 'Glomark', arpico: 'Arpico',
}

const PRESETS = [
  { q: 'rice', qty: 5, unit: 'kg', label: 'Rice' },
  { q: 'dhal', qty: 1, unit: 'kg', label: 'Dhal' },
  { q: 'eggs', qty: 30, unit: 'eggs', label: 'Eggs' },
  { q: 'milk powder', qty: 1, unit: 'kg', label: 'Milk Powder' },
  { q: 'sugar', qty: 2, unit: 'kg', label: 'Sugar' },
  { q: 'tea', qty: 1, unit: 'pkt', label: 'Tea' },
  { q: 'bread', qty: 1, unit: 'loaf', label: 'Bread' },
  { q: 'chicken', qty: 1, unit: 'kg', label: 'Chicken' },
  { q: 'potato', qty: 2, unit: 'kg', label: 'Potato' },
  { q: 'onion', qty: 1, unit: 'kg', label: 'Onion' },
  { q: 'cooking oil', qty: 1, unit: 'L', label: 'Cooking Oil' },
  { q: 'toilet paper', qty: 2, unit: 'pack', label: 'Toilet Paper' },
]

function fmtPrice(n) {
  if (typeof n !== 'number' || isNaN(n)) return '—'
  return 'Rs ' + Math.round(n).toLocaleString('en-LK')
}

function Sparkline({ trend }) {
  if (!trend || trend.length < 2) return null
  const w = 220, h = 42, pad = 4
  const prices = trend.map(t => t.p)
  const min = Math.min(...prices), max = Math.max(...prices)
  const range = (max - min) || 1
  const pts = trend.map((t, i) => {
    const x = pad + (i / (trend.length - 1)) * (w - pad * 2)
    const y = h - pad - ((t.p - min) / range) * (h - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: 'block' }} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="#00a86b" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function buildPlanItems(rawItems) {
  // Find each item's cheapest store: lowest price*qty
  const plan = {}
  for (const item of rawItems) {
    const entries = Object.entries(item.stores || {})
    if (!entries.length) continue
    let bestStore = null; let bestCost = Infinity
    for (const [store, p] of entries) {
      const cost = (p.price || 0) * item.qty
      if (cost < bestCost) { bestCost = cost; bestStore = store }
    }
    if (!bestStore) continue
    if (!plan[bestStore]) plan[bestStore] = []
    plan[bestStore].push({ ...item, chosen: { ...item.stores[bestStore], __cost: bestCost } })
  }
  return plan
}

export default function BasketBuilder() {
  const { t } = useLang()
  const [items, setItems] = useState([])
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const has = (q) => items.some(i => i.q === q)
  const addPreset = (preset) => {
    if (has(preset.q)) return
    setItems(prev => [...prev, { ...preset }])
  }
  const setQty = (q, qty) => {
    setItems(prev => prev.map(i => i.q === q ? { ...i, qty: Math.max(1, qty || 1) } : i))
  }
  const removeItem = (q) => {
    setItems(prev => prev.filter(i => i.q !== q))
    setRaw(null)
  }
  const clearAll = () => { setItems([]); setRaw(null) }

  const fetchPrices = async () => {
    if (!items.length) return
    setLoading(true); setError(''); setRaw(null)
    try {
      const res = await apiFetch('/api/basket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map(({ q, qty, unit }) => ({ q, qty, unit })) }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setRaw(data)
      track('basket_build', { itemCount: items.length })
    } catch (e) {
      setError(e.message || t('basket.error'))
    }
    setLoading(false)
  }

  // Derived totals from raw prices
  const storeTotals = {}
  const itemBest = []
  if (raw && Array.isArray(raw.items)) {
    for (const item of raw.items) {
      const entries = Object.entries(item.stores || {})
      if (!entries.length) continue
      let bestStore = null; let bestCost = Infinity
      for (const [store, p] of entries) {
        const cost = (p.price || 0) * item.qty
        if (cost < bestCost) { bestCost = cost; bestStore = store }
      }
      if (bestStore) {
        itemBest.push({ q: item.q, qty: item.qty, unit: item.unit, store: bestStore, cost: bestCost, product: item.stores[bestStore] })
      }
      for (const [store, p] of entries) {
        if (!storeTotals[store]) storeTotals[store] = { total: 0, count: 0 }
        storeTotals[store].total += (p.price || 0) * item.qty
        storeTotals[store].count += 1
      }
    }
    for (const sid of STORE_ORDER) {
      if (storeTotals[sid] && storeTotals[sid].total === 0) delete storeTotals[sid]
    }
  }
  const hasData = !!raw && Array.isArray(raw.items) && raw.items.length > 0
  const optimalTotal = itemBest.reduce((s, i) => s + i.cost, 0)
  let bestSingle = null; let bestSingleTotal = Infinity
  for (const [sid, st] of Object.entries(storeTotals)) {
    if (st.total < bestSingleTotal) { bestSingleTotal = st.total; bestSingle = sid }
  }
  const plan = hasData ? buildPlanItems(raw.items) : {}
  const savings = Number.isFinite(bestSingleTotal) && bestSingleTotal > optimalTotal ? bestSingleTotal - optimalTotal : 0
  const sortedStores = STORE_ORDER.filter(s => storeTotals[s]).sort((a, b) => storeTotals[a].total - storeTotals[b].total)

  const buildShareText = () => {
    const lines = ['🛒 My Grocery Basket — GroceryLK', '─────────────────']
    for (const [store, list] of Object.entries(plan)) {
      lines.push(`📍 ${STORE_NAMES[store] || store}`)
      for (const i of list) {
        const label = i.unit && i.qty ? `${i.qty} ${i.unit}` : (i.unit || '')
        lines.push(`   • ${i.q || ''} ${label ? '(' + label + ')' : ''} — ${i.chosen?.priceFormatted || fmtPrice(i.chosen?.price)}`)
      }
    }
    lines.push('─────────────────')
    lines.push(`💰 Optimal total: ${fmtPrice(optimalTotal)}`)
    if (bestSingle) lines.push(`✅ Save ${fmtPrice(savings)} vs buying all at ${STORE_NAMES[bestSingle]}`)
    lines.push('', 'Sent via GroceryLK')
    return lines.join('\n')
  }
  const whatsappText = encodeURIComponent(buildShareText())
  const copyText = () => {
    navigator.clipboard.writeText(buildShareText()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <motion.section
      id="basket-builder"
      className="grocery-list-section"
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5 }}
    >
      <div className="section-label">
        <span className="label-line" />
        <h2 className="label-text">{t('basket.title')}</h2>
        <span className="label-line" />
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 20 }}>
        {t('basket.subtitle')}
      </p>

      <div className="gl-tabs">
        <button className="gl-tab active">{t('basket.presets')}</button>
      </div>

      {/* Preset chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 20 }}>
        {PRESETS.map(p => (
          <button
            key={p.q}
            className={`bk-chip ${has(p.q) ? 'active' : ''}`}
            onClick={() => addPreset(p)}
            disabled={has(p.q)}
          >
            + {p.label}
          </button>
        ))}
      </div>

      {/* Basket rows */}
      {items.length > 0 && (
        <div className="bk-items" style={{ maxWidth: 560, margin: '0 auto' }}>
          {items.map(item => (
            <div key={item.q} className="bk-row">
              <div className="bk-row-name">
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.q}</span>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{item.unit}</span>
              </div>
              <div className="bk-qty">
                <button className="bk-qty-btn" onClick={() => setQty(item.q, item.qty - 1)} aria-label="decrease">−</button>
                <span className="bk-qty-val">{item.qty}</span>
                <button className="bk-qty-btn" onClick={() => setQty(item.q, item.qty + 1)} aria-label="increase">+</button>
              </div>
              <button className="gl-remove-btn" onClick={() => removeItem(item.q)} aria-label={t('basket.remove', { name: item.q })}>✕</button>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="gl-actions" style={{ justifyContent: 'center' }}>
          <button className="gl-copy-btn" onClick={fetchPrices} disabled={loading}>
            {loading ? t('basket.refreshing') : t('basket.freshPrices')}
          </button>
          <button className="gl-clear-btn" onClick={clearAll}>{t('grocery.clearList')}</button>
        </div>
      )}

      {loading && (
        <div className="loading-container"><div className="loader-ring" /><p>{t('basket.refreshing')}</p></div>
      )}

      {error && !loading && (
        <p style={{ textAlign: 'center', color: '#f85149', fontSize: 13 }}>{t('basket.error')}</p>
      )}

      {hasData && !loading && (
        <div className="gl-plan-summary">
          <div className="gl-plan-optimal">
            <span className="gl-plan-label">{t('basket.total')} (optimal)</span>
            <span className="gl-plan-value">{fmtPrice(optimalTotal)}</span>
            <span className="gl-plan-fee-note">{itemBest.length} {t('basket.items')} · {Object.keys(plan).length} {t('basket.stores')}</span>
          </div>
          {bestSingle && (
            <div className="gl-plan-save">
              <span className="gl-plan-label">{t('basket.cheapestSingle')} {STORE_NAMES[bestSingle]}: {fmtPrice(bestSingleTotal)}</span>
              {savings > 0 && <span className="gl-plan-value gl-plan-save-value">-{fmtPrice(savings)}</span>}
            </div>
          )}
        </div>
      )}

      {/* Store totals */}
      {hasData && !loading && sortedStores.length > 0 && (
        <div className="gl-store-totals" style={{ marginTop: 16 }}>
          {sortedStores.map(s => (
            <div key={s} className={`gl-store-total ${s === bestSingle ? 'gl-best' : ''}`}>
              <span className="gl-store-name" style={{ color: STORE_COLORS[s] }}>
                {s === bestSingle ? '🏆 ' : ''}{STORE_NAMES[s]}
              </span>
              <span className="gl-store-total-price">{fmtPrice(storeTotals[s].total)}</span>
              <span className="gl-store-count">{storeTotals[s].count} {t('basket.items')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Split plan */}
      {hasData && !loading && Object.keys(plan).length > 0 && (
        <div className="gl-plan-stores" style={{ marginTop: 16 }}>
          {Object.entries(plan).map(([store, list]) => {
            const storeTotal = list.reduce((s, i) => s + i.chosen.__cost, 0)
            return (
              <div key={store} className="gl-plan-store">
                <div className="gl-plan-store-header" style={{ borderLeftColor: STORE_COLORS[store] }}>
                  <span className="gl-plan-store-name" style={{ color: STORE_COLORS[store] }}>{STORE_NAMES[store]}</span>
                  <span className="gl-plan-store-total">{fmtPrice(storeTotal)}</span>
                </div>
                <div className="gl-plan-items">
                  {list.map((i, j) => (
                    <div key={store + '-' + j} className="gl-plan-item">
                      <span className="gl-plan-item-name">{i.q}{i.unit && i.qty ? ` (${i.qty} ${i.unit})` : ''}</span>
                      <span className="gl-plan-item-price">{i.chosen?.priceFormatted || fmtPrice(i.chosen?.price)}</span>
                    </div>
                  ))}
                </div>
                <a
                  className="gl-plan-order"
                  href={list[0]?.chosen?.url || '#'}
                  target="_blank" rel="noopener noreferrer"
                >
                  {t('grocery.shopAt', { store: STORE_NAMES[store] })}
                </a>
              </div>
            )
          })}
        </div>
      )}

      {/* Price trends */}
      {hasData && !loading && raw.items.some(i => (i.trend || []).length > 1) && (
        <div className="gl-plan-summary" style={{ marginTop: 16 }}>
          <div className="gl-plan-optimal" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <span className="gl-plan-label" style={{ textAlign: 'center', marginBottom: 4 }}>{t('basket.trends')}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {raw.items.filter(i => (i.trend || []).length > 1).map(i => {
                const prices = i.trend.map(t => t.p)
                const low = Math.min(...prices), high = Math.max(...prices), first = prices[0], cur = prices[prices.length - 1]
                const arrow = cur > first ? '▲' : cur < first ? '▼' : '—'
                return (
                  <div key={i.q} className="bk-row" style={{ padding: '8px 12px', gap: 12 }}>
                    <div className="bk-row-name" style={{ minWidth: 90 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', textTransform: 'capitalize' }}>{i.q}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {fmtPrice(low)} – {fmtPrice(high)} <span style={{ color: cur > first ? '#f85149' : cur < first ? '#00c853' : 'var(--text-secondary)' }}>{arrow} {fmtPrice(cur)}</span>
                      </span>
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <Sparkline trend={i.trend} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {hasData && !loading && (
        <div className="gl-actions">
          <button className="gl-copy-btn" onClick={copyText}>{copied ? t('basket.copied') : t('basket.copyText')}</button>
          <a className="gl-share-btn" href={`https://wa.me/?text=${whatsappText}`} target="_blank" rel="noopener noreferrer">
            {t('basket.shareWhatsApp')}
          </a>
        </div>
      )}
    </motion.section>
  )
}