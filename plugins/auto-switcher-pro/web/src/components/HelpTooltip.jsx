import React, { useState, useRef, useEffect } from 'react';
import { Icons } from './Icons';

/**
 * HelpTooltip: A minimal, accessible contextual help icon with a popover.
 * Moves dense explanatory paragraphs out of sight until the user needs them.
 */
export function HelpTooltip({ title, children, placement = 'top', className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <span
      ref={containerRef}
      className={`relative inline-flex items-center align-middle ${className}`}
      style={{ verticalAlign: 'middle', marginLeft: '4px' }}
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="help-tooltip-trigger inline-flex items-center justify-center text-secondary hover:text-primary transition-colors cursor-pointer"
        aria-label={title || 'Ayuda contextual'}
        style={{
          background: 'transparent',
          border: 'none',
          padding: '2px',
          color: 'var(--text-tertiary, #9c958d)',
          display: 'inline-flex',
          alignItems: 'center',
          cursor: 'pointer'
        }}
      >
        <Icons.HelpCircle size={14} />
      </button>

      {isOpen && (
        <span
          role="tooltip"
          className="help-tooltip-content"
          style={{
            position: 'absolute',
            zIndex: 1000,
            bottom: placement === 'top' ? 'calc(100% + 6px)' : 'auto',
            top: placement === 'bottom' ? 'calc(100% + 6px)' : 'auto',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'max-content',
            maxWidth: '280px',
            backgroundColor: 'var(--bg-tertiary, #262320)',
            color: 'var(--text-primary, #f6f4f1)',
            border: '1px solid var(--border-color, #3a3530)',
            borderRadius: '6px',
            padding: '8px 12px',
            fontSize: '12px',
            lineHeight: '1.45',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            textAlign: 'left',
            fontWeight: 'normal',
            whiteSpace: 'normal',
            wordBreak: 'break-word'
          }}
        >
          {title && (
            <span
              style={{
                display: 'block',
                fontWeight: '600',
                marginBottom: '4px',
                color: 'var(--text-primary, #f6f4f1)',
                borderBottom: '1px solid var(--border-color, #3a3530)',
                paddingBottom: '2px'
              }}
            >
              {title}
            </span>
          )}
          <span style={{ color: 'var(--text-secondary, #c9c3bb)' }}>{children}</span>
        </span>
      )}
    </span>
  );
}

export default HelpTooltip;
