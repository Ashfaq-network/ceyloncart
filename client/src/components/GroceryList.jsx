import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useLang } from '../i18n'

const STORE_ORDER = ['kapruka', 'gfc', 'spar', 'keells', 'cargills']
const STORE_COLORS = {
  kapruka: '#e53935', gfc: '#1565c0', spar: '#f9a825',
  keells: '#2e7d32', cargills: '#ff8f00',
}
const STORE_NAMES = {
  kapruka: 'Kapruka', gfc: 'GFC', spar: 'SPAR',
  keells: 'Keells', cargills: 'Cargills',
}

function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

function fmtPrice(n) {
  return 'Rs ' + Math.round(n).toLocaleString('en-LK')
}

function getDeliveryFee(storeId, total, stores) {
  const s = (stores || []).find(st => st.id === storeId)
  if (!s || !s.deliveryFee) return 0
  if (s.freeDeliveryMin > 0 && total >= s.freeDeliveryMin) return 0
  return s.deliveryFee
}

function buildData(items, includeDelivery, stores) {
  const groups = {}
  for (const item of items) {
    const key = normalizeName(item.name)
    if (!groups[key]) groups[key] = { name: item.name, key, products: {} }
    groups[key].products[item.store] = item
  }

  const plan = {}
  for (const g of Object.values(groups)) {
    const storeList = Object.keys(g.products)
    const best = storeList.reduce((a, b) => g.products[a].price < g.products[b].price ? a : b)
    if (!plan[best]) plan[best] = []
    plan[best].push({ name: g.name, product: g.products[best], allPrices: g.products })
  }

  const storeTotals = {}
  for (const sid of STORE_ORDER) {
    let total = 0; let count = 0
    for (const g of Object.values(groups)) {
      if (g.products[sid]) { total += g.products[sid].price; count++ }
    }
    if (count > 0) {
      const fee = includeDelivery ? getDeliveryFee(sid, total, stores) : 0
      storeTotals[sid] = { total, count, fee, totalWithFee: total + fee }
    }
  }

  const optimalTotal = Object.values(plan).flat().reduce((s, i) => s + i.product.price, 0)
  const planFees = includeDelivery
    ? Object.entries(plan).reduce((sum, [store, items]) => {
        const st = items.reduce((s, i) => s + i.product.price, 0)
        return sum + getDeliveryFee(store, st, stores)
      }, 0)
    : 0
  const optimalTotalWithFees = optimalTotal + planFees

  let bestSingleStore = null; let bestSingleTotal = Infinity; let bestSingleTotalWithFee = Infinity
  for (const [sid, st] of Object.entries(storeTotals)) {
    if (st.total < bestSingleTotal) { bestSingleTotal = st.total; bestSingleStore = sid }
    if (st.totalWithFee < bestSingleTotalWithFee) { bestSingleTotalWithFee = st.totalWithFee }
  }

  const sortedPlanEntries = Object.entries(plan).sort(
    (a, b) => a[1].reduce((s, i) => s + i.product.price, 0) - b[1].reduce((s, i) => s + i.product.price, 0)
  )

  const sortedStores = STORE_ORDER.filter(s => storeTotals[s])
  const compareTotal = includeDelivery ? bestSingleTotalWithFee : bestSingleTotal

  return { groups, plan, storeTotals, optimalTotal, optimalTotalWithFees, planFees, bestSingleStore, bestSingleTotal, compareTotal, sortedPlanEntries, sortedStores }
}

