import { useLang } from '../i18n'

export default function Footer() {
  const { t } = useLang()
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="logo-c">G</span><span className="logo-ey">rocery</span><span className="logo-cart">LK</span>
          <p className="footer-tagline">Compare. Save. Shop smarter.</p>
        </div>
        <div className="footer-links">
          <span className="footer-link" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>{t('about.home')}</span>
          <a className="footer-link" href="#about">{t('about.about')}</a>
        </div>
        <div className="footer-stores">
          {['Kapruka', 'Cargills', 'Global Food City', 'SPAR', 'Glomark', 'Arpico'].map(s => (
            <span key={s} className="footer-store">{s}</span>
          ))}
        </div>
      </div>
      <p className="footer-copy">{t('about.copyright', { year: 2026 })}</p>
    </footer>
  )
}
