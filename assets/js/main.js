"use strict";
  const hamb = document.getElementById('hamb');
  const menu = document.getElementById('menu');
  const header = document.querySelector('header');
  const themeToggle = document.getElementById('theme-toggle');
  const root = document.documentElement;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const langComponent = document.querySelector('[data-component="lang-switcher"]');

  function readStoredTheme(){
    try {
      const stored = localStorage.getItem('theme');
      return stored === 'dark' || stored === 'light' ? stored : null;
    } catch (err) {
      return null;
    }
  }

  function persistTheme(theme){
    try { localStorage.setItem('theme', theme); } catch (err) {}
  }

  function updateMetaTheme(){
    if (!themeMeta) return;
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (bg) themeMeta.setAttribute('content', bg);
  }

  function applyTheme(theme, opts){
    if (theme !== 'dark' && theme !== 'light') return;
    const shouldPersist = !opts || opts.persist !== false;
    root.dataset.theme = theme;
    if (shouldPersist) persistTheme(theme);
    updateMetaTheme();
    if (themeToggle){
      const isDark = theme === 'dark';
      const icon = isDark ? '🌞' : '🌙';
      const label = isDark ? 'Light mode' : 'Dark mode';
      const ariaLabel = isDark ? 'Switch to light mode' : 'Switch to dark mode';
      themeToggle.setAttribute('aria-pressed', String(isDark));
      themeToggle.textContent = label;
      themeToggle.setAttribute('data-icon', icon);
      themeToggle.setAttribute('aria-label', ariaLabel);
      themeToggle.setAttribute('title', ariaLabel);
    }
    root.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }

  const prefersDarkMql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  const storedTheme = readStoredTheme();
  applyTheme(storedTheme || (prefersDarkMql && prefersDarkMql.matches ? 'dark' : 'light'), {persist:false});

  if (themeToggle){
    themeToggle.addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
  }

  if (prefersDarkMql){
    const onPrefersChange = (evt) => {
      if (readStoredTheme()) return;
      applyTheme(evt.matches ? 'dark' : 'light', {persist:false});
    };
    if (prefersDarkMql.addEventListener) prefersDarkMql.addEventListener('change', onPrefersChange);
    else if (prefersDarkMql.addListener) prefersDarkMql.addListener(onPrefersChange);
  }

  let lastMenuWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  let closeMenu = null;

  if (hamb && menu) {
    hamb.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      hamb.setAttribute('aria-expanded', String(open));
      if (open) {
        header.classList.remove('hide');
        lastMenuWidth = window.innerWidth || document.documentElement.clientWidth || lastMenuWidth;
        closeLangMenu({ resetSearch: false });
      }
    });
    closeMenu = (opts = {}) => {
      const preserveLang = opts && opts.preserveLang;
      if (!menu.classList.contains('open')) return;
      menu.classList.remove('open');
      hamb.setAttribute('aria-expanded', 'false');
      if (!preserveLang) closeLangMenu();
      lastMenuWidth = window.innerWidth || document.documentElement.clientWidth || lastMenuWidth;
    };
    for (const link of menu.querySelectorAll('a[href^="#"]')){
      link.addEventListener('click', closeMenu);
    }
    document.addEventListener('click', (evt) => {
      if (!menu.classList.contains('open')) return;
      const target = evt.target;
      if (target === hamb || hamb.contains(target)) return;
      if (langComponent && langComponent.contains(target)) return;
      if (menu.contains(target)) return;
      closeMenu();
    });
    const onMenuResponsiveResize = () => {
      const width = window.innerWidth || document.documentElement.clientWidth || 0;
      if (!menu.classList.contains('open')) {
        lastMenuWidth = width;
        return;
      }
      if (Math.abs(width - lastMenuWidth) < 40) return;
      lastMenuWidth = width;
      closeMenu();
    };
    window.addEventListener('resize', onMenuResponsiveResize);
  }

  let lastY = window.scrollY, ticking = false;
  function onScrollHeader() {
    const y = window.scrollY, dy = y - lastY;
    if (y > 2) header.classList.add('scrolled'); else header.classList.remove('scrolled');
    const menuOpen = menu && menu.classList.contains('open');
    if (!menuOpen && y > 80 && dy > 10) header.classList.add('hide');
    else if (dy < -6) header.classList.remove('hide');
    lastY = y; ticking = false;
  }
  window.addEventListener('scroll', () => { if (!ticking) { requestAnimationFrame(onScrollHeader); ticking = true; } });

  function setHeaderOffset(){
    const h = header.getBoundingClientRect().height;
    root.style.setProperty('--header-h', `${Math.round(h)}px`);
  }
  addEventListener('load', setHeaderOffset);
  addEventListener('resize', setHeaderOffset);

  // Mailto form
  const form = document.getElementById('mailtoForm');
  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = encodeURIComponent(document.getElementById('name').value.trim());
    const email = encodeURIComponent(document.getElementById('email').value.trim());
    const msg = encodeURIComponent(document.getElementById('message').value.trim());
    const subject = encodeURIComponent('Noonautics Labs - Website Contact');
    const body = `Name/Company: ${name}%0AEmail: ${email}%0A%0A${msg}`;
    window.location.href = `mailto:contact@noonauticslabs.org?subject=${subject}&body=${body}`;
  });

  // i18n (JSON-driven)
  const i18nElements = Array.from(document.querySelectorAll('[data-i18n]'));
  for (const el of i18nElements) {
    if (!el.dataset.i18nDefault) {
      el.dataset.i18nDefault = el.innerHTML;
    }
  }

  const langListbox = langComponent ? langComponent.querySelector('.lang-options') : null;
  const langCurrent = langComponent ? langComponent.querySelector('.lang-current') : null;
  const langToggle = langComponent ? langComponent.querySelector('.lang-toggle') : null;
  const langMenu = langComponent ? langComponent.querySelector('.lang-menu') : null;
  const langSearchInput = langComponent ? langComponent.querySelector('#langSearch') : null;
  const summaryFlag = langComponent ? langComponent.querySelector('.lang-flag-current') : null;
  const summaryCode = langCurrent ? langCurrent.querySelector('.lang-code') : null;
  const summaryName = langCurrent ? langCurrent.querySelector('.lang-name') : null;
  const summaryLabel = langComponent ? langComponent.querySelector('.lang-label') : null;
  const inlineLangScript = document.getElementById('language-data');

  if (langMenu) {
    langMenu.hidden = true;
    langMenu.setAttribute('aria-hidden', 'true');
  }
  if (langSearchInput && langSearchInput.value) {
    langSearchTerm = normalizeSearchText(langSearchInput.value.trim());
  }
  if (langToggle) {
    langToggle.setAttribute('aria-expanded', 'false');
  }

  const fallbackLangs = [
    { code: 'en', english: 'English', native: 'English', dir: 'ltr' },
    { code: 'pl', english: 'Polish', native: 'Polski', dir: 'ltr' },
    { code: 'de', english: 'German', native: 'Deutsch', dir: 'ltr' },
    { code: 'fr', english: 'French', native: 'Français', dir: 'ltr' },
    { code: 'es', english: 'Spanish', native: 'Español', dir: 'ltr' },
    { code: 'ru', english: 'Russian', native: 'Русский', dir: 'ltr' },
    { code: 'zh', english: 'Chinese (Simplified)', native: '中文', dir: 'ltr' },
    { code: 'ar', english: 'Arabic', native: 'العربية', dir: 'rtl' },
    { code: 'it', english: 'Italian', native: 'Italiano', dir: 'ltr' },
    { code: 'pt', english: 'Portuguese', native: 'Português', dir: 'ltr' },
    { code: 'ja', english: 'Japanese', native: '日本語', dir: 'ltr' },
    { code: 'hi', english: 'Hindi', native: 'हिन्दी', dir: 'ltr' },
    { code: 'tr', english: 'Turkish', native: 'Türkçe', dir: 'ltr' },
    { code: 'nl', english: 'Dutch', native: 'Nederlands', dir: 'ltr' },
  ];

  const LANGUAGE_FLAGS = {
    'en': '🇺🇸',
    'en-gb': '🇬🇧',
    'en-us': '🇺🇸',
    'pl': '🇵🇱',
    'de': '🇩🇪',
    'fr': '🇫🇷',
    'es': '🇪🇸',
    'ru': '🇷🇺',
    'zh': '🇨🇳',
    'zh-cn': '🇨🇳',
    'zh-hans': '🇨🇳',
    'zh-hant': '🇹🇼',
    'zh-tw': '🇹🇼',
    'ar': '🇸🇦',
    'it': '🇮🇹',
    'pt': '🇵🇹',
    'pt-br': '🇧🇷',
    'ja': '🇯🇵',
    'hi': '🇮🇳',
    'tr': '🇹🇷',
    'nl': '🇳🇱',
    'ko': '🇰🇷',
    'vi': '🇻🇳',
    'sv': '🇸🇪',
    'no': '🇳🇴',
    'da': '🇩🇰',
    'fi': '🇫🇮',
    'cs': '🇨🇿',
    'sk': '🇸🇰',
    'uk': '🇺🇦',
    'el': '🇬🇷',
    'he': '🇮🇱',
    'fa': '🇮🇷',
    'id': '🇮🇩',
    'ms': '🇲🇾',
    'th': '🇹🇭',
    'bg': '🇧🇬',
    'ro': '🇷🇴'
  };

  function flagForLang(code) {
    if (!code) return '🌐';
    const lower = code.toLowerCase();
    if (LANGUAGE_FLAGS[lower]) return LANGUAGE_FLAGS[lower];
    const base = lower.split('-')[0];
    if (LANGUAGE_FLAGS[base]) return LANGUAGE_FLAGS[base];
    if (/^[a-z]{2}$/.test(base)) {
      const first = base.charCodeAt(0) - 97;
      const second = base.charCodeAt(1) - 97;
      if (first >= 0 && first < 26 && second >= 0 && second < 26) {
        return String.fromCodePoint(0x1F1E6 + first, 0x1F1E6 + second);
      }
    }
    return '🌐';
  }

  let LANGS = fallbackLangs.map((entry) => ({ ...entry }));
  let langButtons = [];
  let langMenuOpen = false;
  let langSearchTerm = '';
  let langHighlightedButton = null;
  const translationCache = new Map();

  function normalizeLanguageEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const code = String(entry.code || '').trim().toLowerCase();
    if (!code) return null;
    const english = String(entry.english || entry.label || entry.name || '').trim();
    const native = String(entry.native || entry.endonym || english || '').trim();
    const dir = entry.dir === 'rtl' ? 'rtl' : 'ltr';
    const fallbackLabel = code.split('-')[0].toUpperCase();
    return {
      code,
      english: english || native || fallbackLabel,
      native: native || english || fallbackLabel,
      dir,
    };
  }

  function dedupeLanguages(list) {
    const unique = [];
    const seen = new Set();
    for (const item of list) {
      if (!item || seen.has(item.code)) continue;
      seen.add(item.code);
      unique.push(item);
    }
    if (!seen.has('en')) {
      const fallbackEn = fallbackLangs.find((entry) => entry.code === 'en');
      if (fallbackEn) unique.unshift({ ...fallbackEn });
    }
    return unique.length ? unique : fallbackLangs.map((entry) => ({ ...entry }));
  }

  function normalizeSearchText(value) {
    const text = String(value || '');
    try {
      return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    } catch (err) {
      return text.toLowerCase();
    }
  }

  function parseInlineLanguageConfig() {
    if (!inlineLangScript || !inlineLangScript.textContent) return [];
    try {
      const parsed = JSON.parse(inlineLangScript.textContent);
      if (!Array.isArray(parsed)) return [];
      return dedupeLanguages(parsed.map(normalizeLanguageEntry).filter(Boolean));
    } catch (error) {
      console.error('[i18n]', 'Unable to parse inline language data', error);
      return [];
    }
  }

  async function loadLanguageConfig() {
    const inlineConfig = parseInlineLanguageConfig();
    if (inlineConfig.length) return inlineConfig;
    if (!langListbox) return fallbackLangs.map((entry) => ({ ...entry }));
    try {
      const response = await fetch('./i18n/languages.json', { cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (!Array.isArray(json)) throw new Error('Invalid payload');
      return dedupeLanguages(json.map(normalizeLanguageEntry).filter(Boolean));
    } catch (error) {
      console.error('[i18n]', 'Unable to load language list', error);
      return fallbackLangs.map((entry) => ({ ...entry }));
    }
  }

  function renderLangButtons(list) {
    if (!langListbox) return;
    langListbox.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (const entry of list) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lang-option';
      button.dataset.lang = entry.code;
      button.dataset.dir = entry.dir;
      button.dataset.search = normalizeSearchText(`${entry.english} ${entry.native} ${entry.code}`);
      button.setAttribute('role', 'option');
      button.setAttribute('lang', entry.code);
      const safeId = entry.code ? entry.code.toLowerCase().replace(/[^a-z0-9-]/g, '-') : 'lang';
      button.id = `lang-option-${safeId}`;
      button.tabIndex = -1;
      const flagSpan = document.createElement('span');
      flagSpan.className = 'lang-flag';
      flagSpan.textContent = flagForLang(entry.code);
      const labels = document.createElement('span');
      labels.className = 'lang-labels';
      const nativeSpan = document.createElement('span');
      nativeSpan.className = 'lang-native';
      nativeSpan.textContent = entry.native;
      nativeSpan.setAttribute('lang', entry.code);
      nativeSpan.dir = entry.dir === 'rtl' ? 'rtl' : 'ltr';
      const englishSpan = document.createElement('span');
      englishSpan.className = 'lang-english';
      englishSpan.textContent = entry.english;
      englishSpan.setAttribute('lang', 'en');
      labels.append(nativeSpan, englishSpan);
      button.append(flagSpan, labels);
      button.title = entry.english === entry.native
        ? entry.english
        : `${entry.english} · ${entry.native}`;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        closeLangMenu({ resetSearch: true });
        setLang(entry.code);
      });
      fragment.appendChild(button);
    }
    langListbox.appendChild(fragment);
    langButtons = Array.from(langListbox.querySelectorAll('[data-lang]'));
    langComponent?.setAttribute('data-ready', 'true');
    const currentSearch = langSearchInput ? langSearchInput.value : langSearchTerm;
    setLangSearchValue(currentSearch, { scroll: false });
  }

  function setLangHighlight(button, { scroll = true } = {}) {
    if (langHighlightedButton && langHighlightedButton !== button) {
      langHighlightedButton.classList.remove('is-highlight');
    }
    langHighlightedButton = button || null;
    if (!langHighlightedButton) return;
    langHighlightedButton.classList.add('is-highlight');
    if (scroll && langMenuOpen) {
      try {
        langHighlightedButton.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch (err) {
        langHighlightedButton.scrollIntoView();
      }
    }
  }

  function applyLangSearch(term, { scroll = true } = {}) {
    langSearchTerm = typeof term === 'string' ? normalizeSearchText(term.trim()) : '';
    const hasTerm = langSearchTerm.length > 0;
    let firstMatch = null;
    for (const btn of langButtons) {
      if (!btn) continue;
      const haystack = btn.dataset.search || '';
      if (hasTerm && haystack.includes(langSearchTerm)) {
        btn.setAttribute('data-match', 'true');
        if (!firstMatch) firstMatch = btn;
      } else {
        btn.removeAttribute('data-match');
      }
    }
    if (hasTerm) {
      setLangHighlight(firstMatch || null, { scroll });
    } else {
      const selected = langButtons.find((btn) => btn?.getAttribute('aria-selected') === 'true') || null;
      setLangHighlight(selected, { scroll });
    }
  }

  function setLangSearchValue(value, { focusInput = false, scroll = true } = {}) {
    const text = typeof value === 'string' ? value : '';
    if (langSearchInput) {
      langSearchInput.value = text;
      if (focusInput) {
        const cursor = text.length;
        langSearchInput.focus();
        langSearchInput.setSelectionRange(cursor, cursor);
      }
    }
    applyLangSearch(text, { scroll });
  }

  function focusLangButton(index) {
    if (!langButtons.length) return;
    const total = langButtons.length;
    let offset = 0;
    let target = null;
    while (offset < total) {
      const targetIndex = ((index + offset) % total + total) % total;
      const candidate = langButtons[targetIndex];
      if (candidate && candidate.offsetParent !== null) {
        target = candidate;
        break;
      }
      offset += 1;
    }
    if (target) target.focus();
  }

  function handleLangKeydown(event) {
    if (!langButtons.length) return;
    const { key } = event;
    const activeElement = document.activeElement;
    const currentIndex = langButtons.indexOf(activeElement);
    if (key === 'ArrowLeft' || key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = currentIndex > -1 ? currentIndex - 1 : langButtons.length - 1;
      focusLangButton(nextIndex);
    } else if (key === 'ArrowRight' || key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = currentIndex > -1 ? currentIndex + 1 : 0;
      focusLangButton(nextIndex);
    } else if (key === 'Home') {
      event.preventDefault();
      focusLangButton(0);
    } else if (key === 'End') {
      event.preventDefault();
      focusLangButton(langButtons.length - 1);
    } else if (key === 'Escape') {
      event.preventDefault();
      closeLangMenu({ restoreFocus: true });
    } else if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
      if (currentIndex > -1) {
        event.preventDefault();
        langButtons[currentIndex].click();
      }
    } else if (langSearchInput && (key === 'Backspace' || key === 'Delete')) {
      event.preventDefault();
      const currentValue = langSearchInput.value || '';
      const nextValue = key === 'Backspace'
        ? currentValue.slice(0, -1)
        : '';
      setLangSearchValue(nextValue, { focusInput: true, scroll: true });
    } else if (langSearchInput && key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      setLangSearchValue((langSearchInput.value || '') + key, { focusInput: true, scroll: true });
    }
  }

  langListbox?.addEventListener('keydown', handleLangKeydown);

  function focusActiveLangButton({ preferHighlight = true } = {}) {
    if (!langButtons.length) return;
    const selected = langButtons.find((btn) => btn.getAttribute('aria-selected') === 'true');
    const target = preferHighlight && langHighlightedButton ? langHighlightedButton : (selected || langButtons[0]);
    if (target) {
      target.focus();
      if (langMenuOpen) {
        try {
          target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } catch (err) {
          target.scrollIntoView();
        }
      }
    }
  }

  function focusLangMenuTarget(mode = 'active') {
    if (mode === 'search' && langSearchInput) {
      langSearchInput.focus();
      langSearchInput.select();
      return;
    }
    if (mode === 'none') return;
    focusActiveLangButton();
  }

  function openLangMenu({ focus = 'active' } = {}) {
    if (!langComponent) return;
    if (langMenuOpen) {
      focusLangMenuTarget(focus);
      return;
    }
    langMenuOpen = true;
    langComponent.setAttribute('data-open', 'true');
    if (langToggle) langToggle.setAttribute('aria-expanded', 'true');
    if (langMenu) {
      langMenu.hidden = false;
      langMenu.setAttribute('aria-hidden', 'false');
    }
    setLangSearchValue(langSearchInput ? langSearchInput.value : langSearchTerm, { scroll: false });
    focusLangMenuTarget(focus);
  }

  function closeLangMenu({ restoreFocus = false, resetSearch = true } = {}) {
    if (!langComponent || !langMenuOpen) return;
    langMenuOpen = false;
    langComponent.removeAttribute('data-open');
    if (langToggle) langToggle.setAttribute('aria-expanded', 'false');
    if (langMenu) {
      langMenu.hidden = true;
      langMenu.setAttribute('aria-hidden', 'true');
    }
    const searchValue = resetSearch ? '' : (langSearchInput ? langSearchInput.value : langSearchTerm);
    setLangSearchValue(searchValue, { scroll: false });
    if (restoreFocus && langToggle) langToggle.focus();
  }

  function toggleLangMenu({ focus = 'active' } = {}) {
    if (langMenuOpen) closeLangMenu({ restoreFocus: true, resetSearch: true });
    else openLangMenu({ focus });
  }

  if (langMenu) {
    langMenu.addEventListener('click', (event) => event.stopPropagation());
  }
  if (langListbox) {
    langListbox.addEventListener('click', (event) => event.stopPropagation());
  }
  if (langSearchInput) {
    langSearchInput.addEventListener('input', (event) => {
      applyLangSearch(event.target.value, { scroll: true });
    });
    langSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        focusActiveLangButton();
      } else if (event.key === 'Enter' && langHighlightedButton) {
        event.preventDefault();
        langHighlightedButton.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeLangMenu({ restoreFocus: true, resetSearch: true });
      }
    });
  }
  if (langToggle) {
    langToggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (menu && menu.classList.contains('open') && typeof closeMenu === 'function') {
        closeMenu({ preserveLang: true });
      }
      toggleLangMenu({ focus: 'search' });
    });
    langToggle.addEventListener('keydown', (event) => {
      const { key } = event;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        if (!langMenuOpen) openLangMenu({ focus: 'active' });
        else focusActiveLangButton();
      } else if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
        event.preventDefault();
        toggleLangMenu({ focus: 'active' });
      } else if (key === 'Escape' && langMenuOpen) {
        event.preventDefault();
        closeLangMenu({ restoreFocus: true });
      }
    });
  }

  document.addEventListener('click', (event) => {
    if (!langMenuOpen || !langComponent) return;
    if (langComponent.contains(event.target)) return;
    closeLangMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && langMenuOpen) {
      closeLangMenu({ restoreFocus: true });
    }
  });

  function updateLangButtons(activeLang) {
    let activeId = null;
    for (const btn of langButtons) {
      const isActive = btn.dataset.lang === activeLang;
      btn.setAttribute('aria-selected', String(isActive));
      btn.tabIndex = isActive ? 0 : -1;
      if (isActive) activeId = btn.id || null;
    }
    if (!activeId && langButtons.length) {
      langButtons[0].tabIndex = 0;
      activeId = langButtons[0].id || null;
    }
    if (langListbox) {
      if (activeId) langListbox.setAttribute('aria-activedescendant', activeId);
      else langListbox.removeAttribute('aria-activedescendant');
    }
    const currentSearch = langSearchInput ? langSearchInput.value : langSearchTerm;
    setLangSearchValue(currentSearch, { scroll: langMenuOpen });
  }

  function getLangEntry(code) {
    return LANGS.find((entry) => entry.code === code) || null;
  }

  function updateLangSummary(lang) {
    if (!langCurrent) return;
    const entry = getLangEntry(lang) || fallbackLangs[0];
    const displayCode = entry.code.split('-')[0].toUpperCase();
    if (summaryFlag) summaryFlag.textContent = flagForLang(entry.code);
    if (summaryCode) summaryCode.textContent = displayCode;
    if (summaryName) {
      summaryName.textContent = entry.native;
      summaryName.setAttribute('lang', entry.code);
      summaryName.dir = entry.dir === 'rtl' ? 'rtl' : 'ltr';
    }
    if (langToggle) {
      langToggle.setAttribute('data-lang', entry.code);
      const toggleTitle = entry.english === entry.native
        ? entry.english
        : `${entry.english} · ${entry.native}`;
      langToggle.setAttribute('title', toggleTitle);
    }
    langCurrent.setAttribute('aria-label', `Current language: ${entry.english}`);
    langComponent?.setAttribute('data-current', entry.code);
    if (summaryLabel) summaryLabel.setAttribute('data-current', entry.code);
  }

  function updateDocumentDirection(lang) {
    const entry = getLangEntry(lang);
    document.documentElement.setAttribute('dir', entry?.dir === 'rtl' ? 'rtl' : 'ltr');
  }

  function updateHistory(lang) {
    if (!('history' in window) || typeof history.replaceState !== 'function') return;
    const url = new URL(window.location.href);
    if (lang === 'en') {
      url.searchParams.delete('lang');
    } else {
      url.searchParams.set('lang', lang);
    }
    history.replaceState(null, '', url);
  }

  function persistLang(lang) {
    try { localStorage.setItem('lang', lang); } catch (e) {}
  }

  async function loadTranslations(lang) {
    if (lang === 'en') return null;
    if (translationCache.has(lang)) return translationCache.get(lang);
    try {
      const response = await fetch(`./i18n/${lang}.json`, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      translationCache.set(lang, json);
      return json;
    } catch (error) {
      console.error('[i18n]', `Unable to load translations for "${lang}"`, error);
      translationCache.set(lang, null);
      return null;
    }
  }

  function applyTranslations(payload) {
    const lang = payload?.lang || 'en';
    const translations = payload?.translations || null;
    for (const el of i18nElements) {
      const key = el.getAttribute('data-i18n');
      const fallback = el.dataset.i18nDefault || '';
      const html = translations && Object.prototype.hasOwnProperty.call(translations, key)
        ? translations[key]
        : fallback;
      if (el.innerHTML !== html) {
        el.innerHTML = html;
      }
    }
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.dataset.lang = lang;
  }

  function onLanguageActivated(lang) {
    updateDocumentDirection(lang);
    updateLangButtons(lang);
    updateLangSummary(lang);
    updateHistory(lang);
    persistLang(lang);
  }

  let loadingLang = null;

  async function setLang(lang) {
    let target = (lang || 'en').toLowerCase();
    if (!getLangEntry(target)) target = 'en';
    if (loadingLang === target) return;
    loadingLang = target;
    let translations = null;
    try {
      translations = await loadTranslations(target);
    } finally {
      const appliedLang = target === 'en' ? 'en' : (translations ? target : 'en');
      applyTranslations({
        lang: appliedLang,
        translations: appliedLang === 'en' ? null : translations,
      });
      onLanguageActivated(appliedLang);
      loadingLang = null;
    }
  }

  (async function initLang() {
    LANGS = await loadLanguageConfig();
    if (!Array.isArray(LANGS) || !LANGS.length) {
      LANGS = fallbackLangs.map((entry) => ({ ...entry }));
    }
    renderLangButtons(LANGS);
    let saved = null;
    const currentUrl = new URL(window.location.href);
    const queryLang = (currentUrl.searchParams.get('lang') || '').toLowerCase();
    if (queryLang) {
      saved = queryLang;
    }
    if (!saved) {
      try { saved = localStorage.getItem('lang'); } catch (e) {}
    }
    if (!saved) {
      const browser = (navigator.language || 'en').toLowerCase();
      const match = LANGS.find((entry) => browser.startsWith(entry.code));
      saved = match ? match.code : 'en';
    }
    await setLang(saved);
  })();
