'use client'

import { useEffect } from 'react'
import { useReportWebVitals } from 'next/web-vitals'
import { initObservability, reportWebVital } from '@/lib/observability'

// Mounted once from the root layout. No visual output — just wires up error
// tracking (if configured) and Core Web Vitals reporting.
export function Observability() {
  useEffect(() => {
    initObservability()
  }, [])

  useReportWebVitals((metric) => reportWebVital(metric))

  return null
}
