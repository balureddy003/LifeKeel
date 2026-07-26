'use client'

import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, Home, Heart, Shield, Briefcase, Wallet, TrendingUp, Landmark, Target, GraduationCap, Palmtree, ChevronRight, type LucideIcon } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import type { LifeNode } from '@/lib/modes'

const NODE_ICONS: Record<string, LucideIcon> = {
  family: Home,
  protection: Heart,
  'life-insurance': Shield,
  'health-insurance': Heart,
  'income-protection': Briefcase,
  wealth: Wallet,
  home: Home,
  investments: TrendingUp,
  pension: Landmark,
  goals: Target,
  'daughter-education': GraduationCap,
  'son-education': GraduationCap,
  retirement: Palmtree,
}

const statusColor = (status: 'green' | 'yellow' | 'red') => {
  const colors = { green: '#4ade80', yellow: '#fbbf24', red: '#f87171' }
  return colors[status]
}

const statusGlow = (status: 'green' | 'yellow' | 'red') => {
  const colors = { green: 'rgba(74,222,128,0.3)', yellow: 'rgba(251,191,36,0.3)', red: 'rgba(248,113,113,0.3)' }
  return colors[status]
}

function NodeCircle({
  node,
  size,
  onTap,
  isSelected,
}: {
  node: LifeNode
  size: number
  onTap: () => void
  isSelected: boolean
}) {
  const color = statusColor(node.status)
  const glow = statusGlow(node.status)

  return (
    <motion.button
      onClick={() => {
        haptic('light')
        onTap()
      }}
      whileTap={{ scale: 0.9 }}
      className="relative flex flex-col items-center justify-center gap-1"
      style={{ width: size, height: size + 30 }}
    >
      <motion.div
        className="rounded-full flex items-center justify-center"
        style={{
          width: size,
          height: size,
          background: isSelected
            ? `radial-gradient(circle, ${glow}, rgba(255,255,255,0.03))`
            : 'rgba(255,255,255,0.03)',
          border: `2px solid ${isSelected ? color : 'rgba(255,255,255,0.1)'}`,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: isSelected ? `0 0 30px ${glow}` : 'none',
        }}
        animate={{
          scale: isSelected ? 1.1 : 1,
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      >
        {(() => {
          const NodeIcon = NODE_ICONS[node.id] ?? Home
          return <NodeIcon size={size * 0.4} color={color} strokeWidth={1.5} />
        })()}
      </motion.div>
      <span
        className="text-xs font-semibold text-center"
        style={{ color: isSelected ? color : '#c4b8a8' }}
      >
        {node.label}
      </span>
      {node.progress !== undefined && (
        <div className="w-16 h-1 rounded-full bg-white/5 overflow-hidden -mt-0.5">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: color }}
            initial={{ width: 0 }}
            animate={{ width: `${node.progress}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </div>
      )}
    </motion.button>
  )
}

function ConnectionLine({ active }: { active: boolean }) {
  return (
    <div
      className="absolute top-1/2 left-0 right-0 h-px -translate-y-1/2"
      style={{
        background: active
          ? 'linear-gradient(90deg, transparent, rgba(124,110,240,0.4), transparent)'
          : 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)',
      }}
    />
  )
}

export function LifeMap({
  data,
  onSelectNode,
}: {
  data: LifeNode
  onSelectNode: (node: LifeNode) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleTap = (node: LifeNode) => {
    setSelectedId(node.id)
    if (node.children && node.children.length > 0) {
      setExpandedId(expandedId === node.id ? null : node.id)
    }
    onSelectNode(node)
  }

  const expandedNode = data.children?.find((c) => c.id === expandedId)

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Root node */}
      <div className="flex flex-col items-center gap-4 py-2">
        <NodeCircle
          node={data}
          size={80}
          onTap={() => handleTap(data)}
          isSelected={selectedId === data.id}
        />

        {/* Vertical connector */}
        <div className="w-px h-6 bg-gradient-to-b from-white/10 to-transparent" />

        {/* Category nodes */}
        <div className="flex gap-3 flex-wrap justify-center relative">
          {data.children?.map((child, i) => (
            <motion.div
              key={child.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1, type: 'spring', stiffness: 300, damping: 25 }}
              className="relative"
            >
              <NodeCircle
                node={child}
                size={64}
                onTap={() => handleTap(child)}
                isSelected={selectedId === child.id}
              />
            </motion.div>
          ))}
        </div>

        {/* Expanded detail nodes */}
        <AnimatePresence mode="popLayout">
          {expandedNode && (
            <motion.div
              key={expandedNode.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="overflow-hidden w-full"
            >
              <div className="w-px h-4 bg-gradient-to-b from-white/10 to-transparent mx-auto" />
              <div className="flex gap-2 flex-wrap justify-center pt-2">
                {expandedNode.children?.map((detail, i) => (
                  <motion.div
                    key={detail.id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.08, type: 'spring', stiffness: 400, damping: 25 }}
                  >
                    <NodeCircle
                      node={detail}
                      size={56}
                      onTap={() => handleTap(detail)}
                      isSelected={selectedId === detail.id}
                    />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Story panel */}
        <AnimatePresence mode="wait">
          {selectedId && (
            <motion.div
              key={selectedId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="w-full mt-2"
            >
              <StoryPanel
                node={findNode(data, selectedId)}
                onTap={() => {
                  const node = findNode(data, selectedId)
                  if (node) handleTap(node)
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function findNode(root: LifeNode, id: string): LifeNode | null {
  if (root.id === id) return root
  if (root.children) {
    for (const child of root.children) {
      const found = findNode(child, id)
      if (found) return found
    }
  }
  return null
}

function StoryPanel({ node, onTap }: { node: LifeNode | null; onTap: () => void }) {
  if (!node) return null
  const color = statusColor(node.status)

  return (
    <motion.div
      className="glass rounded-3xl p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="flex items-start gap-3 mb-3">
        {(() => {
          const NodeIcon = NODE_ICONS[node.id] ?? Home
          return (
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}15` }}>
              <NodeIcon size={20} color={color} strokeWidth={1.5} />
            </div>
          )
        })()}
        <div className="flex-1">
          <h3 className="text-lg font-bold" style={{ color }}>
            {node.label}
          </h3>
          {node.progress !== undefined && (
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${node.progress}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              </div>
              <span className="text-sm font-bold" style={{ color }}>
                {node.progress}%
              </span>
            </div>
          )}
        </div>
      </div>

      {node.story && (
        <p className="text-sm text-ink-secondary leading-relaxed mb-3">
          {node.story}
        </p>
      )}

      {node.explanation && (
        <div className="bg-white/[0.03] rounded-2xl p-3 border border-white/[0.05]">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Bot size={14} className="text-family-400" />
            <span className="text-xs font-semibold text-family-400">AI Explains</span>
          </div>
          <p className="text-sm text-ink-secondary leading-relaxed">
            {node.explanation}
          </p>
        </div>
      )}

      {node.children && node.children.length > 0 && (
        <button
          onClick={onTap}
          className="mt-3 text-sm text-family-400 font-semibold flex items-center gap-1"
        >
          {node.id === 'family' ? 'Explore categories' : 'Explore details'}
          <ChevronRight size={14} />
        </button>
      )}
    </motion.div>
  )
}
