import { useState } from 'react'
import { motion } from 'framer-motion'

export default function SearchBar({ onSearch, loading }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('relevance')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!query.trim()) return
    const filters = {}
    if (sort !== 'relevance') filters.sort = sort
    onSearch(query.trim(), filters)
  }

  return (
    <motion.form
      className="search-bar-wrapper"
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="search-input-group">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search products... e.g. Nespray, rice, sugar..."
          autoFocus
        />
        <button type="submit" className="search-btn" disabled={loading || !query.trim()}>
          {loading ? '⟳' : '→'}
        </button>
      </div>

      <div className="search-filters">
        <button
          type="button"
          className="filter-chip"
          style={sort === 'relevance' ? { borderColor: 'var(--accent)', color: 'var(--text)' } : {}}
          onClick={() => setSort('relevance')}
        >
          Relevance
        </button>
        <button
          type="button"
          className="filter-chip"
          style={sort === 'price_asc' ? { borderColor: 'var(--accent)', color: 'var(--text)' } : {}}
          onClick={() => setSort('price_asc')}
        >
          Price: Low → High
        </button>
        <button
          type="button"
          className="filter-chip"
          style={sort === 'price_desc' ? { borderColor: 'var(--accent)', color: 'var(--text)' } : {}}
          onClick={() => setSort('price_desc')}
        >
          Price: High → Low
        </button>
        <button
          type="button"
          className="filter-chip"
          style={sort === 'bestseller' ? { borderColor: 'var(--accent)', color: 'var(--text)' } : {}}
          onClick={() => setSort('bestseller')}
        >
          Best Sellers
        </button>
      </div>
    </motion.form>
  )
}
