import { motion } from 'framer-motion'
import { useLang } from '../i18n'

const STORES = [
  { name: 'Kapruka', color: '#e53935' },
  { name: 'Global Food City', color: '#1565c0' },
  { name: 'SPAR', color: '#f9a825' },
  { name: 'Keells', color: '#2e7d32' },
  { name: 'Cargills', color: '#ff8f00' },
]

export default function Hero({ onSearch = () => {} }) {
  const { t, lang } = useLang()
  const handleSubmit = (e) => {
    e.preventDefault()
    const val = e.target.elements.q?.value?.trim()
    if (val) onSearch(val)
  }

  return (
    <section className="hero-compact">
      <div className="hero-compact-content">
        <div className="hero-compact-top">
          <div className="hero-logo-icon">🛒</div>
          <h1 className="hero-compact-title">
            <span className="logo-c">G</span><span className="logo-ey">rocery</span><span className="logo-cart">LK</span>
          </h1>
          <p className="hero-compact-sub">
            {t('hero.subtitle')}
          </p>
        </div>

        <motion.form
          className="search-bar-wrapper"
          onSubmit={handleSubmit}
          whileHover={{ scale: 1.01 }}
          transition={{ type: 'spring', stiffness: 300 }}
          role="search"
          aria-label="Search products"
        >
          <div className="search-input-group">
            <input
              name="q"
              placeholder={t('hero.searchPlaceholder')}
              autoComplete="off"
              aria-label={t('hero.searchPlaceholder')}
            />
            <button type="submit" className="search-btn" aria-label="Search">{lang === 'si' ? 'සොයන්න' : 'Search'}</button>
          </div>
        </motion.form>

        <div className="hero-compact-stores">
          {STORES.map(s => (
            <span
              key={s.name}
              className="hero-store-badge"
              style={{ background: s.color }}
            >
              {s.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
