import { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTour } from '../contexts/TourContext'
import '../styles/tour.css'

type Rect = { x: number; y: number; width: number; height: number }

const TOOLTIP_W = 320
const TOOLTIP_GAP = 16
const SPOTLIGHT_PAD = 8

function getTooltipStyle(
  position: string,
  spotlight: Rect,
  vpW: number,
  vpH: number
): React.CSSProperties {
  const cx = spotlight.x + spotlight.width / 2
  const cy = spotlight.y + spotlight.height / 2

  let top: number, left: number

  switch (position) {
    case 'bottom':
      top = spotlight.y + spotlight.height + TOOLTIP_GAP + SPOTLIGHT_PAD
      left = cx - TOOLTIP_W / 2
      break
    case 'top':
      top = spotlight.y - TOOLTIP_GAP - SPOTLIGHT_PAD - 200 // approximate height
      left = cx - TOOLTIP_W / 2
      break
    case 'right':
      top = cy - 100
      left = spotlight.x + spotlight.width + TOOLTIP_GAP + SPOTLIGHT_PAD
      break
    case 'left':
      top = cy - 100
      left = spotlight.x - TOOLTIP_W - TOOLTIP_GAP - SPOTLIGHT_PAD
      break
    default: // center
      top = vpH / 2 - 120
      left = vpW / 2 - TOOLTIP_W / 2
  }

  // Clamp to viewport
  left = Math.max(12, Math.min(left, vpW - TOOLTIP_W - 12))
  top = Math.max(12, Math.min(top, vpH - 260))

  return { position: 'fixed', top, left, width: TOOLTIP_W, zIndex: 10001 }
}

function waitForElement(selector: string, timeout = 2500): Promise<Element | null> {
  return new Promise(resolve => {
    const el = document.querySelector(selector)
    if (el) { resolve(el); return }

    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector)
      if (found) {
        observer.disconnect()
        resolve(found)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => { observer.disconnect(); resolve(null) }, timeout)
  })
}

export default function TourOverlay() {
  const { isRunning, isDemoMode, currentStep, totalSteps, currentStepData, endTour, nextStep, prevStep } = useTour()
  const navigate = useNavigate()
  const location = useLocation()
  const [spotlight, setSpotlight] = useState<Rect | null>(null)
  const [isCentered, setIsCentered] = useState(false)
  const [ready, setReady] = useState(false)
  const prevStepRef = useRef(-1)

  const measureTarget = useCallback(async (selector: string, route: string) => {
    setReady(false)

    // Navigate if needed
    if (location.pathname !== route && !route.startsWith(location.pathname)) {
      navigate(route)
      await new Promise(r => setTimeout(r, 350))
    }

    // No target — render as centered modal with no spotlight
    if (!selector) {
      setIsCentered(true)
      setSpotlight({ x: 0, y: 0, width: 0, height: 0 })
      setReady(true)
      return
    }

    const el = await waitForElement(selector)
    if (!el) {
      // Target not found — fall back to centered modal
      setIsCentered(true)
      setSpotlight({ x: 0, y: 0, width: 0, height: 0 })
      setReady(true)
      return
    }

    setIsCentered(false)
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    await new Promise(r => setTimeout(r, 200))

    const rect = el.getBoundingClientRect()
    setSpotlight({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
    setReady(true)
  }, [location.pathname, navigate])

  useEffect(() => {
    if (!isRunning || !currentStepData) {
      setReady(false)
      prevStepRef.current = -1
      return
    }
    if (prevStepRef.current === currentStep) return
    prevStepRef.current = currentStep
    measureTarget(currentStepData.target, currentStepData.route)
  }, [isRunning, currentStep, currentStepData, measureTarget])

  // Re-measure on resize
  useEffect(() => {
    if (!isRunning || !currentStepData || !ready) return
    const handle = () => measureTarget(currentStepData.target, currentStepData.route)
    window.addEventListener('resize', handle)
    return () => window.removeEventListener('resize', handle)
  }, [isRunning, currentStepData, ready, measureTarget])

  // ESC key handler
  useEffect(() => {
    if (!isRunning) return
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [isRunning, endTour])

  if (!isRunning || !currentStepData || !ready || !spotlight) return null

  const vpW = window.innerWidth
  const vpH = window.innerHeight

  const sx = spotlight.x - SPOTLIGHT_PAD
  const sy = spotlight.y - SPOTLIGHT_PAD
  const sw = spotlight.width + SPOTLIGHT_PAD * 2
  const sh = spotlight.height + SPOTLIGHT_PAD * 2

  const effectivePosition = isCentered ? 'center' : currentStepData.position
  const tooltipStyle = getTooltipStyle(effectivePosition, { x: sx, y: sy, width: sw, height: sh }, vpW, vpH)
  const isLast = currentStep === totalSteps - 1

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (!isDemoMode) return
    // In demo mode, click anywhere on backdrop advances
    e.stopPropagation()
    if (isLast) endTour(); else nextStep()
  }

  return createPortal(
    <div className="tour-root" aria-modal="true" role="dialog">
      {isCentered ? (
        /* Centered modal — full-screen dimmed backdrop, no spotlight cutout */
        <div
          className="tour-svg"
          onClick={handleBackdropClick}
          style={{
            background: 'rgba(9,30,66,0.54)',
            cursor: isDemoMode ? 'pointer' : 'default',
          }}
        />
      ) : (
        <>
          {/* SVG spotlight overlay */}
          <svg
            className="tour-svg"
            onClick={handleBackdropClick}
            style={{ cursor: isDemoMode ? 'pointer' : 'default' }}>
            <defs>
              <mask id="tour-mask">
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                <rect x={sx} y={sy} width={sw} height={sh} rx="6" fill="black" />
              </mask>
            </defs>
            <rect x="0" y="0" width="100%" height="100%" fill="rgba(9,30,66,0.54)" mask="url(#tour-mask)" />
          </svg>

          {/* Spotlight highlight ring */}
          <div
            className="tour-spotlight-ring"
            style={{ left: sx, top: sy, width: sw, height: sh }}
          />
        </>
      )}

      {/* Tooltip card */}
      <div className="tour-card" style={tooltipStyle}>
        {/* Header */}
        <div className="tour-card-header">
          <span className="tour-card-title">{currentStepData.title}</span>
          {!isDemoMode && (
            <button className="tour-close-btn" onClick={endTour} aria-label="Close tour">✕</button>
          )}
        </div>

        {/* Body */}
        <div className="tour-card-body">
          <p className="tour-card-text">{currentStepData.text}</p>
        </div>

        {/* Footer */}
        <div className="tour-card-footer">
          {/* Progress dots */}
          <div className="tour-dots">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`tour-dot${i === currentStep ? ' active' : ''}`}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="tour-buttons">
            {!isDemoMode && (
              <button
                className="tour-btn tour-btn-ghost"
                onClick={endTour}>
                Skip
              </button>
            )}
            {currentStep > 0 && (
              <button
                className="tour-btn tour-btn-secondary"
                onClick={prevStep}>
                ← Back
              </button>
            )}
            <button
              className="tour-btn tour-btn-primary"
              onClick={isLast ? endTour : nextStep}>
              {isLast ? 'Finish' : 'Next →'}
            </button>
          </div>
        </div>

        {/* Step counter */}
        <div className="tour-step-counter">
          {currentStep + 1} / {totalSteps}
        </div>
      </div>

      {/* ESC hint */}
      {!isDemoMode && (
        <div className="tour-esc-hint">Press ESC to exit tour</div>
      )}
    </div>,
    document.body
  )
}
