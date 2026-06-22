import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const en = {
  langName: 'English',
  appName: 'CeylonCart',
  nav: {
    groceryList: 'Grocery List',
    about: 'About',
    searchPlaceholder: 'Search groceries across stores...',
  },
  hero: {
    title: 'Find the Best Prices',
    subtitle: 'Compare grocery prices across Sri Lanka\'s top stores',
    searchPlaceholder: 'Search groceries across stores...',
  },
  home: {
    browseAll: 'Browse All Groceries \u2192',
    featured: 'Featured Products',
    newAdditions: 'New Additions',
    bestSellers: 'Best Sellers',
    suggestions: 'Your Suggestions',
    loading: 'Loading popular products...',
    searchLoading: 'Searching best prices...',
    tryAgain: 'Try Again',
  },
  sort: {
    label: 'Sort:',
    relevance: 'Relevance',
    priceAsc: 'Price \u2191',
    priceDesc: 'Price \u2193',
  },
  results: {
    ofResults: '{count} of {total} results for "{query}"',
    resultsFor: '{total} results for "{query}"',
    resultsForSimple: 'Results for "{query}"',
    noneFound: 'No products found',
    noneInStores: 'No {query} results in the selected stores. Try enabling more stores or a different search.',
    noneAtAll: 'No results for "{query}". Try a different search term.',
    trySearching: 'Try searching:',
  },
  error: {
    title: 'Something went wrong',
  },
  store: {
    toggle: 'Toggle {name} store',
  },
  grocery: {
    title: 'Your Grocery List ({count})',
    allItems: 'All Items',
    shoppingPlan: 'Shopping Plan \u{1F3C6}',
    includeDelivery: 'Include delivery fees',
    items: 'items',
    delivery: 'delivery',
    freeDelivery: 'Free delivery',
    optimalTotal: 'Optimal Total',
    optimalTotalDelivery: 'Optimal Total (incl. delivery)',
    save: 'Save vs buying all at {store}',
    includesDelivery: 'Includes {amount} delivery fees',
    shopAt: 'Shop at {store} \u2192',
    copyText: '\uD83D\uDCCB Copy Text',
    shareWhatsApp: 'Share on WhatsApp',
    clearList: 'Clear List',
    copied: '\u2713 Copied!',
    showAll: 'Show All ({count}) \u25BC',
    showLess: 'Show Less \u25B2',
    remove: 'Remove {name}',
  },
  product: {
    inStock: 'In Stock',
    outOfStock: 'Out of Stock',
    orderNow: 'Order Now \u2192',
    unavailable: 'Unavailable',
    addToList: '+ Add',
    best: 'Best',
    view: 'View',
    nA: 'N/A',
    availableAt: 'Available at {count} store(s)',
    priceComparison: 'Price Comparison',
    otherResults: 'Other Results',
    priceUp: '\u2191 Price Up',
    priceDown: '\u2193 Price Down',
    priceStable: '\u2192 Stable',
  },
  about: {
    title: 'About CeylonCart',
    description: 'CeylonCart compares grocery prices across Sri Lanka\'s top stores \u2014 Kapruka, Keells, Cargills, Global Food City, and SPAR \u2014 so you always find the best deal.',
    stores: 'Stores',
    products: 'Products',
    realTime: 'Real-Time',
    home: 'Home',
    about: 'About',
    copyright: '\u00a9 {year} CeylonCart. All rights reserved.',
  },
  order: {
    title: 'Order Item',
    openStore: 'Visit {store} \u2192',
    cancel: 'Cancel',
  },
  category: {
    browse: 'Browse categories',
  },
}

