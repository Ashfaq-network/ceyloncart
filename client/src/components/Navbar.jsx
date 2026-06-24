import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang } from '../i18n'

export default function Navbar({ categories = [], onCategorySelect = () => {}, groceryCount = 0 }) {
  const { t, lang, toggleLang } = useLang()
  const [showCat, setShowCat] = useState(false)
  const catRef = useRef(null)

  useEffect(() => {
    const onClick = (e) => {
      if (catRef.current && !catRef.current.contains(e.target)) setShowCat(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setShowCat(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const GROCERY_PARENTS = new Set(['Grocery', 'Fruits', 'Vegetables', 'Beverages', 'Chocolates', 'Snacks', 'BabyItems', 'Household'])
  const mainCats = categories.filter(c => c.children?.length > 0 && GROCERY_PARENTS.has(c.name)).slice(0, 12)

  return (
    <motion.nav
      className="navbar"
      initial={{ y: -80 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <a href="/" className="nav-logo">
        <span className="logo-c">G</span><span className="logo-ey">rocery</span><span className="logo-cart">LK</span>
        <span className="sub">Compare & Save</span>
      </a>

      <div className="nav-links" role="navigation" aria-label="Main navigation">
        <button className="nav-link" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>{t('about.home')}</button>

        <div className="cat-dropdown" ref={catRef}>
          <button className="nav-link" onClick={() => setShowCat(!showCat)} aria-expanded={showCat} aria-label={t('category.browse')}>
            {lang === 'si' ? 'ප්‍රවර්ග' : 'Categories'} {showCat ? '▲' : '▼'}
          </button>
          <AnimatePresence>
            {showCat && (
              <motion.div
                className="cat-menu-mega"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
              >
                {mainCats.map((cat) => (
                  <div key={cat.name} className="mega-col">
                    <button
                      className="mega-cat-title"
                      onClick={() => { onCategorySelect(cat.name); setShowCat(false) }}
                    >
                      {cat.name} →
                    </button>
                    {(cat.children || []).slice(0, 8).map((sub) => (
                      <button
                        key={sub.name}
                        className="mega-sub-item"
                        onClick={() => { onCategorySelect(sub.name); setShowCat(false) }}
                      >
                        {sub.name}
                      </button>
                    ))}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <a className="nav-link" href="#grocery-list" aria-label={`${t('nav.groceryList')} — ${groceryCount || 0} items`}>
          🛒 {t('nav.groceryList')}{groceryCount > 0 && <span className="nav-badge">{groceryCount}</span>}
        </a>
        <a className="nav-link" href="#about">{t('nav.about')}</a>
        <button className="nav-link lang-switch" onClick={toggleLang} aria-label={`Switch to ${lang === 'en' ? 'Sinhala' : 'English'}`}>
          {lang === 'en' ? 'සිංහල' : 'English'}
        </button>
      </div>
    </motion.nav>
  )
}
