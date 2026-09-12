'use client'

import { useEffect, useState } from 'react'

export interface NetworkStatus {
  connected: boolean
  connectionType: string
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    connected: true,
    connectionType: 'unknown',
  })

  useEffect(() => {
    const update = () => setStatus({
      connected: navigator.onLine,
      connectionType: navigator.onLine ? 'wifi' : 'none',
    })
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return status
}
