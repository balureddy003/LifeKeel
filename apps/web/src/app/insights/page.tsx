'use client'

/**
 * There is no list page at this path (only /insights/[id]). A trimmed URL used to 404, so send it somewhere useful.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Page() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/inbox')
  }, [router])
  return null
}
