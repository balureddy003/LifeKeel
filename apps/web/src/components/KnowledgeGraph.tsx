'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Home, User, Briefcase, Bot, X, ChevronRight, Maximize2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { useAuth } from '@/lib/auth-context'
import type { FamilyMember } from '@/lib/types'
import { getMemberSections, CATEGORY_COLOR, type GraphCategory } from '@/lib/familySections'
import { runForceSimulation, type SimNode, type SimEdge } from '@/lib/forceSimulation'

type NodeKind = 'root' | 'person' | 'category' | 'asset'

interface NodeData {
  label: string
  icon: LucideIcon
  kind: NodeKind
  navId?: string
  story?: string
  category: GraphCategory
}

const KIND_COLOR: Record<NodeKind, string> = {
  root: '#7c6ef0',
  person: '#60a5fa',
  category: '#8a8070',
  asset: '#4ade80',
}

interface RawNode {
  id: string
  label: string
  icon: LucideIcon
  kind: NodeKind
  navId?: string
  story?: string
  category: GraphCategory
  mass?: number
}

interface RawEdge {
  source: string
  target: string
}

function buildGraphData(members: FamilyMember[]): { rawNodes: RawNode[]; rawEdges: RawEdge[] } {
  const rawNodes: RawNode[] = []
  const rawEdges: RawEdge[] = []

  rawNodes.push({
    id: 'family',
    label: 'Our Family',
    icon: Home,
    kind: 'root',
    category: 'family',
    mass: 3,
  })

  for (const member of members) {
    rawNodes.push({
      id: member.id,
      label: member.name,
      icon: User,
      kind: 'person',
      navId: member.id,
      story: member.role,
      category: 'family',
      mass: 2,
    })
    rawEdges.push({ source: 'family', target: member.id })

    for (const section of getMemberSections(member)) {
      rawNodes.push({
        id: section.id,
        label: section.label,
        icon: section.icon,
        kind: section.kind,
        ...(section.navId ? { navId: section.navId } : {}),
        ...(section.story ? { story: section.story } : {}),
        category: section.category,
      })
      rawEdges.push({ source: member.id, target: section.id })
    }
  }

  return { rawNodes, rawEdges }
}

