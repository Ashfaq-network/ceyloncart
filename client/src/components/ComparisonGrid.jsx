import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useLang } from '../i18n'
import { track } from '../analytics'

function WaIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: size, height: size, verticalAlign: 'middle' }}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" fill="currentColor"/>
    </svg>
  )
}

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

function shareProduct(product) {
  const text = `🛒 ${product.name}\n🏪 ${product.storeName}: ${product.priceFormatted}\n\nCheck prices across 6 stores → https://grocerylk.vercel.app/?q=${encodeURIComponent((product.name || '').split(' - ')[0] || product.name)}`
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
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
      <button className="store-cell-share" onClick={() => shareProduct(product)} aria-label="Share on WhatsApp"><WaIcon size={13} /></button>
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

function ShareButton({ groups, singles, query }) {
  const { t } = useLang()
  const [copied, setCopied] = useState(false)
  const buildText = () => {
    const lines = [`🛒 GroceryLK — Price Comparison`, `─────────────────`]
    if (query) lines.push(`🔍 "${query}"`)
    lines.push('')
    if (groups.length > 0) {
      for (const g of groups.slice(0, 5)) {
        const sorted = [...g].sort((a, b) => a.price - b.price)
        lines.push(`🏆 ${sorted[0].name}`)
        for (const p of sorted) {
          const mark = p.price === sorted[0].price ? '✅' : '  '
          lines.push(` ${mark} ${p.storeName}: ${p.priceFormatted}`)
        }
        lines.push('')
      }
      if (groups.length > 5) lines.push(`... +${groups.length - 5} more items`)
    }
    if (singles.length > 0) lines.push(`📦 ${singles.length} more products from other stores`)
    lines.push('', `Sent via GroceryLK`, `https://grocerylk.vercel.app/`)
    return lines.join('\n')
  }
  const handleWhatsApp = () => {
    track('share', { method: 'whatsapp', hasQuery: !!query })
    window.open(`https://wa.me/?text=${encodeURIComponent(buildText())}`, '_blank')
  }
  const handleCopy = () => {
    navigator.clipboard.writeText(buildText()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
    track('share', { method: 'copy', hasQuery: !!query })
  }
  return (
    <div className="share-buttons">
      <button className="share-btn whatsapp" onClick={handleWhatsApp} aria-label={t('grocery.shareWhatsApp')}>
        <WaIcon size={16} /> {t('grocery.shareWhatsApp')}
      </button>
      <button className="share-btn copy" onClick={handleCopy} aria-label="Copy text">
        {copied ? '✓ Copied!' : '📋 Copy Text'}
      </button>
    </div>
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
          <ShareButton groups={groups} singles={singles} query="" />
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
                  <button className="product-share-btn" onClick={() => shareProduct(product)} aria-label="Share on WhatsApp"><WaIcon size={14} /></button>
                </div>
              </motion.div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
