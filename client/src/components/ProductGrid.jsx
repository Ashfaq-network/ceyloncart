import { useState } from 'react'
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

const WA_ICON = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:14px;height:14px;vertical-align:middle"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" fill="currentColor"/></svg>`

function WaIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: size, height: size, verticalAlign: 'middle' }}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" fill="currentColor"/>
    </svg>
  )
}

function shareProduct(product) {
  const text = `🛒 ${product.name}\n🏪 ${product.storeName}: ${product.priceFormatted}\n\nCheck prices across 6 stores → https://grocerylk.vercel.app/?q=${encodeURIComponent(product.name.split(' - ')[0] || product.name)}`
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
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
          <button className="product-share-btn" onClick={() => shareProduct(product)} aria-label="Share on WhatsApp"><WaIcon size={14} /></button>
        </motion.div>
      ))}
    </div>
  )
}