function buildFamilyGraph(members: FamilyMember[]): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const { rawNodes, rawEdges } = buildGraphData(members)

  const simNodes: SimNode[] = rawNodes.map((n) => ({
    id: n.id,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    mass: n.mass ?? 1,
  }))
  const simEdges: SimEdge[] = rawEdges

  // Live-verification finding: the original constants (repulsion 10000,
  // centerStrength 0.015) converged to a world-space layout too tight for
  // fitView to spread across a real phone-width container without nodes
  // overlapping — measured live via getBoundingClientRect() on a real
  // 2-member family graph, several node pairs rendered with negative
  // effective gaps (e.g. "Our Family" and a person node ~45px apart
  // center-to-center while both are 40-80px wide). Stronger repulsion and
  // much weaker centering gives fitView enough room to compress into a
  // narrow viewport without nodes colliding.
  const positions = runForceSimulation(simNodes, simEdges, {
    repulsion: 40000,
    springLength: 100,
    springStrength: 0.05,
    centerStrength: 0.005,
    iterations: 300,
  })

  const nodes: Node<NodeData>[] = rawNodes.map((n) => ({
    id: n.id,
    type: 'graphNode',
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    data: {
      label: n.label,
      icon: n.icon,
      kind: n.kind,
      ...(n.navId ? { navId: n.navId } : {}),
      ...(n.story ? { story: n.story } : {}),
      category: n.category,
    },
  }))

  const edges: Edge[] = rawEdges.map((e) => {
    const sourceNode = rawNodes.find((n) => n.id === e.source)
    const cat = sourceNode?.category ?? 'family'
    return {
      id: `e-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      style: { stroke: `${CATEGORY_COLOR[cat]}33`, strokeWidth: 1.5 },
    }
  })

  return { nodes, edges }
}

function GraphNode({ data }: NodeProps<NodeData>) {
  const color = KIND_COLOR[data.kind]
  const isRoot = data.kind === 'root'
  const isPerson = data.kind === 'person'
  const isAsset = data.kind === 'asset'

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex flex-col items-center gap-1 px-4 py-3 rounded-2xl"
        style={{
          background: `${color}14`,
          border: `2px solid ${color}40`,
          backdropFilter: 'blur(20px)',
          minWidth: isRoot ? 120 : isPerson ? 100 : 90,
        }}
      >
        <div className="flex items-center gap-1" style={{ filter: `drop-shadow(0 0 8px ${color}40)` }}>
          <data.icon size={isRoot ? 28 : isPerson ? 22 : 18} color={color} strokeWidth={1.5} />
          {isAsset && <ChevronRight size={12} color={color} strokeWidth={2} />}
        </div>
        <div className="text-xs font-semibold text-white whitespace-nowrap">
          {data.label}
        </div>
      </motion.div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </>
  )
}

const nodeTypes = { graphNode: GraphNode }

const FILTER_OPTIONS: { key: GraphCategory | 'all'; label: string; color: string }[] = [
  { key: 'all', label: 'All', color: '#7c6ef0' },
  { key: 'protection', label: 'Protection', color: '#f87171' },
  { key: 'wealth', label: 'Wealth', color: '#fbbf24' },
  { key: 'goals', label: 'Goals', color: '#4ade80' },
]

interface KnowledgeGraphProps {
  fullscreen?: boolean
}

export function KnowledgeGraph({ fullscreen = false }: KnowledgeGraphProps) {
  const [selected, setSelected] = useState<Node<NodeData> | null>(null)
  const [filter, setFilter] = useState<GraphCategory | 'all'>('all')
  const router = useRouter()
  const { family } = useAuth()

  const graphMembers: FamilyMember[] = useMemo(() => {
    if (!family || family.members.length === 0) return []
    return family.members.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      emoji: m.emoji,
      relation: m.role === 'organizer' ? 'owner' : m.role === 'parent' ? 'spouse' : 'child',
    }))
  }, [family])

  const { nodes: allNodes, edges: allEdges } = useMemo(() => buildFamilyGraph(graphMembers), [graphMembers])

  const { nodes, edges } = useMemo(() => {
    if (filter === 'all') return { nodes: allNodes, edges: allEdges }

    const visibleIds = new Set<string>()
    for (const n of allNodes) {
      if (n.data.category === filter || n.data.kind === 'root' || n.data.kind === 'person') {
        visibleIds.add(n.id)
      }
    }
    for (const e of allEdges) {
      if (visibleIds.has(e.source) && !visibleIds.has(e.target)) {
        const targetNode = allNodes.find((n) => n.id === e.target)
        if (targetNode && targetNode.data.category === filter) {
          visibleIds.add(e.target)
        }
      }
    }
    const visibleNodes = allNodes.filter((n) => visibleIds.has(n.id))
    const finalEdges = allEdges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
    return { nodes: visibleNodes, edges: finalEdges }
  }, [allNodes, allEdges, filter])

  // Shared by mouse (onNodeClick below) and keyboard (the container
  // keydown listener further down) so both input methods activate a node
  // identically — see that listener's comment for why keyboard needs its
  // own handling at all.
  const handleNodeActivate = useCallback((node: Node<NodeData>) => {
    haptic('light')
    if (node.data.kind === 'person' && node.data.navId) {
      router.push(`/member/${node.data.navId}`)
    } else if (node.data.kind === 'asset' && node.data.navId) {
      router.push(`/asset/${node.data.navId}`)
    } else if (node.data.kind === 'category') {
      setSelected(node)
    }
  }, [router])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<NodeData>) => {
    handleNodeActivate(node)
  }, [handleNodeActivate])

  // Live-verification finding: every node is keyboard-focusable and
  // announced as a button (tabIndex=0, role="button", both react-flow
  // defaults) — but Enter/Space did nothing. react-flow's own onKeyDown
  // updates its internal selection state (the node visibly gains the
  // .selected class) without ever calling onNodeClick, and — confirmed via
  // a diagnostic log — onSelectionChange doesn't fire for a
  // keyboard-triggered selection either, even though it fires correctly
  // for a mouse-triggered one. Rather than depend on that internal
  // selection plumbing, this listens for Enter/Space directly on whichever
  // node currently has real DOM focus (each node wrapper carries
  // react-flow's own data-id) and calls the exact same activation handler
  // a mouse click uses.
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const active = document.activeElement
      if (!active || !container.contains(active) || !active.classList.contains('react-flow__node')) return
      const dataId = active.getAttribute('data-id')
      const node = nodes.find((n) => n.id === dataId)
      if (!node) return
      e.preventDefault()
      handleNodeActivate(node)
    }
    container.addEventListener('keydown', handler)
    return () => container.removeEventListener('keydown', handler)
  }, [nodes, handleNodeActivate])

  return (
    <div ref={containerRef} className="relative w-full h-full rounded-3xl overflow-hidden glass flex flex-col">
      {/* Filter chips */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 flex-shrink-0">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => { setFilter(opt.key); haptic('light') }}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
              filter === opt.key
                ? 'text-white'
                : 'text-ink-tertiary hover:text-ink-secondary'
            }`}
            style={filter === opt.key ? { background: `${opt.color}25`, border: `1px solid ${opt.color}50` } : { border: '1px solid transparent' }}
          >
            {opt.label}
          </button>
        ))}
        <div className="flex-1" />
        {!fullscreen && (
          <Link
            href="/map"
            onClick={() => haptic('light')}
            className="flex items-center gap-1 text-xs text-ink-tertiary hover:text-ink-secondary transition-colors"
          >
            <Maximize2 size={12} />
            Full map
          </Link>
        )}
      </div>

      {/* Hint — a real row in the layout, not an absolutely-positioned
          overlay: fitView scales the graph to use the whole canvas area,
          so an overlay pinned to a corner ends up sitting on top of
          whichever nodes fitView happens to place there (confirmed live —
          it was covering 3 real nodes on a real phone-width viewport). A
          row above the canvas can never overlap graph content, regardless
          of viewport size or how fitView lays anything out. */}
      <div className="flex items-center gap-1.5 px-4 py-1.5 text-[10px] text-ink-tertiary border-b border-white/5 flex-shrink-0">
        <Bot size={10} />
        Tap a person or asset to explore
      </div>

      {/* Graph canvas */}
      <div className="flex-1 relative">
        {graphMembers.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <Home size={32} className="text-ink-tertiary" />
            <p className="text-sm text-ink-tertiary leading-relaxed">
              Add family members to see your family graph come to life.
            </p>
            <Link
              href="/family"
              onClick={() => haptic('light')}
              className="text-sm text-family-400 font-semibold flex items-center gap-1"
            >
              Set up family <ChevronRight size={14} />
            </Link>
          </div>
        ) : (
        <>
        <ReactFlow
          nodes={nodes}
          edges={edges}
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
          // React Flow makes edges keyboard-focusable by default, each
          // with its own "Edge from X to Y" announcement — but nothing in
          // this app responds to activating an edge (no onEdgeClick), so
          // they're pure Tab-order noise between real content. Confirmed
          // live via a real keyboard sweep: with 9 edges and 10 nodes in a
          // typical family graph, a keyboard/screen-reader user had to tab
          // through all 9 inert edges before ever reaching the first real,
          // interactive node.
          edgesFocusable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} color="rgba(255,255,255,0.04)" gap={20} />
          <Controls
            showInteractive={false}
            className="!bg-white/5 !border-white/10 !rounded-xl !backdrop-blur-md"
          />
          {fullscreen && (
            // Live-verification finding: react-flow's default MiniMap
            // footprint (~200x150) took up nearly a third of this canvas's
            // own height — measured live overlapping 2-4 real nodes at
            // several viewport sizes, including a realistic 812px-tall
            // phone, not just this pane's own unusually short default. A
            // corner overview is supposed to sit clear of the content it's
            // summarizing; shrinking it cuts collision risk without
            // touching the main graph's own zoom/fit behavior.
            <MiniMap
              className="!bg-white/5 !backdrop-blur-md !rounded-xl !border-white/10"
              style={{ width: 96, height: 72 }}
              nodeColor={(node) => CATEGORY_COLOR[(node.data?.category as GraphCategory) ?? 'family']}
              nodeStrokeColor="rgba(255,255,255,0.2)"
              maskColor="rgba(0,0,0,0.3)"
            />
          )}
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
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: `${KIND_COLOR[selected.data.kind]}15`, border: `1px solid ${KIND_COLOR[selected.data.kind]}30` }}>
                  <selected.data.icon size={18} color={KIND_COLOR[selected.data.kind]} strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-white">{selected.data.label}</div>
                  <p className="text-xs text-ink-secondary mt-1 leading-relaxed">
                    {selected.data.story}
                  </p>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="text-ink-tertiary flex-shrink-0"
                  aria-label="Dismiss"
                >
                  <X size={16} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        </>
        )}
      </div>
    </div>
  )
}
