import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useLang } from '../i18n'

const STORE_COLORS = {
  kapruka: '#e53935',
  gfc: '#1565c0',
  spar: '#f9a825',

  cargills: '#ff8f00',
  glomark: '#7b1fa2',
  arpico: '#0b2545',
}

function ProductImage({ product, className = 'comp-img', fallbackClass = 'comp-img-fallback' }) {
  const [failed, setFailed] = useState(false)
  const imgSrc = product.image || `/api/product-image/${product.store}/${product.originalId}?url=${encodeURIComponent(product.url)}`

  if (failed) {
    return <div className={`${className} ${fallbackClass}`}>🛒</div>
  }

  return (
    <img
      src={imgSrc}
      alt={product.name}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

function StoreCell({ product, isBest, onOrder, onAddToList }) {
  const { t } = useLang()
  const color = STORE_COLORS[product.store] || '#555'
  return (
    <div className={`store-cell ${isBest ? 'best' : ''}`}>
      <span className="store-cell-badge" style={{ background: color }}>
        {product.storeName}
      </span>
      <ProductImage product={product} />
      <span className="store-cell-price">{product.priceFormatted}</span>
      {isBest && <span className="store-cell-best">{t('product.best')}</span>}
      <button
        className="store-cell-btn"
        onClick={() => onOrder(product)}
        disabled={!product.inStock}
      >
        {product.inStock ? t('product.view') : t('product.nA')}
      </button>
      <button
        className="store-cell-add"
        onClick={() => onAddToList(product)}
        aria-label={`${t('product.addToList')} ${product.name}`}
      >
        {t('product.addToList')}
      </button>
    </div>
  )
}

function usePriceTrend(product) {
  const [trend, setTrend] = useState(null)

  useEffect(() => {
    if (!product) return
    const key = `${product.store}:${product.originalId || product.id}`
    fetch(`/api/price-history?product_key=${encodeURIComponent(key)}&days=14`)
      .then(r => r.json())
      .then(data => {
        const h = data?.history
        if (!h || h.length < 2) { setTrend('flat'); return }
        const first = h[0].price
        const last = h[h.length - 1].price
        const diff = last - first
        if (Math.abs(diff) < 0.01) setTrend('flat')
        else setTrend(diff > 0 ? 'up' : 'down')
      })
      .catch(() => setTrend('flat'))
  }, [product])

  return trend
}

function PriceTrendBadge({ product }) {
  const { t } = useLang()
  const trend = usePriceTrend(product)
  if (!trend) return null

  const labels = { up: t('product.priceUp'), down: t('product.priceDown'), flat: t('product.priceStable') }
  return <span className={`price-trend ${trend}`} aria-label={labels[trend]}>{labels[trend]}</span>
}

function ComparisonGroup({ group, index, onOrder, onAddToList }) {
  const { t } = useLang()
  if (!group || group.length === 0) return null
  const sorted = [...group].sort((a, b) => a.price - b.price)
  const bestPrice = sorted[0].price
  const product = sorted[0]

  return (
    <motion.div
      className="comparison-group"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04 }}
    >
      <div className="comparison-group-header">
        <ProductImage product={product} />
        <div className="comparison-group-info">
          <div className="comparison-group-name">{product.name}</div>
          <div className="comparison-group-meta">
            {t('product.availableAt', { count: group.length })}
          </div>
        </div>
        <div className="comparison-group-best">
          <span className="best-label">{t('product.best')}</span>
          <span className="best-price">{sorted[0].priceFormatted}</span>
          <PriceTrendBadge product={sorted[0]} />
        </div>
      </div>
      <div className="comparison-group-stores">
        {sorted.map((p, i) => (
          <StoreCell key={p.id} product={p} isBest={p.price === bestPrice} onOrder={onOrder} onAddToList={onAddToList} />
        ))}
      </div>
    </motion.div>
  )
}

export default function ComparisonGrid({ results = [], matched = [], onOrder = () => {}, onAddToList = () => {} }) {
  const { t } = useLang()
  const matchedIds = new Set()
  const groups = (matched || []).filter(g => {
    const hasMatch = g.length > 1
    if (hasMatch) g.forEach(p => matchedIds.add(p.id))
    return hasMatch
  })

  const singles = (results || []).filter(p => !matchedIds.has(p.id))

  if (!results || results.length === 0) {
    return null
  }

  return (
    <div>
      {groups.length > 0 && (
        <>
          <div className="section-label" style={{ marginBottom: 20 }}>
            <span className="label-line" />
            <h2 className="label-text">{t('product.priceComparison')}</h2>
            <span className="label-line" />
          </div>
          <div className="comparison-grid">
            {groups.map((group, i) => (
              <ComparisonGroup key={i} group={group} index={i} onOrder={onOrder} onAddToList={onAddToList} />
            ))}
          </div>
        </>
      )}

      {singles.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 40, marginBottom: 20 }}>
            <span className="label-line" />
            <h2 className="label-text">{t('product.otherResults')}</h2>
            <span className="label-line" />
          </div>
          <div className="product-grid">
            {singles.map((product, i) => (
              <motion.div
                key={product.id || i}
                className="product-card"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.02 }}
                whileHover={{ y: -4 }}
              >
                <div className="product-card-top">
                  <span
                    className="store-badge"
                    style={{ background: STORE_COLORS[product.store] || '#555' }}
                  >
                    {product.storeName}
                  </span>
                </div>
                <ProductImage product={product} className="product-img" fallbackClass="product-img-fallback" />
                <div className="product-name">{product.name}</div>
                <div className="product-meta">
                  <span className="product-price">{product.priceFormatted}</span>
                  <span className={`product-stock ${product.inStock ? 'in-stock' : 'out-of-stock'}`}>
                    {product.inStock ? t('product.inStock') : t('product.outOfStock')}
                  </span>
                </div>
                <div className="product-actions">
                  <button
                    className="order-btn"
                    onClick={() => onOrder(product)}
                    disabled={!product.inStock}
                    aria-label={`${t('product.view')} ${product.name}`}
                  >
                    {product.inStock ? t('product.orderNow') : t('product.unavailable')}
                  </button>
                  <button
                    className="add-list-btn"
                    onClick={() => onAddToList(product)}
                    aria-label={`${t('product.addToList')} ${product.name}`}
                  >
                    {t('product.addToList')}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
