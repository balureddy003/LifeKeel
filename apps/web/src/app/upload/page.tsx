'use client'

import Link from 'next/link'
import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter, useSearchParams } from 'next/navigation'
import { PageHeader, GlassCard, EmptyState } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { useToast } from '@/components/Toast'
import { uploadDocument, fetchDocuments, type FamilyDocument } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { displayDocName } from '@/lib/doc-name'
import { CATEGORY_ICONS, CATEGORY_LABELS } from '@/lib/document-categories'
import { takeNativePhoto } from '@/lib/native'
import { Camera, FileText, Upload, Check, Loader2, AlertCircle, ChevronRight, ShieldCheck, Sparkles } from 'lucide-react'

function statusIcon(status: FamilyDocument['status']) {
  switch (status) {
    case 'uploaded':
    case 'processing':
      return <Loader2 size={14} className="text-warning animate-spin" />
    case 'extracted':
      return <Check size={14} className="text-success" />
    case 'stored':
      return <ShieldCheck size={14} className="text-ink-tertiary" />
    case 'error':
      return <AlertCircle size={14} className="text-danger" />
  }
}

function statusLabel(status: FamilyDocument['status'], extractedData?: Record<string, string>) {
  switch (status) {
    case 'uploaded': return 'Uploading...'
    case 'processing': return 'Processing...'
    case 'extracted': return Object.keys(extractedData ?? {}).length > 0 ? 'Read, please check' : 'Saved, nothing read'
    case 'stored': return 'Saved'
    case 'error': return 'Failed'
  }
}

