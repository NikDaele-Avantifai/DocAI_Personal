import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import { TOUR_STEPS, TourStep } from '../config/tourSteps'

const STORAGE_KEY = 'docai_tour_completed'
const DEMO_KEY = 'docai_demo_mode'
const WELCOME_KEY = 'docai_welcome_dismissed'

interface TourContextValue {
  isRunning: boolean
  isDemoMode: boolean
  currentStep: number
  totalSteps: number
  currentStepData: TourStep | null
  startTour: () => void
  endTour: () => void
  nextStep: () => void
  prevStep: () => void
  setDemoMode: (v: boolean) => void
  tourCompleted: boolean
  showWelcome: boolean
  dismissWelcome: () => void
}

const TourContext = createContext<TourContextValue>(null!)
export const useTour = () => useContext(TourContext)

export function TourProvider({ children }: { children: ReactNode }) {
  const [isRunning, setIsRunning] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [tourCompleted, setTourCompleted] = useState(() =>
    localStorage.getItem(STORAGE_KEY) === 'true'
  )
  const [isDemoMode, setIsDemoModeState] = useState(() =>
    localStorage.getItem(DEMO_KEY) === 'true'
  )
  const [showWelcome, setShowWelcome] = useState(() =>
    localStorage.getItem(STORAGE_KEY) !== 'true' &&
    localStorage.getItem(WELCOME_KEY) !== 'true'
  )

  const startTour = useCallback(() => {
    setCurrentStep(0)
    setIsRunning(true)
  }, [])

  const endTour = useCallback(() => {
    setIsRunning(false)
    setCurrentStep(0)
    setTourCompleted(true)
    setShowWelcome(false)
    localStorage.setItem(STORAGE_KEY, 'true')
  }, [])

  const nextStep = useCallback(() => {
    setCurrentStep(prev => {
      const next = prev + 1
      if (next >= TOUR_STEPS.length) {
        setIsRunning(false)
        setTourCompleted(true)
        setShowWelcome(false)
        localStorage.setItem(STORAGE_KEY, 'true')
        return 0
      }
      return next
    })
  }, [])

  const prevStep = useCallback(() => {
    setCurrentStep(prev => Math.max(0, prev - 1))
  }, [])

  const setDemoMode = useCallback((v: boolean) => {
    setIsDemoModeState(v)
    localStorage.setItem(DEMO_KEY, v ? 'true' : 'false')
  }, [])

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false)
    localStorage.setItem(WELCOME_KEY, 'true')
  }, [])

  // Auto-start on first visit (check URL for demo param)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('demo') === 'true') {
      setIsDemoModeState(true)
      localStorage.setItem(DEMO_KEY, 'true')
      setTimeout(() => startTour(), 100)
    }
  }, [startTour])

  const currentStepData = isRunning ? TOUR_STEPS[currentStep] ?? null : null

  return (
    <TourContext.Provider value={{
      isRunning,
      isDemoMode,
      currentStep,
      totalSteps: TOUR_STEPS.length,
      currentStepData,
      startTour,
      endTour,
      nextStep,
      prevStep,
      setDemoMode,
      tourCompleted,
      showWelcome,
      dismissWelcome,
    }}>
      {children}
    </TourContext.Provider>
  )
}