const si = {
  langName: 'සිංහල',
  appName: 'සෙයිලන්කාර්ට්',
  nav: {
    groceryList: 'සාප්පු ලැයිස්තුව',
    about: 'අපි ගැන',
    searchPlaceholder: 'වෙළඳසැල් හරහා සාප්පු සොයන්න...',
  },
  hero: {
    title: 'හොඳම මිල ගණන් සොයන්න',
    subtitle: 'ශ්‍රී ලංකාවේ ප්‍රමුඛ වෙළඳසැල්වල සාප්පු මිල ගණන් සසඳන්න',
    searchPlaceholder: 'වෙළඳසැල් හරහා සාප්පු සොයන්න...',
  },
  home: {
    browseAll: 'සියලුම සාප්පු බලන්න \u2192',
    featured: 'විශේෂාංග නිෂ්පාදන',
    newAdditions: 'අලුත් ආකලන',
    bestSellers: 'වැඩියෙන්ම අලෙවි වන',
    suggestions: 'ඔබේ යෝජනා',
    loading: 'ජනප්‍රිය නිෂ්පාදන පූරණය වේ...',
    searchLoading: 'හොඳම මිල ගණන් සොයයි...',
    tryAgain: 'නැවත උත්සාහ කරන්න',
  },
  sort: {
    label: 'පිළිවෙළ:',
    relevance: 'අදාළත්වය',
    priceAsc: 'මිල \u2191',
    priceDesc: 'මිල \u2193',
  },
  results: {
    ofResults: '"{query}" සඳහා ප්‍රතිඵල {total} න් {count} ක්',
    resultsFor: '"{query}" සඳහා ප්‍රතිඵල {total} ක්',
    resultsForSimple: '"{query}" සඳහා ප්‍රතිඵල',
    noneFound: 'නිෂ්පාදන හමු නොවීය',
    noneInStores: 'තෝරාගත් වෙළඳසැල්වල {query} සඳහා ප්‍රතිඵල නැත. තවත් වෙළඳසැල් සක්‍රීය කරන්න හෝ වෙනත් සෙවුමක් උත්සාහ කරන්න.',
    noneAtAll: '"{query}" සඳහා ප්‍රතිඵල නැත. වෙනත් සෙවුමක් උත්සාහ කරන්න.',
    trySearching: 'සොයන්න:',
  },
  error: {
    title: 'දෝෂයක් ඇති විය',
  },
  store: {
    toggle: '{name} වෙළඳසැල මාරු කරන්න',
  },
  grocery: {
    title: 'ඔබේ සාප්පු ලැයිස්තුව ({count})',
    allItems: 'සියලුම අයිතම',
    shoppingPlan: 'සාප්පු සැලැස්ම \u{1F3C6}',
    includeDelivery: 'බෙදාහැරීමේ ගාස්තු ඇතුළත් කරන්න',
    items: 'අයිතම',
    delivery: 'බෙදාහැරීමේ',
    freeDelivery: 'නොමිලේ බෙදාහැරීම',
    optimalTotal: 'ප්‍රශස්ත එකතුව',
    optimalTotalDelivery: 'ප්‍රශස්ත එකතුව (බෙදාහැරීම ඇතුළුව)',
    save: '{store} හි සියල්ල මිලදී ගැනීමට සාපේක්ෂව ඉතිරි කරන්න',
    includesDelivery: 'බෙදාහැරීමේ ගාස්තු {amount} ඇතුළත් වේ',
    shopAt: '{store} හි සාප්පු යන්න \u2192',
    copyText: '\uD83D\uDCCB පිටපතක් ගන්න',
    shareWhatsApp: 'WhatsApp හි බෙදාගන්න',
    clearList: 'ලැයිස්තුව හිස් කරන්න',
    copied: '\u2713 පිටපත් කළා!',
    showAll: 'සියල්ල පෙන්වන්න ({count}) \u25BC',
    showLess: 'අඩුවෙන් පෙන්වන්න \u25B2',
    remove: '{name} ඉවත් කරන්න',
  },
  product: {
    inStock: 'තොගයේ',
    outOfStock: 'නැත',
    orderNow: 'ඇණවුම් කරන්න \u2192',
    unavailable: 'නොමැත',
    addToList: '+ එකතු කරන්න',
    best: 'හොඳම',
    view: 'බලන්න',
    nA: 'N/A',
    availableAt: 'වෙළඳසැල් {count} ක ඇත',
    priceComparison: 'මිල සංසන්දනය',
    otherResults: 'වෙනත් ප්‍රතිඵල',
    priceUp: '\u2191 මිල ඉහළට',
    priceDown: '\u2193 මිල පහළට',
    priceStable: '\u2192 ස්ථාවර',
  },
  about: {
    title: 'සෙයිලන්කාර්ට් ගැන',
    description: 'සෙයිලන්කාර්ට් ශ්‍රී ලංකාවේ ප්‍රමුඛ වෙළඳසැල් \u2014 Kapruka, Keells, Cargills, Global Food City, සහ SPAR \u2014 හරහා සාප්පු මිල ගණන් සංසන්දනය කරයි, එවිට ඔබට සැමවිටම හොඳම මිල සොයාගත හැකිය.',
    stores: 'වෙළඳසැල්',
    products: 'නිෂ්පාදන',
    realTime: 'සැබෑ කාලය',
    home: 'මුල් පිටුව',
    about: 'අපි ගැන',
    copyright: '\u00a9 {year} සෙයිලන්කාර්ට්. සියලුම හිමිකම් ඇවිරිණි.',
  },
  order: {
    title: 'ඇණවුම් අයිතමය',
    openStore: '{store} වෙත පිවිසෙන්න \u2192',
    cancel: 'අවලංගු කරන්න',
  },
  category: {
    browse: 'ප්‍රවර්ග පිරික්සන්න',
  },
}

const translations = { en, si }

const LangContext = createContext()

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('ceyloncart_lang') || 'en' }
    catch { return 'en' }
  })

  useEffect(() => {
    try { localStorage.setItem('ceyloncart_lang', lang) }
    catch {}
  }, [lang])

  const toggleLang = useCallback(() => {
    setLang(prev => prev === 'en' ? 'si' : 'en')
  }, [])

  const t = useCallback((key, params = {}) => {
    const keys = key.split('.')
    let val = translations[lang]
    for (const k of keys) {
      if (val && typeof val === 'object' && k in val) val = val[k]
      else return key
    }
    if (typeof val !== 'string') return key
    return val.replace(/\{(\w+)\}/g, (_, p) => params[p] !== undefined ? params[p] : `{${p}}`)
  }, [lang])

  const tAttr = useCallback((key, params = {}) => {
    const keys = key.split('.')
    let val = translations[lang]
    for (const k of keys) {
      if (val && typeof val === 'object' && k in val) val = val[k]
      else return key
    }
    if (typeof val !== 'string') return key
    return val.replace(/\{(\w+)\}/g, (_, p) => params[p] !== undefined ? params[p] : `{${p}}`)
  }, [lang])

  return (
    <LangContext.Provider value={{ lang, setLang, toggleLang, t, tAttr }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang must be used within LangProvider')
  return ctx
}
