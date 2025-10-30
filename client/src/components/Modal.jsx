import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

const SIZE_MAX_WIDTH = {
  sm: '520px',
  md: '680px',
  lg: '860px',
  xl: '1120px',
  full: '95vw',
}

function getFocusableElements(container) {
  if (!container) return []
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTORS)).filter(
    (el) => !el.hasAttribute('aria-hidden') && !el.closest('[aria-hidden="true"]')
  )
}

export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = 'md',
  maxWidth,
  minWidth,
  closeLabel = 'Schließen',
  hideCloseButton = false,
  bodyClassName = '',
}) {
  const titleId = useId()
  const descriptionId = subtitle ? useId() : undefined
  const overlayRef = useRef(null)
  const containerRef = useRef(null)
  const previousFocused = useRef(null)

  useEffect(() => {
    if (typeof document === 'undefined') return undefined

    previousFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const node = containerRef.current
    const focusables = getFocusableElements(node)
    if (focusables.length > 0) {
      focusables[0].focus()
    } else if (node) {
      node.focus()
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose?.()
        return
      }

      if (event.key === 'Tab') {
        const focusable = getFocusableElements(containerRef.current)
        if (focusable.length === 0) {
          event.preventDefault()
          return
        }
        const currentIndex = focusable.indexOf(document.activeElement)
        let nextIndex = currentIndex
        if (event.shiftKey) {
          nextIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1
        } else {
          nextIndex = currentIndex === focusable.length - 1 ? 0 : currentIndex + 1
        }
        event.preventDefault()
        focusable[nextIndex].focus()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      if (previousFocused.current) {
        try {
          previousFocused.current.focus()
        } catch (_) {
          /* ignore */
        }
      }
    }
  }, [onClose])

  if (typeof document === 'undefined') {
    return null
  }

  const resolvedMaxWidth = maxWidth || SIZE_MAX_WIDTH[size] || SIZE_MAX_WIDTH.md
  const containerStyle = {
    maxWidth: resolvedMaxWidth,
    minWidth,
  }

  const handleOverlayMouseDown = (event) => {
    if (event.target === overlayRef.current) {
      onClose?.()
    }
  }

  const bodyClass = ['modal-body', bodyClassName].filter(Boolean).join(' ')

  return createPortal(
    <div
      className="modal-overlay"
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        className="modal-container"
        ref={containerRef}
        style={containerStyle}
        onMouseDown={(event) => event.stopPropagation()}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div className="modal-header-text">
            <h2 className="modal-title" id={titleId}>{title}</h2>
            {subtitle ? (
              <p className="modal-subtitle" id={descriptionId}>{subtitle}</p>
            ) : null}
          </div>
          {!hideCloseButton && (
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              aria-label={closeLabel}
            >
              ✕
            </button>
          )}
        </header>
        <div className={bodyClass}>
          {children}
        </div>
        {footer ? (
          <footer className="modal-footer">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
