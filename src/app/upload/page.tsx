'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { PageHeader, GlassCard, EmptyState } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { uploadDocument, fetchDocuments, type FamilyDocument } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Camera, FileText, Upload, Check, Loader2, AlertCircle, ChevronRight, ShieldCheck, Landmark, Home, TrendingUp, Receipt, Scale } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  insurance: ShieldCheck,
  pension: Landmark,
  mortgage: Home,
  investment: TrendingUp,
  tax: Receipt,
  will: Scale,
  other: FileText,
}

const CATEGORY_LABELS: Record<string, string> = {
  insurance: 'Insurance',
  pension: 'Pension',
  mortgage: 'Mortgage',
  investment: 'Investment',
  tax: 'Tax',
  will: 'Will / Estate',
  other: 'Other',
}

function statusIcon(status: FamilyDocument['status']) {
  switch (status) {
    case 'uploaded':
    case 'processing':
      return <Loader2 size={14} className="text-warning animate-spin" />
    case 'extracted':
      return <Check size={14} className="text-success" />
    case 'error':
      return <AlertCircle size={14} className="text-danger" />
  }
}

function statusLabel(status: FamilyDocument['status']) {
  switch (status) {
    case 'uploaded': return 'Uploading...'
    case 'processing': return 'Processing...'
    case 'extracted': return 'Extracted'
    case 'error': return 'Failed'
  }
}

export default function UploadPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [documents, setDocuments] = useState<FamilyDocument[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const incrementDocumentCount = useAppStore((s) => s.incrementDocumentCount)

  const loadDocuments = useCallback(async () => {
    const docs = await fetchDocuments()
    setDocuments(docs)
    setLoaded(true)
  }, [])

  useEffect(() => {
    loadDocuments()
  }, [loadDocuments])

  // Poll for OCR status updates on documents that are still processing
  useEffect(() => {
    const hasProcessing = documents.some((d) => d.status === 'uploaded' || d.status === 'processing')
    if (!hasProcessing) return
    const interval = setInterval(() => {
      loadDocuments()
    }, 3000)
    return () => clearInterval(interval)
  }, [documents, loadDocuments])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setUploading(true)
    setError(null)
    haptic('light')

    for (const file of Array.from(files)) {
      try {
        const doc = await uploadDocument(file)
        setDocuments((prev) => [doc, ...prev])
        incrementDocumentCount()
        haptic('success')
      } catch {
        setError(`Failed to upload ${file.name}. The service may be offline — your document will sync when reconnected.`)
        haptic('warning')
      }
    }

    setUploading(false)
    e.target.value = ''
  }, [incrementDocumentCount])

  return (
    <div className="px-5 pt-2 space-y-4">
      <PageHeader title="Upload Documents" backHref="/" />

      {/* Upload actions */}
      <div className="grid grid-cols-2 gap-3">
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => cameraInputRef.current?.click()}
          disabled={uploading}
          className="rounded-2xl p-4 flex flex-col items-center gap-2 bg-family-500/10 border border-family-500/20 disabled:opacity-50"
        >
          <Camera size={24} className="text-family-400" />
          <span className="text-sm font-semibold text-family-400">Take Photo</span>
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="rounded-2xl p-4 flex flex-col items-center gap-2 bg-white/[0.04] border border-white/[0.06] disabled:opacity-50"
        >
          <Upload size={24} className="text-ink-secondary" />
          <span className="text-sm font-semibold text-ink-secondary">Choose File</span>
        </motion.button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <GlassCard className="p-3.5 border-danger/20 flex items-start gap-2">
              <AlertCircle size={16} className="text-danger flex-shrink-0 mt-0.5" />
              <p className="text-xs text-ink-secondary leading-relaxed">{error}</p>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload progress */}
      {uploading && (
        <div className="flex items-center gap-2 text-sm text-ink-tertiary">
          <Loader2 size={16} className="animate-spin" />
          Uploading...
        </div>
      )}

      {/* Document list */}
      <div className="space-y-2">
        <div className="text-sm font-semibold text-ink-secondary px-1">
          Your Documents ({documents.length})
        </div>

        {documents.length === 0 && loaded ? (
          <GlassCard>
            <EmptyState
              icon={FileText}
              title="No documents yet"
              description="Snap a photo of any financial document — insurance policy, pension statement, mortgage letter — and we'll extract the key details for you."
            />
          </GlassCard>
        ) : (
          documents.map((doc, i) => {
            const Icon = CATEGORY_ICONS[doc.category] ?? FileText
            return (
              <motion.div
                key={doc.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <GlassCard className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-white/[0.05] flex items-center justify-center flex-shrink-0">
                      <Icon size={18} className="text-ink-secondary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{doc.filename}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-ink-tertiary">{CATEGORY_LABELS[doc.category] ?? 'Document'}</span>
                        <span className="text-xs text-ink-tertiary">·</span>
                        <span className="text-xs flex items-center gap-1" style={{
                          color: doc.status === 'extracted' ? '#4ade80' : doc.status === 'error' ? '#f87171' : '#fbbf24'
                        }}>
                          {statusIcon(doc.status)} {statusLabel(doc.status)}
                        </span>
                      </div>
                    </div>
                    {doc.status === 'extracted' && (
                      <ChevronRight size={16} className="text-ink-tertiary flex-shrink-0" />
                    )}
                  </div>
                </GlassCard>
              </motion.div>
            )
          })
        )}
      </div>

      {/* Privacy note */}
      <div className="glass rounded-2xl p-4 flex items-start gap-2">
        <ShieldCheck size={16} className="text-ink-tertiary flex-shrink-0 mt-0.5" />
        <p className="text-xs text-ink-tertiary leading-relaxed">
          Your documents are encrypted at rest and processed in a secure environment. We only extract key fields (provider, policy number, amounts, dates) — the original file is never shared with third parties.
        </p>
      </div>
    </div>
  )
}
