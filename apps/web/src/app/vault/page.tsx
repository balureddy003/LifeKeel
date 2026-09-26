'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PageHeader, GlassCard, EmptyState, Skeleton } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { useToast } from '@/components/Toast'
import { useConfirm } from '@/components/ConfirmSheetProvider'
import {
  fetchVaultDocuments,
  uploadVaultDocument,
  fetchVaultDocumentFileUrl,
  deleteVaultDocument,
  type VaultDocument,
} from '@/lib/api'
import { Camera, Upload, FileLock2, Loader2, AlertCircle, Lock, Trash2, X } from 'lucide-react'

export default function VaultPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [documents, setDocuments] = useState<VaultDocument[]>([])
  const [loaded, setLoaded] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ id: string; url: string; mimeType: string; filename: string } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { documents: docs, forbidden: f } = await fetchVaultDocuments()
    setDocuments(docs)
    setForbidden(f)
    setLoaded(true)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Revoke the preview's object URL when it's closed or replaced — same
  // cleanup DocumentDetailClient.tsx's split-view preview already does.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url)
    }
  }, [preview])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    haptic('light')
    try {
      const doc = await uploadVaultDocument(file)
      setDocuments((prev) => [doc, ...prev])
      haptic('success')
      toast({ message: 'Added to your vault' })
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : 'Could not upload that document')
    } finally {
      setUploading(false)
    }
  }, [toast])

  const openPreview = useCallback(async (doc: VaultDocument) => {
    haptic('light')
    const file = await fetchVaultDocumentFileUrl(doc.id)
    if (!file) {
      toast({ message: "Couldn't open that document", variant: 'error' })
      return
    }
    setPreview({ id: doc.id, url: file.url, mimeType: file.mimeType, filename: doc.filename })
  }, [toast])

  const handleDelete = useCallback(async (doc: VaultDocument) => {
    const ok = await confirm({
      title: `Delete "${doc.filename}"?`,
      message: 'This removes it from the vault permanently. This can\'t be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    haptic('warning')
    setDeletingId(doc.id)
    const success = await deleteVaultDocument(doc.id)
    setDeletingId(null)
    if (success) {
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id))
      if (preview?.id === doc.id) setPreview(null)
    } else {
      toast({ message: "Couldn't delete that document", variant: 'error' })
    }
  }, [confirm, preview, toast])

  return (
    <div className="px-5 pt-2 pb-10 space-y-4">
      <PageHeader title="Digital Estate Vault" backHref="/" />

      <div className="glass rounded-2xl p-4 flex items-start gap-2">
        <Lock size={16} className="text-family-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-ink-tertiary leading-relaxed">
          For wills, power of attorney, and similar documents. Encrypted at rest and visible only to adult
          family members — Oak never opens, shares, or releases these to anyone automatically. A human always
          has to sign in and choose to view one.
        </p>
      </div>

      {!loaded ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : forbidden ? (
        <GlassCard>
          <EmptyState
            icon={Lock}
            title="Adults only"
            description="The Digital Estate Vault is visible to adult family members. Ask an adult in your household to add or view documents here."
          />
        </GlassCard>
      ) : (
        <>
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
              className="rounded-2xl p-4 flex flex-col items-center gap-2 bg-tint/[0.04] border border-tint/[0.06] disabled:opacity-50"
            >
              <Upload size={24} className="text-ink-secondary" />
              <span className="text-sm font-semibold text-ink-secondary">Choose File</span>
            </motion.button>
          </div>

          <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={handleFileSelect} className="hidden" />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileSelect} className="hidden" />

          {uploading && (
            <div className="flex items-center gap-2 text-sm text-ink-tertiary">
              <Loader2 size={16} className="animate-spin" />
              Encrypting and storing...
            </div>
          )}

          {error && (
            <GlassCard className="p-3.5 border-danger/20 flex items-start gap-2">
              <AlertCircle size={16} className="text-danger flex-shrink-0 mt-0.5" />
              <p className="text-xs text-ink-secondary leading-relaxed">{error}</p>
            </GlassCard>
          )}

          <div className="space-y-2">
            <div className="text-sm font-semibold text-ink-secondary px-1">
              Vault documents ({documents.length})
            </div>

            {documents.length === 0 ? (
              <GlassCard>
                <EmptyState
                  icon={FileLock2}
                  title="Nothing in the vault yet"
                  description="Add a will, power of attorney, or other estate document — it's encrypted before it's ever stored."
                />
              </GlassCard>
            ) : (
              documents.map((doc, i) => (
                <motion.div key={doc.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  <GlassCard className="p-4 flex items-center gap-3">
                    <button
                      onClick={() => openPreview(doc)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left active:opacity-70"
                    >
                      <div className="w-10 h-10 rounded-2xl bg-tint/[0.05] flex items-center justify-center flex-shrink-0">
                        <FileLock2 size={18} className="text-ink-secondary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{doc.filename}</div>
                        <div className="text-xs text-ink-tertiary mt-0.5">
                          Added {new Date(doc.uploadedAt).toLocaleDateString()}
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => handleDelete(doc)}
                      disabled={deletingId === doc.id}
                      aria-label={`Delete ${doc.filename}`}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-danger flex-shrink-0 disabled:opacity-50"
                    >
                      {deletingId === doc.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                    </button>
                  </GlassCard>
                </motion.div>
              ))
            )}
          </div>
        </>
      )}

      <AnimatePresence>
        {preview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-modal bg-black/70 flex items-center justify-center p-4"
            onClick={() => setPreview(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass rounded-2xl p-3 max-w-lg w-full max-h-[85vh] flex flex-col"
            >
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="text-sm font-semibold truncate">{preview.filename}</div>
                <button onClick={() => setPreview(null)} aria-label="Close" className="w-7 h-7 rounded-full flex items-center justify-center text-ink-tertiary flex-shrink-0">
                  <X size={16} />
                </button>
              </div>
              {preview.mimeType.startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, not an optimizable remote image
                <img src={preview.url} alt={preview.filename} className="w-full rounded-xl object-contain flex-1 min-h-0" />
              ) : preview.mimeType === 'application/pdf' ? (
                <iframe src={preview.url} title={preview.filename} className="w-full flex-1 min-h-[60vh] rounded-xl border border-tint/[0.06]" />
              ) : (
                <div className="text-sm text-ink-tertiary p-6 text-center">No inline preview for this file type.</div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