export default function GroceryList({ items, stores, onRemove, onClear }) {
  const { t } = useLang()
  const [showAll, setShowAll] = useState(false)
  const [tab, setTab] = useState('items')
  const [includeDelivery, setIncludeDelivery] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!items || items.length === 0) return null

  const { groups, plan, storeTotals, optimalTotal, optimalTotalWithFees, planFees, bestSingleStore, bestSingleTotal, compareTotal, sortedPlanEntries, sortedStores } = buildData(items, includeDelivery, stores)

  const groupValues = Object.values(groups)
  const visible = showAll ? groupValues : groupValues.slice(0, 10)
  const hasMore = groupValues.length > 10

  const buildShareText = () => {
    const lines = ['🛒 CeylonCart Shopping Plan', '─────────────────']
    for (const [store, storeItems] of sortedPlanEntries) {
      lines.push(`📍 ${STORE_NAMES[store]}`)
      for (const i of storeItems) lines.push(`   • ${i.name} — ${i.product.priceFormatted}`)
    }
    lines.push('─────────────────')
    if (includeDelivery) {
      lines.push(`💰 Total (incl. delivery): ${fmtPrice(optimalTotalWithFees)}`)
    } else {
      lines.push(`💰 Total: ${fmtPrice(optimalTotal)}`)
    }
    if (bestSingleStore) {
      const save = includeDelivery ? (compareTotal - optimalTotalWithFees) : (bestSingleTotal - optimalTotal)
      lines.push(`✅ Save ${fmtPrice(save)} vs buying all at ${STORE_NAMES[bestSingleStore]}`)
    }
    if (includeDelivery && planFees > 0) lines.push(`🚚 Delivery fees: ${fmtPrice(planFees)}`)
    lines.push('', 'Sent via CeylonCart')
    return lines.join('\n')
  }

  const whatsappText = encodeURIComponent(buildShareText())

  const copyText = useCallback(() => {
    navigator.clipboard.writeText(buildShareText()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }, [items, includeDelivery])

  const saveAmount = bestSingleStore
    ? (includeDelivery ? (compareTotal - optimalTotalWithFees) : (bestSingleTotal - optimalTotal))
    : 0

  const planCompareTotal = includeDelivery ? optimalTotalWithFees : optimalTotal

  return (
    <motion.section
      id="grocery-list"
      className="grocery-list-section"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="section-label">
        <span className="label-line" />
        <h2 className="label-text">{t('grocery.title', { count: items.length })}</h2>
        <span className="label-line" />
      </div>

      <div className="gl-tabs">
        <button className={`gl-tab ${tab === 'items' ? 'active' : ''}`} onClick={() => setTab('items')}>{t('grocery.allItems')}</button>
        <button className={`gl-tab ${tab === 'plan' ? 'active' : ''}`} onClick={() => setTab('plan')}>{t('grocery.shoppingPlan')}</button>
      </div>

      {/* Delivery toggle */}
      <div className="gl-delivery-toggle">
        <label className="gl-toggle-label">
          <input
            type="checkbox"
            checked={includeDelivery}
            onChange={() => setIncludeDelivery(!includeDelivery)}
          />
          <span>{t('grocery.includeDelivery')}</span>
        </label>
      </div>

      {tab === 'items' && (
        <>
          {sortedStores.length > 0 && (
            <div className="gl-store-totals">
              {sortedStores.map(s => {
                const st = storeTotals[s]
                const displayTotal = includeDelivery ? st.totalWithFee : st.total
                return (
                  <div key={s} className={`gl-store-total ${s === bestSingleStore ? 'gl-best' : ''}`}>
                    <span className="gl-store-name" style={{ color: STORE_COLORS[s] }}>
                      {s === bestSingleStore ? '🏆 ' : ''}{STORE_NAMES[s]}
                    </span>
                    <span className="gl-store-total-price">{fmtPrice(displayTotal)}</span>
                    <span className="gl-store-count">{st.count} {t('grocery.items')}</span>
                    {includeDelivery && st.fee > 0 && (
                      <span className="gl-store-fee">+{fmtPrice(st.fee)} {t('grocery.delivery')}</span>
                    )}
                    {includeDelivery && st.fee === 0 && st.total > 0 && (
                      <span className="gl-store-fee gl-free-delivery">{t('grocery.freeDelivery')}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="gl-items">
            {visible.map((g, i) => {
              const storeList = STORE_ORDER.filter(s => g.products[s]).sort((a, b) => g.products[a].price - g.products[b].price)
              const bestPrice = storeList.length > 0 ? g.products[storeList[0]].price : null
              return (
                <motion.div
                  key={g.key}
                  className="gl-item"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: i * 0.03 }}
                >
                  <div className="gl-item-name">{g.name}</div>
                  <div className="gl-item-prices">
                    {storeList.map(s => (
                      <span
                        key={s}
                        className={`gl-price-tag ${g.products[s].price === bestPrice ? 'gl-best-price' : ''}`}
                        style={{ '--store-color': STORE_COLORS[s] }}
                      >
                        <span className="gl-price-store">{STORE_NAMES[s]}</span>
                        <span className="gl-price-value">{g.products[s].priceFormatted}</span>
                      </span>
                    ))}
                  </div>
                  <button
                    className="gl-remove-btn"
                    onClick={() => { const first = Object.values(g.products)[0]; onRemove(first.id || first.originalId) }}
                    aria-label={t('grocery.remove', { name: g.name })}
                  >✕</button>
                </motion.div>
              )
            })}
          </div>

          {hasMore && (
            <button className="gl-toggle-btn" onClick={() => setShowAll(!showAll)}>
              {showAll ? t('grocery.showLess') : t('grocery.showAll', { count: groupValues.length })}
            </button>
          )}
        </>
      )}

      {tab === 'plan' && (
        <>
          <div className="gl-plan-summary">
            <div className="gl-plan-optimal">
              <span className="gl-plan-label">
                {includeDelivery ? t('grocery.optimalTotalDelivery') : t('grocery.optimalTotal')}
              </span>
              <span className="gl-plan-value">{fmtPrice(planCompareTotal)}</span>
              {includeDelivery && planFees > 0 && (
                <span className="gl-plan-fee-note">{t('grocery.includesDelivery', { amount: fmtPrice(planFees) })}</span>
              )}
            </div>
            {sortedStores.length > 1 && bestSingleStore && saveAmount > 0 && (
              <div className="gl-plan-save">
                <span className="gl-plan-label">
                  {t('grocery.save', { store: STORE_NAMES[bestSingleStore] })}
                </span>
                <span className="gl-plan-value gl-plan-save-value">-{fmtPrice(saveAmount)}</span>
              </div>
            )}
          </div>

          <div className="gl-plan-stores">
            {sortedPlanEntries.map(([store, storeItems]) => {
              const storeItemTotal = storeItems.reduce((s, i) => s + i.product.price, 0)
              const fee = includeDelivery ? getDeliveryFee(store, storeItemTotal, stores) : 0
              const displayTotal = storeItemTotal + fee
              return (
                <motion.div
                  key={store}
                  className="gl-plan-store"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35 }}
                >
                  <div className="gl-plan-store-header" style={{ borderLeftColor: STORE_COLORS[store] }}>
                    <div>
                      <span className="gl-plan-store-name" style={{ color: STORE_COLORS[store] }}>{STORE_NAMES[store]}</span>
                      {fee > 0 && <span className="gl-plan-store-fee">+{fmtPrice(fee)} {t('grocery.delivery')}</span>}
                      {fee === 0 && includeDelivery && <span className="gl-plan-store-fee gl-free-delivery">{t('grocery.freeDelivery')}</span>}
                    </div>
                    <span className="gl-plan-store-total">{fmtPrice(displayTotal)}</span>
                  </div>
                  <div className="gl-plan-items">
                    {storeItems.map((item, j) => (
                      <div key={j} className="gl-plan-item">
                        <span className="gl-plan-item-name">{item.name}</span>
                        <span className="gl-plan-item-price">{item.product.priceFormatted}</span>
                      </div>
                    ))}
                  </div>
                  <a
                    className="gl-plan-order"
                    href={storeItems[0].product.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('grocery.shopAt', { store: STORE_NAMES[store] })}
                  </a>
                </motion.div>
              )
            })}
          </div>
        </>
      )}

      <div className="gl-actions">
        <button className="gl-copy-btn" onClick={copyText}>
          {copied ? t('grocery.copied') : t('grocery.copyText')}
        </button>
        <a
          className="gl-share-btn"
          href={`https://wa.me/?text=${whatsappText}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('grocery.shareWhatsApp')}
        >
          {t('grocery.shareWhatsApp')}
        </a>
        <button className="gl-clear-btn" onClick={onClear}>
          {t('grocery.clearList')}
        </button>
      </div>
    </motion.section>
  )
}
