/**
 * Words for deletion receipts and confirmations (PRD-146). Constants so the
 * advice-rule scan covers them. They say what happened and what the deletion
 * does not cover: never "permanent", "instant" or "none exist".
 */
import type { DeletionReceipt } from './api'

export const RECEIPT_TITLE: Record<DeletionReceipt['kind'], string> = {
  document: 'Document deleted',
  mailbox: 'Mailbox disconnected and what was read deleted',
  account: 'Account deletion',
}

export const STATUS_LINE = {
  erased: 'We checked afterwards and found nothing left.',
  finishing:
    'Some data is still being removed. This finishes automatically and your access is already closed.',
} as const

export const ACCOUNT_CLOSED_NOTE =
  'Your account is closed and signed out on this device. Keep this receipt if you want a record: it is shown once.'

export const DOCUMENT_DELETE_MESSAGE =
  'This removes the file and what Keel read from it. Details you already saved to your profile from it stay there until you change them. Backups can keep a copy until they are overwritten; the receipt says how long.'

export const MAILBOX_DELETE_TITLE = 'Also delete what Keel read from this mailbox?'
export const MAILBOX_DELETE_MESSAGE =
  'This removes the inbox summaries and any attachments saved from this mailbox. Messages in your own mailbox are untouched, and details you saved to your profile stay.'

export const ACCOUNT_DELETE_WARNING =
  'This removes your family’s profile, documents, insights, goals and sign-in, and it can’t be undone. Backups can keep a copy until they are overwritten; your receipt says how long. A record that the deletion happened, with counts and no content, is kept for 7 years.'
