import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';

/**
 * Language toggle component for switching between English and Hindi.
 * Persists selection to localStorage and applies Noto Sans Devanagari font for Hindi.
 */
export default function LanguageToggle() {
  const { i18n } = useTranslation();
  const currentLang = i18n.language?.startsWith('hi') ? 'hi' : 'en';

  useEffect(() => {
    // Apply Devanagari font class on the document root when Hindi is active
    if (currentLang === 'hi') {
      document.documentElement.classList.add('lang-hi');
      document.documentElement.lang = 'hi';
    } else {
      document.documentElement.classList.remove('lang-hi');
      document.documentElement.lang = 'en';
    }
  }, [currentLang]);

  const toggleLanguage = () => {
    const newLang = currentLang === 'en' ? 'hi' : 'en';
    i18n.changeLanguage(newLang);
  };

  return (
    <button
      onClick={toggleLanguage}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all hover:bg-foreground/10 active:scale-95"
      style={{
        background: 'rgba(var(--fg-rgb),var(--fg-a05))',
        border: '1px solid rgba(var(--fg-rgb),var(--fg-a12))',
        color: 'rgba(var(--fg-rgb),var(--fg-a7))',
      }}
      title={currentLang === 'en' ? 'हिन्दी में बदलें' : 'Switch to English'}
      aria-label={currentLang === 'en' ? 'Switch language to Hindi' : 'Switch language to English'}
    >
      <span className="text-[11px] font-medium">
        {currentLang === 'en' ? 'अ' : 'A'}
      </span>
      <span className="text-[10px] text-foreground/50">
        {currentLang === 'en' ? 'हिन्दी' : 'EN'}
      </span>
    </button>
  );
}