export default function UploadPage() {
  const router = useRouter()
  const toast = useToast()
  const searchParams = useSearchParams()
  const categoryFilter = searchParams.get('category')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [documents, setDocuments] = useState<FamilyDocument[]>([])
  const [aiExtractionEnabled, setAiExtractionEnabled] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  // Files that failed to upload, kept in memory so "we'll retry when you're
  // back online" is a real mechanism (auto-retry on the browser's `online`
  // event + a manual Retry button), not a promise the app couldn't keep.
  // In-memory only — closing the page drops the queue.
  const [failedFiles, setFailedFiles] = useState<File[]>([])
  const incrementDocumentCount = useAppStore((s) => s.incrementDocumentCount)

  const loadDocuments = useCallback(async () => {
    const { documents: docs, aiExtractionEnabled: enabled } = await fetchDocuments()
    setDocuments(categoryFilter ? docs.filter((d) => d.category === categoryFilter) : docs)
    setAiExtractionEnabled(enabled)
    setLoaded(true)
  }, [categoryFilter])

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

  const uploadOne = useCallback(async (file: File): Promise<boolean> => {
    try {
      const doc = await uploadDocument(file)
      setDocuments((prev) => [doc, ...prev])
      incrementDocumentCount()
      return true
    } catch {
      return false
    }
  }, [incrementDocumentCount])

  const retryFailed = useCallback(async (files: File[]) => {
    const stillFailed: File[] = []
    for (const file of files) {
      if (await uploadOne(file)) haptic('success')
      else stillFailed.push(file)
    }
    setFailedFiles(stillFailed)
    setError(
      stillFailed.length === 0
        ? null
        : `Couldn't upload ${stillFailed.length === 1 ? `"${stillFailed[0]!.name}"` : `${stillFailed.length} documents`} — we'll retry when you're back online.`,
    )
    if (stillFailed.length > 0) haptic('warning')
  }, [uploadOne])

  // Auto-retry the failed-upload queue when connectivity comes back.
  useEffect(() => {
    if (failedFiles.length === 0) return
    const onOnline = () => { retryFailed(failedFiles) }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [failedFiles, retryFailed])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setUploading(true)
    setError(null)
    haptic('light')

    const failedNow: File[] = []
    for (const file of Array.from(files)) {
      if (await uploadOne(file)) {
        haptic('success')
      } else {
        failedNow.push(file)
        haptic('warning')
      }
    }
    if (failedNow.length > 0) {
      setFailedFiles((prev) => [...prev, ...failedNow])
      setError(
        `Couldn't upload ${failedNow.length === 1 ? `"${failedNow[0]!.name}"` : `${failedNow.length} documents`} — we'll retry when you're back online.`,
      )
    } else {
      const count = Array.from(files).length
      toast({ message: count === 1 ? 'Document uploaded' : `${count} documents uploaded` })
    }

    setUploading(false)
    e.target.value = ''
  }, [uploadOne, toast])

  // Inside the Capacitor shell the native camera gives better capture than
  // the webview's <input capture>; outside it, fall straight through.
  const handleTakePhoto = useCallback(async () => {
    const nativeFile = await takeNativePhoto()
    if (!nativeFile) {
      cameraInputRef.current?.click()
      return
    }
    setUploading(true)
    setError(null)
    haptic('light')
    if (await uploadOne(nativeFile)) {
      haptic('success')
      toast({ message: 'Document uploaded' })
    } else {
      setFailedFiles((prev) => [...prev, nativeFile])
      setError(`Couldn't upload "${nativeFile.name}" — we'll retry when you're back online.`)
      haptic('warning')
    }
    setUploading(false)
  }, [uploadOne, toast])

  return (
    <div className="px-5 pt-2 space-y-4">
      <PageHeader title={categoryFilter ? `${CATEGORY_LABELS[categoryFilter] ?? 'Documents'}` : 'Upload Documents'} backHref="/" />

      {/* Upload actions */}
      <div className="grid grid-cols-2 gap-3">
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleTakePhoto}
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
          className="rounded-2xl p-4 flex flex-col items-center gap-2 bg-tint/[0.04] border border-tint/[0.06] disabled:opacity-50"
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
            role="status"
            aria-live="polite"
          >
            <GlassCard className="p-3.5 border-danger/20 flex items-start gap-2">
              <AlertCircle size={16} className="text-danger flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs text-ink-secondary leading-relaxed">{error}</p>
                {failedFiles.length > 0 && (
                  <button
                    onClick={() => { haptic('light'); retryFailed(failedFiles) }}
                    className="mt-1.5 text-xs font-semibold text-family-400"
                  >
                    Retry now
                  </button>
                )}
              </div>
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

      {/* AI extraction upsell — upload/scan/storage is free, extraction is paid */}
      {loaded && !aiExtractionEnabled && documents.length > 0 && (
        <GlassCard
          className="p-3.5 border-family-500/20 flex items-start gap-2"
          interactive
          onClick={() => { haptic('light'); router.push('/upgrade') }}
        >
          <Sparkles size={16} className="text-family-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-ink-secondary leading-relaxed flex-1">
            Documents are saved and stored for free. <span className="text-family-400 font-semibold">Upgrade to Keel Plus</span> to have AI automatically pull out the provider, policy number, amounts, and dates.
          </p>
          <ChevronRight size={14} className="text-ink-tertiary flex-shrink-0 mt-0.5" />
        </GlassCard>
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
              description={
                aiExtractionEnabled
                  ? "Snap a photo of any financial document — insurance policy, pension statement, mortgage letter — and we'll extract the key details for you."
                  : "Snap a photo of any financial document to store it securely. Upgrade to have AI extract the key details (provider, policy number, amounts, dates) automatically."
              }
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
                <GlassCard
                  className="p-4"
                  interactive={doc.status === 'extracted'}
                  {...(doc.status === 'extracted'
                    ? { onClick: () => { haptic('light'); router.push(`/documents/${doc.id}`) } }
                    : {})}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-tint/[0.05] flex items-center justify-center flex-shrink-0">
                      <Icon size={18} className="text-ink-secondary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{displayDocName(doc)}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-ink-tertiary">{CATEGORY_LABELS[doc.category] ?? 'Document'}</span>
                        <span className="text-xs text-ink-tertiary">·</span>
                        <span className="text-xs flex items-center gap-1" style={{
                          color: doc.status === 'extracted' ? '#4ade80' : doc.status === 'error' ? '#f87171' : doc.status === 'stored' ? '#9ca3af' : '#fbbf24'
                        }}>
                          {statusIcon(doc.status)} {statusLabel(doc.status, doc.extractedData)}
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
          To read a document, Keel sends it to an approved AI processor, as set out in the <Link href="/privacy" className="underline">Privacy notice</Link>. The key fields it finds (provider, policy number, amounts, dates) are shown for you to check.
        </p>
      </div>
    </div>
  )
}
