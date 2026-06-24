import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import { useLang } from '../i18n'

const CAT_ICONS = {
  'cake': '🎂', 'cakes': '🎂', 'bakers': '🥐', 'bakery': '🥐', 'bread': '🍞',
  'flowers': '💐', 'floral': '🌸',
  'chocolate': '🍫', 'chocolates': '🍫', 'candy': '🍬', 'sweets': '🍬',
  'fruit': '🍎', 'fruits': '🍎', 'fresh': '🥬', 'vegetable': '🥦', 'vegetables': '🥦',
  'rice': '🍚', 'dhal': '🫘', 'coconut': '🥥', 'spice': '🌶️', 'spices': '🌶️',
  'clothing': '👕', 'fashion': '👗', 'apparel': '🧥',
  'electronic': '🔌', 'electronics': '🔌', 'gadget': '📱', 'gadgets': '📱',
  'perfume': '🧴', 'perfumes': '🧴', 'beauty': '💄', 'cosmetic': '💄', 'cosmetics': '💄',
  'baby': '👶', 'babyitems': '👶', 'toy': '🧸', 'toys': '🧸', 'kids': '🧸',
  'kidstoys': '🧸', 'softtoy': '🧸', 'soft toy': '🧸',
  'book': '📚', 'books': '📚', 'stationery': '✏️', 'schoolpride': '✏️',
  'biscuit': '🍪', 'biscuits': '🍪', 'snack': '🍿', 'snacks': '🍿', 'noodles': '🍜',
  'drink': '🥤', 'drinks': '🥤', 'juice': '🧃', 'beverage': '☕', 'beverages': '☕',
  'milk': '🥛', 'dairy': '🧀', 'cheese': '🧀', 'yogurt': '🥛', 'curd': '🥣',
  'oil': '🫒', 'soap': '🧼', 'shampoo': '🧴', 'cleaner': '🧹', 'detergent': '🧺',
  'meat': '🥩', 'chicken': '🍗', 'fish': '🐟', 'seafood': '🦐',
  'egg': '🥚', 'eggs': '🥚',
  'medicine': '💊', 'pharmacy': '💊', 'health': '💪', 'ayurvedic': '🌿',
  'pet': '🐾', 'pet food': '🦴',
  'gift': '🎁', 'gifts': '🎁', 'giftset': '🎁', 'giftcert': '🎁', 'gift certificate': '🎁',
  'greetingcards': '💌', 'greeting card': '💌', 'greeting': '💌',
  'home': '🏠', 'household': '🏠', 'kitchen': '🍳', 'garden': '🌿',
  'automobile': '🚗', 'car': '🚗', 'bicycle': '🚲', 'bike': '🚲',
  'grocery': '🛒', 'food': '🍽️', 'foods': '🍽️',
  'jewellery': '💍', 'jewelry': '💍', 'ornament': '💍', 'ornaments': '💍',
  'liquor': '🍾', 'alcohol': '🍷',
  'sports': '⚽', 'sport': '⚽',
  'party': '🎉', 'event': '🎉', 'promotions': '🏷️', 'promotion': '🏷️',
  'children': '🧸', 'childrens': '🧸',
  'adult': '🔞', 'adult products': '🔞',
  'services': '🔧', 'service': '🔧',
  'combopack': '📦', 'combo': '📦',
  'pirikara': '🙏',
  'samedaydelivery': '⚡', 'same day': '⚡',
  'bestsellers': '⭐', 'bestseller': '⭐',
  'newadditions': '✨', 'newaddition': '✨', 'new addition': '✨',
  'personalized': '✨', 'personalized gifts': '✨',
  'halloween': '🎃',
  'birthday': '🎂',
  'anniversary': '💑',
  'valentine': '❤️', 'valentines': '❤️',
  'wedding': '💒',
  'christmas': '🎄',
  'newyear': '🎆', 'new year': '🎆', 'newyear_january': '🎆',
  'diwali': '🪔',
  'graduation': '🎓',
  'mother': '👩‍👧', 'mothers': '👩‍👧', 'momtobe': '🤰',
  'father': '👨‍👧', 'fathers': '👨‍👧', 'fathersday': '👨‍👧',
  'teachersday': '🍎',
  'bridetobe': '👰', 'bride': '👰',
  'lover': '💕', 'love': '💕',
  'corporate': '💼',
  'sympathies': '🕊️',
  'thaipongle': '🎊',
  'womenday': '👩', 'women day': '👩',
  'youandme': '💑', 'uniquegifts': '🎁', 'unique gifts': '🎁',
  'childrensday': '🧸',
}

function getIcon(name) {
  const key = name.toLowerCase().trim()
  if (CAT_ICONS[key]) return CAT_ICONS[key]

  const firstWord = key.split(/[\s-/]+/)[0]
  if (CAT_ICONS[firstWord]) return CAT_ICONS[firstWord]

  const camelSplit = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/)
  for (const part of camelSplit) {
    if (CAT_ICONS[part]) return CAT_ICONS[part]
  }

  const singular = key.replace(/s$/, '')
  if (singular !== key && CAT_ICONS[singular]) return CAT_ICONS[singular]

  return '🛍️'
}

const GROCERY_CATS = [
  'Rice', 'Fruits', 'Vegetables', 'Beverages', 'Snacks',
  'Chocolates', 'Biscuits', 'Dairy', 'Household', 'BabyItems',
  'Bread', 'Cooking Oil', 'Spices', 'Noodles', 'Drinks',
  'Meat', 'Fish', 'Cheese', 'Yogurt', 'Eggs',
]

export default function CategoryBrowser({ categories = [], onSelect = () => {} }) {
  const { t } = useLang()
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <div className="cat-grid" ref={ref}>
      {GROCERY_CATS.map((name, i) => (
        <motion.button
          key={name}
          className="cat-card"
          onClick={() => onSelect(name)}
          initial={{ opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.25, delay: i * 0.025 }}
          whileHover={{ y: -3 }}
          whileTap={{ scale: 0.96 }}
          aria-label={t('category.browse') + ' ' + name}
        >
          <span className="icon" aria-hidden="true">{getIcon(name)}</span>
          <span>{name}</span>
        </motion.button>
      ))}
    </div>
  )
}
