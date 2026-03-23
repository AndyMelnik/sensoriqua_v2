import React from 'react';

export function AccordionStep({
  step,
  title,
  open,
  onToggle,
  children,
  badge,
}: {
  step: number;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  badge?: number | string;
}) {
  return (
    <div className={`accordion-step ${open ? 'accordion-step--open' : ''}`}>
      <button
        type="button"
        className="accordion-step__header"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="accordion-step__number">{step}</span>
        <span className="accordion-step__title">{title}</span>
        {badge != null && badge !== '' && (
          <span className="accordion-step__badge">{badge}</span>
        )}
        <span className="accordion-step__chevron" aria-hidden>{open ? '▼' : '▶'}</span>
      </button>
      <div className="accordion-step__frame" hidden={!open}>
        <div className="accordion-step__content">{children}</div>
      </div>
    </div>
  );
}
