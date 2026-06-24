import { useState } from 'react'
import { motion } from 'framer-motion'
import { useLang } from '../i18n'

const STORE_COLORS = {
  kapruka: '#e53935',
  gfc: '#1565c0',
  spar: '#f9a825',
  keells: '#2e7d32',
  cargills: '#ff8f00',
  glomark: '#7b1fa2',
  arpico: '#0b2545',
}

function ProductImage({ product }) {
  const [failed, setFailed] = useState(false)
  const src = product.image || `/api/product-image/${product.store}/${product.originalId}?url=${encodeURIComponent(product.url)}`

  if (failed) {
    return (
      <div className="product-img product-img-fallback">
        <span>🛒</span>
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={product.name}
      className="product-img"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

export default function ProductGrid({ products = [], onOrder = () => {}, onAddToList = () => {} }) {
  const { t } = useLang()
  if (!products || products.length === 0) return null

  return (
    <div className="product-grid">
      {products.map((product, i) => (
        <motion.div
          key={product.id || i}
          className="product-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: i * 0.02 }}
          whileHover={{ y: -6 }}
        >
          <div className="product-card-top">
            <span
              className="store-badge"
              style={{ background: STORE_COLORS[product.store] || '#555' }}
            >
              {product.storeName}
            </span>
          </div>
          <ProductImage product={product} />
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
              aria-label={product.inStock ? `${t('product.orderNow')} ${product.name}` : `${product.name} ${t('product.unavailable')}`}
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
  )
}
