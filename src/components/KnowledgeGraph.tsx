'use client'

import { useCallback } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  BackgroundVariant,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Home, Heart, Wallet, Target, Shield, HeartPulse, Briefcase, House, TrendingUp, Landmark, GraduationCap, Palmtree, Bot, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { haptic } from '@/lib/haptics'

interface NodeData {
  label: string
  icon: LucideIcon
  status: 'green' | 'yellow' | 'red'
  story?: string
  explanation?: string
  progress?: number
  type: 'family' | 'category' | 'detail'
}

const statusColors: Record<string, string> = {
  green: '#4ade80',
  yellow: '#fbbf24',
  red: '#f87171',
}

const statusBg: Record<string, string> = {
  green: 'rgba(74,222,128,0.08)',
  yellow: 'rgba(251,191,36,0.08)',
  red: 'rgba(248,113,113,0.08)',
}

function GraphNode({ data }: NodeProps<NodeData>) {
  const color = statusColors[data.status] ?? '#8a8070'
  const isRoot = data.type === 'family'
  const isCategory = data.type === 'category'

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex flex-col items-center gap-1 px-4 py-3 rounded-2xl"
        style={{
          background: statusBg[data.status] ?? 'rgba(255,255,255,0.03)',
          border: `2px solid ${color}40`,
          backdropFilter: 'blur(20px)',
          minWidth: isRoot ? 120 : isCategory ? 100 : 90,
        }}
      >
        <div className="flex items-center justify-center" style={{ filter: `drop-shadow(0 0 8px ${color}40)` }}>
          <data.icon size={isRoot ? 28 : isCategory ? 22 : 18} color={color} strokeWidth={1.5} />
        </div>
        <div className="text-xs font-semibold text-white whitespace-nowrap">
          {data.label}
        </div>
        {data.progress !== undefined && (
          <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${data.progress}%`, backgroundColor: color }}
            />
          </div>
        )}
      </motion.div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </>
  )
}

const nodeTypes = { graphNode: GraphNode }

function buildNodes(): Node<NodeData>[] {
  return [
    // Root
    {
      id: 'family',
      type: 'graphNode',
      position: { x: 300, y: 0 },
      data: { label: 'Our Family', icon: Home, status: 'green', type: 'family', story: "Your family is well protected. There's one area to improve: retirement savings." },
    },
    // Categories
    {
      id: 'protection',
      type: 'graphNode',
      position: { x: 80, y: 140 },
      data: { label: 'Protection', icon: Heart, status: 'green', type: 'category', progress: 90, story: 'Your family is well protected.' },
    },
    {
      id: 'wealth',
      type: 'graphNode',
      position: { x: 300, y: 140 },
      data: { label: 'Wealth', icon: Wallet, status: 'yellow', type: 'category', progress: 65, story: 'Your wealth is growing steadily.' },
    },
    {
      id: 'goals',
      type: 'graphNode',
      position: { x: 520, y: 140 },
      data: { label: 'Goals', icon: Target, status: 'green', type: 'category', progress: 80, story: "Your children's education is 72% funded." },
    },
    // Protection details
    {
      id: 'life-insurance',
      type: 'graphNode',
      position: { x: 0, y: 300 },
      data: { label: 'Life Insurance', icon: Shield, status: 'green', type: 'detail', progress: 100, story: 'Your family would receive $750,000.', explanation: 'Think of this like a safety net. If something happens to you, your family receives $750,000.' },
    },
    {
      id: 'health-insurance',
      type: 'graphNode',
      position: { x: 90, y: 300 },
      data: { label: 'Health', icon: HeartPulse, status: 'green', type: 'detail', progress: 95, story: 'Full medical coverage for the whole family.' },
    },
    {
      id: 'income-protection',
      type: 'graphNode',
      position: { x: 180, y: 300 },
      data: { label: 'Income', icon: Briefcase, status: 'green', type: 'detail', progress: 85, story: "$5,000/month for 2 years if you can't work." },
    },
    // Wealth details
    {
      id: 'home',
      type: 'graphNode',
      position: { x: 230, y: 300 },
      data: { label: 'Home', icon: House, status: 'green', type: 'detail', progress: 78, story: 'Worth $850,000. Mortgage 22% paid off.' },
    },
    {
      id: 'investments',
      type: 'graphNode',
      position: { x: 320, y: 300 },
      data: { label: 'Investments', icon: TrendingUp, status: 'green', type: 'detail', progress: 72, story: 'Grew 12% this year — $45,000 in gains.' },
    },
    {
      id: 'pension',
      type: 'graphNode',
      position: { x: 410, y: 300 },
      data: { label: 'Pension', icon: Landmark, status: 'yellow', type: 'detail', progress: 55, story: 'Adding $300/month keeps you on track.' },
    },
    // Goals details
    {
      id: 'emma-uni',
      type: 'graphNode',
      position: { x: 460, y: 300 },
      data: { label: "Emma's Uni", icon: GraduationCap, status: 'green', type: 'detail', progress: 72, story: "72% complete. She'll have $120,000 at 18." },
    },
    {
      id: 'lucas-uni',
      type: 'graphNode',
      position: { x: 550, y: 300 },
      data: { label: "Lucas's Uni", icon: GraduationCap, status: 'yellow', type: 'detail', progress: 45, story: '45% complete. Adding $200/month helps.' },
    },
    {
      id: 'retirement',
      type: 'graphNode',
      position: { x: 640, y: 300 },
      data: { label: 'Retirement', icon: Palmtree, status: 'red', type: 'detail', progress: 40, story: 'Adding $250/month could retire at 60.' },
    },
  ]
}

function buildEdges(): Edge[] {
  const baseEdges: Edge[] = [
    { id: 'e-fam-prot', source: 'family', target: 'protection', animated: true, style: { stroke: 'rgba(74,222,128,0.3)', strokeWidth: 2 } },
    { id: 'e-fam-wealth', source: 'family', target: 'wealth', animated: true, style: { stroke: 'rgba(251,191,36,0.3)', strokeWidth: 2 } },
    { id: 'e-fam-goals', source: 'family', target: 'goals', animated: true, style: { stroke: 'rgba(74,222,128,0.3)', strokeWidth: 2 } },
  ]
  const detailEdges: Edge[] = [
    { id: 'e-prot-life', source: 'protection', target: 'life-insurance', style: { stroke: 'rgba(74,222,128,0.15)', strokeWidth: 1 } },
    { id: 'e-prot-health', source: 'protection', target: 'health-insurance', style: { stroke: 'rgba(74,222,128,0.15)', strokeWidth: 1 } },
    { id: 'e-prot-income', source: 'protection', target: 'income-protection', style: { stroke: 'rgba(74,222,128,0.15)', strokeWidth: 1 } },
    { id: 'e-wealth-home', source: 'wealth', target: 'home', style: { stroke: 'rgba(251,191,36,0.15)', strokeWidth: 1 } },
    { id: 'e-wealth-inv', source: 'wealth', target: 'investments', style: { stroke: 'rgba(74,222,128,0.15)', strokeWidth: 1 } },
    { id: 'e-wealth-pension', source: 'wealth', target: 'pension', style: { stroke: 'rgba(251,191,36,0.15)', strokeWidth: 1 } },
    { id: 'e-goals-emma', source: 'goals', target: 'emma-uni', style: { stroke: 'rgba(74,222,128,0.15)', strokeWidth: 1 } },
    { id: 'e-goals-lucas', source: 'goals', target: 'lucas-uni', style: { stroke: 'rgba(251,191,36,0.15)', strokeWidth: 1 } },
    { id: 'e-goals-retire', source: 'goals', target: 'retirement', style: { stroke: 'rgba(248,113,113,0.15)', strokeWidth: 1 } },
  ]
  return [...baseEdges, ...detailEdges]
}

export function KnowledgeGraph() {
  const [selected, setSelected] = useState<Node<NodeData> | null>(null)

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<NodeData>) => {
    haptic('light')
    setSelected(node)
  }, [])

  return (
    <div className="relative w-full h-[420px] rounded-3xl overflow-hidden glass">
      <ReactFlow
        nodes={buildNodes()}
        edges={buildEdges()}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        panOnDrag
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} color="rgba(255,255,255,0.04)" gap={20} />
        <Controls
          showInteractive={false}
          className="!bg-white/5 !border-white/10 !rounded-xl !backdrop-blur-md"
        />
        <MiniMap
          className="!bg-white/5 !backdrop-blur-md !rounded-xl !border-white/10"
          nodeColor={(node) => statusColors[node.data?.status ?? 'green'] ?? '#8a8070'}
          maskColor="rgba(0,0,0,0.5)"
        />
      </ReactFlow>

      {/* Story panel */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-4 left-4 right-4 glass-strong rounded-2xl p-4 z-10"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: `${statusColors[selected.data.status]}15`, border: `1px solid ${statusColors[selected.data.status]}30` }}>
                <selected.data.icon size={18} color={statusColors[selected.data.status]} strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold text-white">{selected.data.label}</div>
                <p className="text-xs text-ink-secondary mt-1 leading-relaxed">
                  {selected.data.story}
                </p>
                {selected.data.explanation && (
                  <div className="mt-2 pt-2 border-t border-white/5">
                    <div className="text-[10px] text-family-400 font-semibold mb-1 flex items-center gap-1">
                      <Bot size={10} /> AI explains
                    </div>
                    <p className="text-xs text-ink-tertiary leading-relaxed">
                      {selected.data.explanation}
                    </p>
                  </div>
                )}
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-ink-tertiary flex-shrink-0"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hint */}
      <div className="absolute top-3 right-3 glass rounded-full px-3 py-1 text-[10px] text-ink-tertiary pointer-events-none">
        Pinch to zoom · Drag to pan · Tap any node
      </div>
    </div>
  )
}
