"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Languages } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { locales, messages } from "@/lib/i18n";

/** The language switch: Persian, English, Arabic, each named in its own language. */
export function LanguageMenu({ className = "icon-button language-button" }: { className?: string }) {
  const { locale, m, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="language-menu" ref={root}>
      <button className={className} type="button" title={m.shell.language} aria-label={m.shell.language} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Languages size={17} />
        <span>{m.meta.languageName}</span>
      </button>
      {open && (
        <div className="language-menu-list" role="menu">
          {locales.map((option) => (
            <button key={option} type="button" role="menuitemradio" aria-checked={option === locale} lang={option} dir={messages[option].meta.dir} onClick={() => { setLocale(option); setOpen(false); }}>
              <span>{messages[option].meta.languageName}</span>
              {option === locale && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
