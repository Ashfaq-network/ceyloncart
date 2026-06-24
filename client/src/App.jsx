import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang } from './i18n'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import ComparisonGrid from './components/ComparisonGrid'
import ProductGrid from './components/ProductGrid'
import CategoryBrowser from './components/CategoryBrowser'
import OrderModal from './components/OrderModal'
import GroceryList from './components/GroceryList'
import Footer from './components/Footer'
import { track } from './analytics'
import './App.css'

const STORE_COLORS = {
  kapruka: '#e53935',
  gfc: '#1565c0',
  spar: '#f9a825',

  cargills: '#ff8f00',
  arpico: '#0b2545',
}

export default function App() {
  const { t } = useLang()
  const [featuredProducts, setFeaturedProducts] = useState([])
  const [newProducts, setNewProducts] = useState([])
  const [bestsellerProducts, setBestsellerProducts] = useState([])
  const [suggestedProducts, setSuggestedProducts] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [categories, setCategories] = useState([])
  const [stores, setStores] = useState([])
  const [activeStores, setActiveStores] = useState([])
  const [sortBy, setSortBy] = useState('')
  const [error, setError] = useState('')
  const [rawData, setRawData] = useState(null)
  const [showBackTop, setShowBackTop] = useState(false)
  const [groceryList, setGroceryList] = useState(() => {
    try { return JSON.parse(localStorage.getItem('groceryList') || '[]') }
    catch { return [] }
  })
  const resultsRef = useRef(null)
  const searchRef = useRef(null)

  useEffect(() => {
    track('visit')
    const onScroll = () => setShowBackTop(window.scrollY > 600)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    fetch('/api/categories?depth=2')
      .then(r => r.json())
      .then(d => setCategories(d.categories || []))
      .catch(() => {})
    fetch('/api/stores')
      .then(r => r.json())
      .then(d => {
        setStores(d.stores || [])
        setActiveStores((d.stores || []).map(s => s.id))
      })
      .catch(() => {})
    const queries = {
      featured: ['rice', 'dhal', 'coconut', 'milk', 'eggs', 'tea', 'bread', 'sugar'],
      new: ['snacks', 'noodles', 'chocolate', 'drinks', 'biscuits', 'oil', 'soap', 'shampoo'],
      bestsellers: ['dilmah', 'nestle', 'unilever', 'maggi', 'prima', 'elephant house'],
      suggested: ['fruits', 'vegetables', 'chicken', 'fish', 'yogurt', 'cheese', 'butter', 'juice'],
    }
    const setters = {
      featured: setFeaturedProducts,
      new: setNewProducts,
      bestsellers: setBestsellerProducts,
      suggested: setSuggestedProducts,
    }
    for (const [section, qs] of Object.entries(queries)) {
      for (const q of qs) {
        fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`)
          .then(r => r.json())
          .then(d => {
            if (d.results) {
              setters[section](prev => {
                const combined = [...prev]
                for (const p of d.results) {
                  if (!combined.some(x => x.id === p.id) && combined.length < 20) {
                    combined.push(p)
                  }
                }
                return combined
              })
            }
          })
          .catch(() => {})
      }
    }
  }, [])

  const handleSearch = async (query, filters = {}) => {
    setSearchQuery(query)
    setLoading(true)
    setError('')
    setSortBy('')
    setRawData(null)
    try {
      const { stores: filterStores, category, fast, ...rest } = filters
      const params = new URLSearchParams({ q: query, limit: '30', ...rest })
      if (category) params.set('category', category)
      if (fast) {
        params.set('fast', 'true')
      } else if (filterStores != null) {
        params.set('stores', filterStores)
      }
      // When no stores param is sent, server auto-selects based on health tracking
      const res = await fetch(`/api/search?${params}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setRawData(data)
      track('search', { query, resultCount: data.results?.length || 0 })
      setTimeout(() => searchRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (e) {
      setError(e.message)
      setRawData(null)
    }
    setLoading(false)
  }

  const toggleStore = (storeId) => {
    setActiveStores(prev =>
      prev.includes(storeId)
        ? prev.filter(s => s !== storeId)
        : [...prev, storeId]
    )
  }

  const activeResults = rawData && Array.isArray(rawData.results) ? rawData.results.filter(p => activeStores.includes(p.store)) : []
  const activeMatched = rawData && Array.isArray(rawData.matched) ? rawData.matched
    .filter(Array.isArray)
    .map(g => g.filter(p => activeStores.includes(p.store)))
    .filter(g => g.length > 0) : []
  const matchedIds = new Set(activeMatched.flat().map(p => p.id).filter(Boolean))
  const singlesCount = activeResults.filter(p => p.id && !matchedIds.has(p.id)).length
  const filteredCount = singlesCount + activeMatched.flat().length
  const hasActiveFilters = activeStores.length < stores.length

  const handleCategorySelect = (name) => {
    track('category_browse', { category: name })
    const filters = { category: name }
    if (activeStores.length < stores.length) {
      filters.stores = activeStores.join(',')
    }
    handleSearch(name, filters)
  }

  const handleSort = (sort) => {
    if (!rawData) return
    if (!Array.isArray(rawData.results)) return
    setSortBy(sort)

    if (sort === 'price_asc') {
      const sorted = [...rawData.results].sort((a, b) => (a.price || 0) - (b.price || 0))
      const matched = (rawData.matched || []).filter(Array.isArray).map(g =>
        [...g].sort((a, b) => (a.price || 0) - (b.price || 0))
      ).sort((a, b) => (a[0]?.price || 0) - (b[0]?.price || 0))
      setRawData({ ...rawData, results: sorted, matched })
    } else if (sort === 'price_desc') {
      const sorted = [...rawData.results].sort((a, b) => (b.price || 0) - (a.price || 0))
      const matched = (rawData.matched || []).filter(Array.isArray).map(g =>
        [...g].sort((a, b) => (b.price || 0) - (a.price || 0))
      ).sort((a, b) => (b[0]?.price || 0) - (a[0]?.price || 0))
      setRawData({ ...rawData, results: sorted, matched })
    } else {
      setRawData({ ...rawData, results: [...rawData.results], matched: [...(rawData.matched || [])] })
    }
  }

  const handleOrder = (product) => {
    setSelectedProduct(product)
    setShowOrderModal(true)
  }

  const addToGroceryList = (product) => {
    setGroceryList(prev => {
      const key = product.id ?? product.originalId
      if (prev.some(p => (p.id ?? p.originalId) === key)) return prev
      return [...prev, product]
    })
    track('add_to_list', { productName: product.name, store: product.store })
  }

  const removeFromGroceryList = (id) => {
    if (id == null) return
    setGroceryList(prev => prev.filter(p => (p.id ?? p.originalId) !== id))
  }

  const clearGroceryList = () => {
    setGroceryList([])
    try { localStorage.removeItem('groceryList') } catch {}
  }

  // Sync grocery list to localStorage whenever it changes
  useEffect(() => {
    try { localStorage.setItem('groceryList', JSON.stringify(groceryList)) } catch {}
  }, [groceryList])

  return (
    <>
    <Navbar categories={categories} onCategorySelect={handleCategorySelect} groceryCount={groceryList.length} />
    <Hero onSearch={handleSearch} />

    <section className="quick-categories" aria-label="Product categories">
      <div className="qck-cats-scroll">
        <CategoryBrowser categories={categories} onSelect={handleCategorySelect} />
      </div>
    </section>

    {!rawData && !loading && featuredProducts.length === 0 && newProducts.length === 0 && bestsellerProducts.length === 0 && suggestedProducts.length === 0 && (
      <div className="loading-container">
        <div className="skeleton-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton-card">
              <div className="skeleton-badge" />
              <div className="skeleton-img" />
              <div className="skeleton-line w-70" />
              <div className="skeleton-line w-40" />
              <div className="skeleton-btn" />
            </div>
          ))}
        </div>
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
          {t('home.loading')}
        </p>
      </div>
    )}

    {!rawData && featuredProducts.length > 0 && (
      <>
      <motion.section
        className="results-section"
        ref={resultsRef}
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.5 }}
      >
        <div className="section-label">
          <span className="label-line" />
          <h2 className="label-text">{t('home.featured')}</h2>
          <span className="label-line" />
        </div>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <button className="browse-all-btn" onClick={() => handleSearch('grocery', { fast: true, category: 'Grocery' })}>
            {t('home.browseAll')}
          </button>
        </div>
        <ProductGrid products={featuredProducts} onOrder={handleOrder} onAddToList={addToGroceryList} />
      </motion.section>

      <div className="section-divider" />

      {newProducts.length > 0 && (
        <motion.section
          className="results-section"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5 }}
        >
          <div className="section-label">
            <span className="label-line" />
            <h2 className="label-text">{t('home.newAdditions')}</h2>
            <span className="label-line" />
          </div>
          <ProductGrid products={newProducts} onOrder={handleOrder} onAddToList={addToGroceryList} />
        </motion.section>
      )}

      <div className="section-divider" />

      {bestsellerProducts.length > 0 && (
        <motion.section
          className="results-section"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5 }}
        >
          <div className="section-label">
            <span className="label-line" />
            <h2 className="label-text">{t('home.bestSellers')}</h2>
            <span className="label-line" />
          </div>
          <ProductGrid products={bestsellerProducts} onOrder={handleOrder} onAddToList={addToGroceryList} />
        </motion.section>
      )}

      <div className="section-divider" />

      {suggestedProducts.length > 0 && (
        <motion.section
          className="results-section"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5 }}
        >
          <div className="section-label">
            <span className="label-line" />
            <h2 className="label-text">{t('home.suggestions')}</h2>
            <span className="label-line" />
          </div>
          <ProductGrid products={suggestedProducts} onOrder={handleOrder} onAddToList={addToGroceryList} />
        </motion.section>
      )}
      </>
    )}

    <div ref={searchRef}>
      {loading && (
        <div className="loading-container">
          <div className="loader-ring" />
          <p>{t('home.searchLoading')}</p>
        </div>
      )}
      {error && !loading && (
        <div className="error-container">
          <div className="empty-icon">⚠️</div>
          <h3 className="empty-title">{t('error.title')}</h3>
          <p className="error-msg">{error}</p>
          <button
            className="browse-all-btn"
            style={{ marginTop: 16 }}
            onClick={() => handleSearch(searchQuery || 'grocery', { fast: true })}
          >
            {t('home.tryAgain')}
          </button>
        </div>
      )}
      {rawData && !loading && (
        <section className="results-section">
          <div className="section-label">
              <span className="label-line" />
              <h2 className="label-text">
                {rawData.total
                  ? hasActiveFilters
                    ? t('results.ofResults', { count: filteredCount, total: rawData.total, query: searchQuery })
                    : t('results.resultsFor', { total: rawData.total, query: searchQuery })
                  : t('results.resultsForSimple', { query: searchQuery })}
              </h2>
              <span className="label-line" />
            </div>

            {stores.length > 1 && (
              <div className="store-filters">
                {stores.map(s => (
                  <button
                    key={s.id}
                    className={`store-filter-btn ${activeStores.includes(s.id) ? 'active' : ''}`}
                    style={{
                      '--store-color': STORE_COLORS[s.id] || '#555',
                      borderColor: activeStores.includes(s.id) ? (STORE_COLORS[s.id] || '#555') : 'var(--border)',
                    }}
                    onClick={() => toggleStore(s.id)}
                    aria-pressed={activeStores.includes(s.id)}
                    aria-label={t('store.toggle', { name: s.name })}
                  >
                    {s.icon} {s.name}
                  </button>
                ))}
              </div>
            )}

            {filteredCount > 0 && (
              <div className="sort-bar">
                <span className="sort-label" id="sort-label">{t('sort.label')}</span>
                {['', 'price_asc', 'price_desc'].map(s => {
                  const labels = { '': t('sort.relevance'), price_asc: t('sort.priceAsc'), price_desc: t('sort.priceDesc') }
                  return (
                    <button
                      key={s}
                      className={`sort-btn ${sortBy === s ? 'active' : ''}`}
                      onClick={() => handleSort(s)}
                      aria-label={labels[s]}
                    >
                      {labels[s]}
                    </button>
                  )
                })}
              </div>
            )}

            {filteredCount > 0 ? (
              <ComparisonGrid results={activeResults} matched={activeMatched} onOrder={handleOrder} onAddToList={addToGroceryList} />
            ) : (
              <div className="empty-results">
                <div className="empty-icon">🔍</div>
                <h3 className="empty-title">{t('results.noneFound')}</h3>
                <p className="empty-desc">
                  {hasActiveFilters
                    ? t('results.noneInStores', { query: searchQuery ? `"${searchQuery}"` : '' })
                    : t('results.noneAtAll', { query: searchQuery })}
                </p>
                <div className="empty-suggestions">
                  <p className="empty-suggest-label">{t('results.trySearching')}</p>
                  <div className="empty-chips">
                    {['rice', 'milk', 'bread', 'eggs', 'sugar', 'tea'].map(term => (
                      <button
                        key={term}
                        className="empty-chip"
                        onClick={() => handleSearch(term, { fast: true })}
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
    </div>

    <GroceryList items={groceryList} stores={stores} onRemove={removeFromGroceryList} onClear={clearGroceryList} />

    <section className="about-section" id="about" aria-label={t('about.title')}>
      <div className="section-label">
        <span className="label-line" />
        <h2 className="label-text">{t('about.title')}</h2>
        <span className="label-line" />
      </div>
      <div className="about-content">
        <p>{t('about.description')}</p>
        <div className="about-stats">
          <div className="about-stat">
            <span className="about-stat-value">5</span>
            <span className="about-stat-label">{t('about.stores')}</span>
          </div>
          <div className="about-stat">
            <span className="about-stat-value">15,000+</span>
            <span className="about-stat-label">{t('about.products')}</span>
          </div>
          <div className="about-stat">
            <span className="about-stat-value">Real-Time</span>
            <span className="about-stat-label">{t('about.realTime')}</span>
          </div>
        </div>
      </div>
    </section>

    <Footer />

    <AnimatePresence>
      {showOrderModal && selectedProduct && (
        <OrderModal
          product={selectedProduct}
          onClose={() => { setShowOrderModal(false); setSelectedProduct(null) }}
        />
      )}
    </AnimatePresence>

    {showBackTop && (
      <motion.button
        className="back-top-btn"
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.5 }}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        aria-label="Back to top"
      >
        ↑
      </motion.button>
    )}
    </>
  )
}
