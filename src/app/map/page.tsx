'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { KnowledgeGraph } from '@/components/KnowledgeGraph'
import { haptic } from '@/lib/haptics'

export default function MapPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 px-5 py-3 flex-shrink-0"
      >
        <Link
          href="/"
          onClick={() => haptic('light')}
          className="flex items-center gap-1 text-sm text-ink-tertiary hover:text-ink-secondary transition-colors"
        >
          <ChevronLeft size={16} />
          Back
        </Link>
        <div className="flex-1" />
        <h1 className="text-sm font-semibold text-ink-secondary">Family Map</h1>
      </motion.div>

      <div className="flex-1 px-5 pb-5 min-h-0">
        <KnowledgeGraph fullscreen />
      </div>
    </div>
  )
}
