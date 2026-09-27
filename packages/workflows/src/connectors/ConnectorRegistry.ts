/**
 * Kairos Connector Registry
 *
 * Unified connector abstraction for 30+ SMB integrations.
 * Each connector declares:
 *   - auth method (oauth2 | api_key | basic | webhook_only)
 *   - available actions (POST/GET/PUT mapped to business verbs)
 *   - available triggers (webhook events → normalized EventPayload)
 *   - field mappings (connector schema → Kairos unified schema)
 *
 * Categories:
 *   Finance       Xero, QuickBooks, FreshBooks, Wave
 *   Payments      Stripe, Square, PayPal, GoCardless
 *   CRM           HubSpot, Salesforce, Pipedrive, Zoho
 *   Email         Gmail, Outlook, Mailchimp, Klaviyo, SendGrid
 *   Messaging     Slack, Teams, WhatsApp, Twilio SMS
 *   E-commerce    Shopify, WooCommerce, BigCommerce, Etsy
 *   Reviews       Google Business, Trustpilot, Yelp
 *   Calendar      Google Calendar, Calendly, Acuity
 *   Support       Zendesk, Intercom, Freshdesk, Help Scout
 *   Storage       Google Drive, Dropbox, Notion
 *   Database      Airtable, Google Sheets
 *   Social        LinkedIn, Instagram, Facebook Pages, Twitter/X
 */

import { resolveXAgentActions, X_AGENT_TOOL_PACK } from './XAgentTools.js'
import type { AgentToolPack } from './XAgentTools.js'

export type AuthMethod = 'oauth2' | 'oauth2_kite' | 'api_key' | 'basic' | 'webhook_only' | 'none'

export interface ConnectorAction {
  id: string
  label: string
  description: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string                          // relative path, supports {vars}
  params: ConnectorParam[]
  output_schema?: Record<string, string> // key → description
}

export interface ConnectorTrigger {
  id: string
  label: string
  event_type: string                    // normalized event type emitted
  description: string
  webhook_event: string                 // platform-specific event name
  sample_payload?: Record<string, unknown>
}

export interface ConnectorParam {
  name: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'select' | 'template'
  required: boolean
  description?: string
  options?: string[]                    // for select type
  default?: unknown
}

export interface ConnectorDef {
  id: string
  name: string
  category: ConnectorCategory
  description: string
  icon: string                          // emoji or URL
  color: string                         // hex for UI
  auth: AuthMethod
  base_url: string
  live_base_url?: string
  docs_url?: string
  actions: ConnectorAction[]
  triggers: ConnectorTrigger[]
  tags: string[]
  agent_tool_pack?: AgentToolPack
  /** ISO 3166-1 alpha-2 country codes where this connector is available.
   * Empty/undefined means global — available in all countries.
   * Used by the UI to filter connectors by the tenant's country. */
  supported_countries?: string[]
}

export type ConnectorCategory =
  | 'finance'
  | 'payments'
  | 'crm'
  | 'email'
  | 'messaging'
  | 'ecommerce'
  | 'reviews'
  | 'calendar'
  | 'support'
  | 'storage'
  | 'database'
  | 'social'
  | 'blogging'
  | 'investment'
  | 'internal'

// ── Connector Definitions ─────────────────────────────────────────────────────

export const CONNECTORS: ConnectorDef[] = [

  // ── FINANCE ──────────────────────────────────────────────────────────────

  {
    id: 'xero',
    name: 'Xero',
    category: 'finance',
    description: 'Cloud accounting: invoices, bills, bank reconciliation',
    icon: '💼',
    color: '#13B5EA',
    auth: 'oauth2',
    base_url: 'https://api.xero.com/api.xro/2.0',
    docs_url: 'https://developer.xero.com/documentation',
    tags: ['accounting', 'invoices', 'payroll'],
    actions: [
      { id: 'get_invoices', label: 'Get invoices', description: 'Fetch invoices with optional filters', method: 'GET', path: '/Invoices', params: [
        { name: 'Status', label: 'Status', type: 'select', required: false, options: ['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID', 'OVERDUE'] },
        { name: 'DateFrom', label: 'Date from', type: 'string', required: false },
      ], output_schema: { invoices: 'Array of invoice objects' } },
      { id: 'create_invoice', label: 'Create invoice', description: 'Create a new sales invoice', method: 'POST', path: '/Invoices', params: [
        { name: 'ContactID', label: 'Contact ID', type: 'template', required: true },
        { name: 'LineItems', label: 'Line items (JSON)', type: 'template', required: true },
        { name: 'DueDate', label: 'Due date', type: 'template', required: false },
      ]},
      { id: 'send_invoice', label: 'Send invoice by email', description: 'Email invoice to contact', method: 'POST', path: '/Invoices/{InvoiceID}/Email', params: [
        { name: 'InvoiceID', label: 'Invoice ID', type: 'template', required: true },
      ]},
      { id: 'get_contacts', label: 'Get contacts', description: 'List all contacts/customers', method: 'GET', path: '/Contacts', params: [] },
      { id: 'get_account_summary', label: 'Get P&L summary', description: 'Fetch profit & loss report', method: 'GET', path: '/Reports/ProfitAndLoss', params: [
        { name: 'fromDate', label: 'From date', type: 'string', required: false },
        { name: 'toDate', label: 'To date', type: 'string', required: false },
      ]},
    ],
    triggers: [
      { id: 'invoice_paid', label: 'Invoice paid', event_type: 'finance.invoice.paid', webhook_event: 'INVOICE', description: 'Fires when an invoice is marked as paid' },
      { id: 'invoice_overdue', label: 'Invoice overdue', event_type: 'finance.invoice.overdue', webhook_event: 'INVOICE', description: 'Fires when an invoice passes its due date' },
      { id: 'new_contact', label: 'New contact added', event_type: 'finance.contact.created', webhook_event: 'CONTACT', description: 'New customer or supplier added' },
    ],
  },

  {
    id: 'quickbooks',
    name: 'QuickBooks Online',
    category: 'finance',
    description: 'Accounting, invoicing, and payroll for small businesses',
    icon: '📊',
    color: '#2CA01C',
    auth: 'oauth2',
    base_url: 'https://quickbooks.api.intuit.com/v3/company/{realmId}',
    tags: ['accounting', 'invoices', 'usa'],
    supported_countries: ['US'],
    actions: [
      { id: 'get_invoices', label: 'Get invoices', description: 'Query invoices', method: 'GET', path: '/query?query=SELECT * FROM Invoice', params: [] },
      { id: 'create_invoice', label: 'Create invoice', description: 'Create new invoice', method: 'POST', path: '/invoice', params: [
        { name: 'CustomerRef', label: 'Customer reference', type: 'template', required: true },
        { name: 'Line', label: 'Line items (JSON)', type: 'template', required: true },
      ]},
      { id: 'get_customers', label: 'Get customers', description: 'List customers', method: 'GET', path: '/query?query=SELECT * FROM Customer', params: [] },
    ],
    triggers: [
      { id: 'invoice_created', label: 'Invoice created', event_type: 'finance.invoice.created', webhook_event: 'Invoice', description: 'New invoice created' },
    ],
  },

  // ── PAYMENTS ─────────────────────────────────────────────────────────────

  {
    id: 'stripe',
    name: 'Stripe',
    category: 'payments',
    description: 'Payment processing, subscriptions, and billing',
    icon: '💳',
    color: '#635BFF',
    auth: 'api_key',
    base_url: 'https://api.stripe.com/v1',
    docs_url: 'https://stripe.com/docs/api',
    tags: ['payments', 'subscriptions', 'invoices'],
    actions: [
      { id: 'get_customer', label: 'Get customer', description: 'Retrieve a customer by ID or email', method: 'GET', path: '/customers/{id}', params: [
        { name: 'id', label: 'Customer ID', type: 'template', required: true },
      ]},
      { id: 'create_payment_link', label: 'Create payment link', description: 'Generate a hosted payment page', method: 'POST', path: '/payment_links', params: [
        { name: 'line_items', label: 'Line items (JSON)', type: 'template', required: true },
      ]},
      { id: 'refund_charge', label: 'Refund charge', description: 'Issue a partial or full refund', method: 'POST', path: '/refunds', params: [
        { name: 'charge', label: 'Charge ID', type: 'template', required: true },
        { name: 'amount', label: 'Amount (pence)', type: 'template', required: false },
        { name: 'reason', label: 'Reason', type: 'select', required: false, options: ['duplicate', 'fraudulent', 'requested_by_customer'] },
      ]},
      { id: 'cancel_subscription', label: 'Cancel subscription', description: 'Cancel at period end', method: 'DELETE', path: '/subscriptions/{id}', params: [
        { name: 'id', label: 'Subscription ID', type: 'template', required: true },
      ]},
      { id: 'list_failed_payments', label: 'List failed payments', description: 'Fetch recently failed charges', method: 'GET', path: '/charges?status=failed', params: [] },
    ],
    triggers: [
      { id: 'payment_succeeded', label: 'Payment succeeded', event_type: 'payment.succeeded', webhook_event: 'payment_intent.succeeded', description: 'A payment was successfully processed' },
      { id: 'payment_failed', label: 'Payment failed', event_type: 'payment.failed', webhook_event: 'payment_intent.payment_failed', description: 'A payment attempt failed' },
      { id: 'subscription_cancelled', label: 'Subscription cancelled', event_type: 'subscription.cancelled', webhook_event: 'customer.subscription.deleted', description: 'A subscription was cancelled' },
      { id: 'subscription_past_due', label: 'Subscription past due', event_type: 'subscription.past_due', webhook_event: 'customer.subscription.updated', description: 'A subscription payment is overdue' },
      { id: 'dispute_created', label: 'Dispute/chargeback', event_type: 'payment.dispute', webhook_event: 'charge.dispute.created', description: 'Customer filed a dispute' },
    ],
  },

  // ── CRM ───────────────────────────────────────────────────────────────────

  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'crm',
    description: 'CRM, marketing, sales, and service hub',
    icon: '🧡',
    color: '#FF7A59',
    auth: 'oauth2',
    base_url: 'https://api.hubapi.com',
    tags: ['crm', 'marketing', 'sales'],
    actions: [
      { id: 'create_contact', label: 'Create contact', description: 'Add a new CRM contact', method: 'POST', path: '/crm/v3/objects/contacts', params: [
        { name: 'email', label: 'Email', type: 'template', required: true },
        { name: 'firstname', label: 'First name', type: 'template', required: false },
        { name: 'lastname', label: 'Last name', type: 'template', required: false },
        { name: 'phone', label: 'Phone', type: 'template', required: false },
      ]},
      { id: 'update_contact', label: 'Update contact', description: 'Update contact properties', method: 'PATCH', path: '/crm/v3/objects/contacts/{id}', params: [
        { name: 'id', label: 'Contact ID', type: 'template', required: true },
        { name: 'properties', label: 'Properties (JSON)', type: 'template', required: true },
      ]},
      { id: 'create_deal', label: 'Create deal', description: 'Open a new sales deal', method: 'POST', path: '/crm/v3/objects/deals', params: [
        { name: 'dealname', label: 'Deal name', type: 'template', required: true },
        { name: 'amount', label: 'Amount', type: 'template', required: false },
        { name: 'dealstage', label: 'Stage', type: 'template', required: true },
      ]},
      { id: 'log_activity', label: 'Log note/activity', description: 'Add a note to a contact', method: 'POST', path: '/crm/v3/objects/notes', params: [
        { name: 'hs_note_body', label: 'Note text', type: 'template', required: true },
        { name: 'contact_id', label: 'Contact ID', type: 'template', required: true },
      ]},
      { id: 'add_to_list', label: 'Add to marketing list', description: 'Enroll contact in a list', method: 'POST', path: '/contacts/v1/lists/{listId}/add', params: [
        { name: 'listId', label: 'List ID', type: 'template', required: true },
        { name: 'email', label: 'Email', type: 'template', required: true },
      ]},
    ],
    triggers: [
      { id: 'contact_created', label: 'Contact created', event_type: 'crm.contact.created', webhook_event: 'contact.creation', description: 'New contact added to CRM' },
      { id: 'deal_stage_changed', label: 'Deal stage changed', event_type: 'crm.deal.stage_changed', webhook_event: 'deal.propertyChange', description: 'Deal moved to new stage' },
    ],
  },

  {
    id: 'pipedrive',
    name: 'Pipedrive',
    category: 'crm',
    description: 'Sales CRM and pipeline management',
    icon: '🔵',
    color: '#172B4D',
    auth: 'api_key',
    base_url: 'https://api.pipedrive.com/v1',
    tags: ['crm', 'sales', 'pipeline'],
    actions: [
      { id: 'create_person', label: 'Create person', description: 'Add a new person/contact', method: 'POST', path: '/persons', params: [
        { name: 'name', label: 'Full name', type: 'template', required: true },
        { name: 'email', label: 'Email', type: 'template', required: false },
      ]},
      { id: 'create_deal', label: 'Create deal', description: 'Open a deal in the pipeline', method: 'POST', path: '/deals', params: [
        { name: 'title', label: 'Deal title', type: 'template', required: true },
        { name: 'value', label: 'Value', type: 'template', required: false },
      ]},
      { id: 'add_note', label: 'Add note', description: 'Log a note to a deal', method: 'POST', path: '/notes', params: [
        { name: 'content', label: 'Note content', type: 'template', required: true },
        { name: 'deal_id', label: 'Deal ID', type: 'template', required: false },
      ]},
    ],
    triggers: [
      { id: 'deal_created', label: 'Deal created', event_type: 'crm.deal.created', webhook_event: 'deal.added', description: 'New deal opened' },
    ],
  },

  // ── EMAIL ─────────────────────────────────────────────────────────────────

  {
    id: 'gmail',
    name: 'Gmail',
    category: 'email',
    description: 'Send, read, and manage Gmail messages and threads',
    icon: '📧',
    color: '#EA4335',
    auth: 'oauth2',
    base_url: 'https://gmail.googleapis.com/gmail/v1/users/me',
    tags: ['email', 'google', 'inbox'],
    actions: [
      { id: 'send_email', label: 'Send email', description: 'Send an email from the connected account', method: 'POST', path: '/messages/send', params: [
        { name: 'to', label: 'To (email)', type: 'template', required: true },
        { name: 'subject', label: 'Subject', type: 'template', required: true },
        { name: 'body', label: 'Body (HTML)', type: 'template', required: true },
        { name: 'cc', label: 'CC', type: 'template', required: false },
      ]},
      { id: 'reply_to_thread', label: 'Reply to thread', description: 'Reply in an existing email thread', method: 'POST', path: '/messages/send', params: [
        { name: 'threadId', label: 'Thread ID', type: 'template', required: true },
        { name: 'body', label: 'Reply body', type: 'template', required: true },
      ]},
      { id: 'search_emails', label: 'Search emails', description: 'Search inbox with Gmail query syntax', method: 'GET', path: '/messages?q={query}', params: [
        { name: 'query', label: 'Search query', type: 'template', required: true },
        { name: 'maxResults', label: 'Max results', type: 'number', required: false, default: 10 },
      ]},
      { id: 'create_draft', label: 'Create draft', description: 'Save an email as draft', method: 'POST', path: '/drafts', params: [
        { name: 'to', label: 'To', type: 'template', required: true },
        { name: 'subject', label: 'Subject', type: 'template', required: true },
        { name: 'body', label: 'Body', type: 'template', required: true },
      ]},
    ],
    triggers: [
      { id: 'email_received', label: 'Email received', event_type: 'email.received', webhook_event: 'gmail.new_message', description: 'New email arrives in inbox' },
    ],
  },

  {
    id: 'mailchimp',
    name: 'Mailchimp',
    category: 'email',
    description: 'Email marketing campaigns and automation',
    icon: '🐒',
    color: '#FFE01B',
    auth: 'oauth2',
    base_url: 'https://{server}.api.mailchimp.com/3.0',
    tags: ['email', 'marketing', 'campaigns'],
    actions: [
      { id: 'add_subscriber', label: 'Add subscriber', description: 'Add a contact to a list', method: 'POST', path: '/lists/{listId}/members', params: [
        { name: 'listId', label: 'Audience ID', type: 'template', required: true },
        { name: 'email_address', label: 'Email', type: 'template', required: true },
        { name: 'status', label: 'Status', type: 'select', required: true, options: ['subscribed', 'pending', 'unsubscribed'] },
        { name: 'merge_fields', label: 'Merge fields (JSON)', type: 'template', required: false },
      ]},
      { id: 'tag_subscriber', label: 'Tag subscriber', description: 'Add tags to a subscriber', method: 'POST', path: '/lists/{listId}/members/{subscriberHash}/tags', params: [
        { name: 'listId', label: 'Audience ID', type: 'template', required: true },
        { name: 'email', label: 'Email', type: 'template', required: true },
        { name: 'tags', label: 'Tags (comma-separated)', type: 'template', required: true },
      ]},
      { id: 'send_campaign', label: 'Send campaign', description: 'Trigger send of a scheduled campaign', method: 'POST', path: '/campaigns/{campaignId}/actions/send', params: [
        { name: 'campaignId', label: 'Campaign ID', type: 'template', required: true },
      ]},
    ],
    triggers: [
      { id: 'unsubscribe', label: 'Subscriber unsubscribed', event_type: 'email.unsubscribed', webhook_event: 'unsubscribe', description: 'User opts out of mailing list' },
    ],
  },

  {
    id: 'sendgrid',
    name: 'SendGrid',
    category: 'email',
    description: 'Transactional and marketing email delivery',
    icon: '✉️',
    color: '#1A82E2',
    auth: 'api_key',
    base_url: 'https://api.sendgrid.com/v3',
    tags: ['email', 'transactional'],
    actions: [
      { id: 'send_email', label: 'Send email', description: 'Send transactional email', method: 'POST', path: '/mail/send', params: [
        { name: 'to', label: 'To email', type: 'template', required: true },
        { name: 'from', label: 'From email', type: 'template', required: true },
        { name: 'subject', label: 'Subject', type: 'template', required: true },
        { name: 'html_content', label: 'HTML body', type: 'template', required: true },
      ]},
      { id: 'send_template', label: 'Send template email', description: 'Use a dynamic template', method: 'POST', path: '/mail/send', params: [
        { name: 'to', label: 'To email', type: 'template', required: true },
        { name: 'template_id', label: 'Template ID', type: 'template', required: true },
        { name: 'dynamic_template_data', label: 'Template data (JSON)', type: 'template', required: false },
      ]},
    ],
    triggers: [],
  },

  // ── MESSAGING ────────────────────────────────────────────────────────────

  {
    id: 'slack',
    name: 'Slack',
    category: 'messaging',
    description: 'Team messaging, channels, and notifications',
    icon: '💬',
    color: '#4A154B',
    auth: 'oauth2',
    base_url: 'https://slack.com/api',
    tags: ['messaging', 'team', 'notifications'],
    actions: [
      { id: 'send_message', label: 'Send message', description: 'Post a message to a channel or DM', method: 'POST', path: '/chat.postMessage', params: [
        { name: 'channel', label: 'Channel (#name or @user)', type: 'template', required: true },
        { name: 'text', label: 'Message text', type: 'template', required: true },
        { name: 'blocks', label: 'Rich blocks (JSON)', type: 'template', required: false },
      ]},
      { id: 'send_dm', label: 'Send direct message', description: 'DM a specific user', method: 'POST', path: '/chat.postMessage', params: [
        { name: 'user_email', label: 'User email', type: 'template', required: true },
        { name: 'text', label: 'Message text', type: 'template', required: true },
      ]},
      { id: 'create_channel', label: 'Create channel', description: 'Create a new Slack channel', method: 'POST', path: '/conversations.create', params: [
        { name: 'name', label: 'Channel name', type: 'template', required: true },
      ]},
      { id: 'invite_to_channel', label: 'Invite to channel', description: 'Add users to a channel', method: 'POST', path: '/conversations.invite', params: [
        { name: 'channel', label: 'Channel ID', type: 'template', required: true },
        { name: 'users', label: 'User IDs (comma-separated)', type: 'template', required: true },
      ]},
    ],
    triggers: [
      { id: 'message_received', label: 'Message received', event_type: 'messaging.message.received', webhook_event: 'message', description: 'New message in a monitored channel' },
      { id: 'mention', label: 'App mentioned', event_type: 'messaging.mention', webhook_event: 'app_mention', description: 'App was @mentioned' },
    ],
  },

  {
    id: 'twilio',
    name: 'Twilio SMS',
    category: 'messaging',
    description: 'SMS, voice, and WhatsApp messaging',
    icon: '📱',
    color: '#F22F46',
    auth: 'api_key',
    base_url: 'https://api.twilio.com/2010-04-01',
    tags: ['sms', 'whatsapp', 'voice'],
    actions: [
      { id: 'send_sms', label: 'Send SMS', description: 'Send a text message', method: 'POST', path: '/Accounts/{AccountSid}/Messages.json', params: [
        { name: 'To', label: 'To phone (+E.164)', type: 'template', required: true },
        { name: 'From', label: 'From number', type: 'template', required: true },
        { name: 'Body', label: 'Message body', type: 'template', required: true },
      ]},
      { id: 'send_whatsapp', label: 'Send WhatsApp', description: 'Send via WhatsApp Business', method: 'POST', path: '/Accounts/{AccountSid}/Messages.json', params: [
        { name: 'To', label: 'To (whatsapp:+number)', type: 'template', required: true },
        { name: 'From', label: 'From (whatsapp:+number)', type: 'template', required: true },
        { name: 'Body', label: 'Message', type: 'template', required: true },
      ]},
    ],
    triggers: [
      { id: 'sms_received', label: 'SMS received', event_type: 'messaging.sms.received', webhook_event: 'sms.inbound', description: 'Inbound SMS received' },
    ],
  },

  // ── E-COMMERCE ───────────────────────────────────────────────────────────

  {
    id: 'shopify',
    name: 'Shopify',
    category: 'ecommerce',
    description: 'E-commerce orders, products, and customers',
    icon: '🛍️',
    color: '#96BF48',
    auth: 'oauth2',
    base_url: 'https://{shop}.myshopify.com/admin/api/2024-01',
    tags: ['ecommerce', 'orders', 'inventory'],
    actions: [
      { id: 'get_order', label: 'Get order', description: 'Fetch order details', method: 'GET', path: '/orders/{id}.json', params: [
        { name: 'id', label: 'Order ID', type: 'template', required: true },
      ]},
      { id: 'update_order', label: 'Update order', description: 'Update order tags or notes', method: 'PUT', path: '/orders/{id}.json', params: [
        { name: 'id', label: 'Order ID', type: 'template', required: true },
        { name: 'tags', label: 'Tags', type: 'template', required: false },
        { name: 'note', label: 'Note', type: 'template', required: false },
      ]},
      { id: 'create_discount', label: 'Create discount code', description: 'Generate a unique discount code', method: 'POST', path: '/price_rules/{priceRuleId}/discount_codes.json', params: [
        { name: 'priceRuleId', label: 'Price rule ID', type: 'template', required: true },
        { name: 'code', label: 'Discount code', type: 'template', required: false },
      ]},
      { id: 'send_email', label: 'Send order email', description: 'Trigger a transactional email', method: 'POST', path: '/orders/{id}/send_invoice.json', params: [
        { name: 'id', label: 'Order ID', type: 'template', required: true },
      ]},
    ],
    triggers: [
      { id: 'order_created', label: 'Order created', event_type: 'ecommerce.order.created', webhook_event: 'orders/create', description: 'New order placed' },
      { id: 'order_fulfilled', label: 'Order fulfilled', event_type: 'ecommerce.order.fulfilled', webhook_event: 'orders/fulfilled', description: 'Order shipped' },
      { id: 'cart_abandoned', label: 'Cart abandoned', event_type: 'ecommerce.cart.abandoned', webhook_event: 'checkouts/create', description: 'Checkout started but not completed' },
      { id: 'refund_created', label: 'Refund issued', event_type: 'ecommerce.refund.created', webhook_event: 'refunds/create', description: 'Order refunded' },
    ],
  },

  // ── REVIEWS ───────────────────────────────────────────────────────────────

  {
    id: 'google_business',
    name: 'Google Business',
    category: 'reviews',
    description: 'Google Business Profile: reviews and Q&A',
    icon: '⭐',
    color: '#4285F4',
    auth: 'oauth2',
    base_url: 'https://mybusiness.googleapis.com/v4',
    tags: ['reviews', 'google', 'reputation'],
    actions: [
      { id: 'reply_to_review', label: 'Reply to review', description: 'Post a reply to a Google review', method: 'PUT', path: '/accounts/{accountName}/locations/{locationName}/reviews/{reviewId}/reply', params: [
        { name: 'reviewId', label: 'Review ID', type: 'template', required: true },
        { name: 'comment', label: 'Reply text', type: 'template', required: true },
      ]},
      { id: 'get_reviews', label: 'Get reviews', description: 'Fetch recent reviews', method: 'GET', path: '/accounts/{accountName}/locations/{locationName}/reviews', params: [
        { name: 'pageSize', label: 'Page size', type: 'number', required: false, default: 20 },
      ]},
    ],
    triggers: [
      { id: 'new_review', label: 'New review', event_type: 'review.created', webhook_event: 'review.new', description: 'New Google review received' },
    ],
  },

  {
    id: 'trustpilot',
    name: 'Trustpilot',
    category: 'reviews',
    description: 'Collect, manage, and respond to Trustpilot reviews',
    icon: '🌟',
    color: '#00B67A',
    auth: 'oauth2',
    base_url: 'https://api.trustpilot.com/v1',
    tags: ['reviews', 'reputation'],
    actions: [
      { id: 'reply_to_review', label: 'Reply to review', description: 'Post a business reply', method: 'POST', path: '/private/business-units/{businessUnitId}/reviews/{reviewId}/reply', params: [
        { name: 'reviewId', label: 'Review ID', type: 'template', required: true },
        { name: 'message', label: 'Reply message', type: 'template', required: true },
      ]},
      { id: 'invite_customer', label: 'Invite customer to review', description: 'Send a review invitation', method: 'POST', path: '/private/business-units/{businessUnitId}/invitations/email-invitations', params: [
        { name: 'email', label: 'Customer email', type: 'template', required: true },
        { name: 'name', label: 'Customer name', type: 'template', required: true },
      ]},
    ],
    triggers: [
      { id: 'new_review', label: 'New review', event_type: 'review.created', webhook_event: 'review.created', description: 'New Trustpilot review posted' },
    ],
  },

  // ── CALENDAR ─────────────────────────────────────────────────────────────

  {
    id: 'google_calendar',
    name: 'Google Calendar',
    category: 'calendar',
    description: 'Schedule, update, and manage calendar events',
    icon: '📅',
    color: '#4285F4',
    auth: 'oauth2',
    base_url: 'https://www.googleapis.com/calendar/v3',
    tags: ['calendar', 'scheduling', 'google'],
    actions: [
      { id: 'create_event', label: 'Create event', description: 'Add an event to calendar', method: 'POST', path: '/calendars/{calendarId}/events', params: [
        { name: 'summary', label: 'Event title', type: 'template', required: true },
        { name: 'start', label: 'Start (ISO datetime)', type: 'template', required: true },
        { name: 'end', label: 'End (ISO datetime)', type: 'template', required: true },
        { name: 'attendees', label: 'Attendee emails (JSON array)', type: 'template', required: false },
        { name: 'description', label: 'Description', type: 'template', required: false },
      ]},
      { id: 'list_events', label: 'List upcoming events', description: 'Get events in a time range', method: 'GET', path: '/calendars/{calendarId}/events', params: [
        { name: 'timeMin', label: 'From (ISO)', type: 'template', required: false },
        { name: 'timeMax', label: 'To (ISO)', type: 'template', required: false },
        { name: 'maxResults', label: 'Max results', type: 'number', required: false, default: 10 },
      ]},
    ],
    triggers: [
      { id: 'event_starting', label: 'Event starting soon', event_type: 'calendar.event.starting', webhook_event: 'calendar.event.updated', description: 'Event is about to start' },
    ],
  },

  {
    id: 'calendly',
    name: 'Calendly',
    category: 'calendar',
    description: 'Scheduling automation and booking management',
    icon: '🗓️',
    color: '#006BFF',
    auth: 'oauth2',
    base_url: 'https://api.calendly.com',
    tags: ['scheduling', 'bookings'],
    actions: [
      { id: 'get_scheduled_events', label: 'Get bookings', description: 'Fetch upcoming scheduled events', method: 'GET', path: '/scheduled_events', params: [
        { name: 'min_start_time', label: 'From (ISO)', type: 'template', required: false },
        { name: 'max_start_time', label: 'To (ISO)', type: 'template', required: false },
      ]},
      { id: 'cancel_event', label: 'Cancel booking', description: 'Cancel a scheduled event', method: 'POST', path: '/scheduled_events/{uuid}/cancellation', params: [
        { name: 'uuid', label: 'Event UUID', type: 'template', required: true },
        { name: 'reason', label: 'Cancellation reason', type: 'template', required: false },
      ]},
    ],
    triggers: [
      { id: 'booking_created', label: 'Booking made', event_type: 'calendar.booking.created', webhook_event: 'invitee.created', description: 'New appointment booked' },
      { id: 'booking_cancelled', label: 'Booking cancelled', event_type: 'calendar.booking.cancelled', webhook_event: 'invitee.canceled', description: 'Appointment was cancelled' },
    ],
  },

  // ── SUPPORT ───────────────────────────────────────────────────────────────

  {
    id: 'zendesk',
    name: 'Zendesk',
    category: 'support',
    description: 'Customer support tickets, agents, and automations',
    icon: '🎧',
    color: '#03363D',
    auth: 'api_key',
    base_url: 'https://{subdomain}.zendesk.com/api/v2',
    tags: ['support', 'tickets', 'helpdesk'],
    actions: [
      { id: 'create_ticket', label: 'Create ticket', description: 'Open a new support ticket', method: 'POST', path: '/tickets.json', params: [
        { name: 'subject', label: 'Subject', type: 'template', required: true },
        { name: 'description', label: 'Description', type: 'template', required: true },
        { name: 'requester_email', label: 'Customer email', type: 'template', required: false },
        { name: 'priority', label: 'Priority', type: 'select', required: false, options: ['low', 'normal', 'high', 'urgent'] },
        { name: 'tags', label: 'Tags (JSON array)', type: 'template', required: false },
      ]},
      { id: 'update_ticket', label: 'Update ticket', description: 'Change status or add a comment', method: 'PUT', path: '/tickets/{id}.json', params: [
        { name: 'id', label: 'Ticket ID', type: 'template', required: true },
        { name: 'status', label: 'Status', type: 'select', required: false, options: ['open', 'pending', 'solved', 'closed'] },
        { name: 'comment', label: 'Comment', type: 'template', required: false },
      ]},
      { id: 'add_internal_note', label: 'Add internal note', description: 'Add agent-only note', method: 'PUT', path: '/tickets/{id}.json', params: [
        { name: 'id', label: 'Ticket ID', type: 'template', required: true },
        { name: 'note', label: 'Note text', type: 'template', required: true },
      ]},
    ],
    triggers: [
      { id: 'ticket_created', label: 'Ticket created', event_type: 'support.ticket.created', webhook_event: 'ticket_created', description: 'New support ticket opened' },
      { id: 'ticket_escalated', label: 'Ticket escalated', event_type: 'support.ticket.escalated', webhook_event: 'ticket_priority_change', description: 'Ticket marked urgent' },
    ],
  },

  // ── STORAGE / DATABASE ────────────────────────────────────────────────────

  {
    id: 'google_sheets',
    name: 'Google Sheets',
    category: 'database',
    description: 'Read and write rows to Google Sheets spreadsheets',
    icon: '📗',
    color: '#34A853',
    auth: 'oauth2',
    base_url: 'https://sheets.googleapis.com/v4/spreadsheets',
    tags: ['spreadsheet', 'data', 'google'],
    actions: [
      { id: 'append_row', label: 'Append row', description: 'Add a new row to a sheet', method: 'POST', path: '/{spreadsheetId}/values/{range}:append', params: [
        { name: 'spreadsheetId', label: 'Spreadsheet ID', type: 'template', required: true },
        { name: 'range', label: 'Range (e.g. Sheet1!A:Z)', type: 'template', required: true },
        { name: 'values', label: 'Row values (JSON array)', type: 'template', required: true },
      ]},
      { id: 'get_rows', label: 'Get rows', description: 'Read rows from a sheet', method: 'GET', path: '/{spreadsheetId}/values/{range}', params: [
        { name: 'spreadsheetId', label: 'Spreadsheet ID', type: 'template', required: true },
        { name: 'range', label: 'Range', type: 'template', required: true },
      ]},
    ],
    triggers: [],
  },

  {
    id: 'airtable',
    name: 'Airtable',
    category: 'database',
    description: 'Create, read, and update Airtable records',
    icon: '🗃️',
    color: '#FCB400',
    auth: 'api_key',
    base_url: 'https://api.airtable.com/v0',
    tags: ['database', 'no-code', 'records'],
    actions: [
      { id: 'create_record', label: 'Create record', description: 'Add a new row to a base', method: 'POST', path: '/{baseId}/{tableName}', params: [
        { name: 'baseId', label: 'Base ID', type: 'template', required: true },
        { name: 'tableName', label: 'Table name', type: 'template', required: true },
        { name: 'fields', label: 'Fields (JSON)', type: 'template', required: true },
      ]},
      { id: 'update_record', label: 'Update record', description: 'Modify an existing record', method: 'PATCH', path: '/{baseId}/{tableName}/{recordId}', params: [
        { name: 'baseId', label: 'Base ID', type: 'template', required: true },
        { name: 'tableName', label: 'Table name', type: 'template', required: true },
        { name: 'recordId', label: 'Record ID', type: 'template', required: true },
        { name: 'fields', label: 'Fields to update (JSON)', type: 'template', required: true },
      ]},
      { id: 'list_records', label: 'List records', description: 'Query records with a filter', method: 'GET', path: '/{baseId}/{tableName}', params: [
        { name: 'baseId', label: 'Base ID', type: 'template', required: true },
        { name: 'tableName', label: 'Table name', type: 'template', required: true },
        { name: 'filterByFormula', label: 'Filter formula', type: 'template', required: false },
      ]},
    ],
    triggers: [],
  },

  // ── SOCIAL ────────────────────────────────────────────────────────────────

  {
    id: 'linkedin',
    name: 'LinkedIn',
    category: 'social',
    description: 'Post updates, manage company page, and engage',
    icon: '🔗',
    color: '#0077B5',
    auth: 'oauth2',
    base_url: 'https://api.linkedin.com/v2',
    tags: ['social', 'b2b', 'posts'],
    actions: [
      { id: 'create_post', label: 'Create post', description: 'Publish a post on company page', method: 'POST', path: '/ugcPosts', params: [
        { name: 'text', label: 'Post text', type: 'template', required: true },
        { name: 'author', label: 'Author URN', type: 'template', required: true },
      ]},
    ],
    triggers: [],
  },

  // ── SOCIAL (extended) ────────────────────────────────────────────────────

  {
    id: 'twitter_x',
    name: 'Twitter / X',
    category: 'social',
    description: 'Post tweets, threads, and replies on Twitter / X',
    icon: '🐦',
    color: '#1DA1F2',
    auth: 'oauth2',
    base_url: 'https://api.x.com/2',
    docs_url: 'https://docs.x.com/tools/ai',
    tags: ['social', 'twitter', 'x', 'posts', 'threads'],
    actions: resolveXAgentActions(),
    triggers: [
      { id: 'mention_received', label: 'Mention received', event_type: 'twitter.mention', webhook_event: 'tweet_create_events', description: 'Fired when your account is @mentioned' },
    ],
    agent_tool_pack: X_AGENT_TOOL_PACK,
  },

  {
    id: 'facebook_pages',
    name: 'Facebook Pages',
    category: 'social',
    description: 'Post to Facebook business pages, respond to comments',
    icon: '📘',
    color: '#1877F2',
    auth: 'oauth2',
    base_url: 'https://graph.facebook.com/v19.0',
    tags: ['social', 'facebook', 'posts', 'pages'],
    actions: [
      { id: 'create_post', label: 'Create page post', description: 'Publish a text post on your Facebook page', method: 'POST', path: '/{page_id}/feed', params: [
        { name: 'page_id', label: 'Page ID', type: 'template', required: true },
        { name: 'message', label: 'Post text', type: 'template', required: true },
        { name: 'link', label: 'Link URL (optional)', type: 'template', required: false },
      ]},
      { id: 'create_photo_post', label: 'Post with image', description: 'Publish a post with an attached image', method: 'POST', path: '/{page_id}/photos', params: [
        { name: 'page_id', label: 'Page ID', type: 'template', required: true },
        { name: 'caption', label: 'Caption', type: 'template', required: true },
        { name: 'image_url', label: 'Image URL', type: 'template', required: true },
      ]},
      { id: 'get_post', label: 'Get post metrics', description: 'Read a page post with like/comment/share counts', method: 'GET', path: '/{post_id}?fields=likes.summary(true),comments.summary(true),shares', params: [
        { name: 'post_id', label: 'Post ID', type: 'template', required: true },
      ]},
    ],
    triggers: [
      { id: 'comment_received', label: 'New comment', event_type: 'facebook.comment', webhook_event: 'feed', description: 'Fired when a comment is posted on your page' },
    ],
  },

  {
    id: 'instagram_business',
    name: 'Instagram Business',
    category: 'social',
    description: 'Schedule posts, reels captions, and stories for Instagram business accounts',
    icon: '📸',
    color: '#E1306C',
    auth: 'oauth2',
    base_url: 'https://graph.facebook.com/v19.0',
    tags: ['social', 'instagram', 'posts', 'reels'],
    actions: [
      { id: 'create_post', label: 'Create feed post', description: 'Publish an image/video post with caption', method: 'POST', path: '/{ig_user_id}/media_publish', params: [
        { name: 'ig_user_id', label: 'IG User ID', type: 'template', required: true },
        { name: 'caption', label: 'Caption text', type: 'template', required: true },
        { name: 'image_url', label: 'Image URL', type: 'template', required: false },
      ]},
      { id: 'create_story', label: 'Post story', description: 'Publish an image story', method: 'POST', path: '/{ig_user_id}/media_publish', params: [
        { name: 'ig_user_id', label: 'IG User ID', type: 'template', required: true },
        { name: 'image_url', label: 'Story image URL', type: 'template', required: true },
      ]},
      { id: 'get_media', label: 'Get media metrics', description: 'Read an IG media object with like/comment counts', method: 'GET', path: '/{media_id}?fields=like_count,comments_count', params: [
        { name: 'media_id', label: 'Media ID', type: 'template', required: true },
      ]},
    ],
    triggers: [
      { id: 'comment_received', label: 'New comment', event_type: 'instagram.comment', webhook_event: 'comments', description: 'Fired when someone comments on your post' },
    ],
  },

  {
    id: 'threads',
    name: 'Threads',
    category: 'social',
    description: 'Publish text posts and read insights on Threads',
    icon: '🧵',
    color: '#000000',
    auth: 'oauth2',
    base_url: 'https://graph.threads.net/v1.0',
    docs_url: 'https://developers.facebook.com/docs/threads',
    tags: ['social', 'threads', 'meta'],
    // Publishing goes through social-publisher.ts's two-step container→
    // publish handler — the single-call action shape can't express it.
    // These actions cover the read side (engagement polling).
    actions: [
      { id: 'get_me', label: 'Get profile', description: 'Read the connected Threads user', method: 'GET', path: '/me?fields=id,username', params: [] },
      { id: 'get_media_insights', label: 'Get post insights', description: 'Read views/likes/replies/reposts for a post', method: 'GET', path: '/{media_id}/insights?metric=views,likes,replies,reposts,quotes', params: [
        { name: 'media_id', label: 'Media ID', type: 'template', required: true },
      ]},
    ],
    triggers: [],
  },

  {
    id: 'buffer',
    name: 'Buffer',
    category: 'social',
    description: 'Schedule social posts across all channels via Buffer queue',
    icon: '📅',
    color: '#168EEA',
    auth: 'api_key',
    base_url: 'https://api.bufferapp.com/1',
    tags: ['social', 'scheduling', 'queue', 'buffer'],
    actions: [
      { id: 'create_post', label: 'Add to queue', description: 'Add a post to the Buffer posting queue', method: 'POST', path: '/updates/create.json', params: [
        { name: 'text', label: 'Post text', type: 'template', required: true },
        { name: 'profile_ids', label: 'Profile IDs (comma-separated)', type: 'template', required: true },
        { name: 'scheduled_at', label: 'Schedule at (ISO datetime, optional)', type: 'template', required: false },
      ]},
      { id: 'post_now', label: 'Post immediately', description: 'Skip queue and post now', method: 'POST', path: '/updates/create.json', params: [
        { name: 'text', label: 'Post text', type: 'template', required: true },
        { name: 'profile_ids', label: 'Profile IDs (comma-separated)', type: 'template', required: true },
        { name: 'now', label: 'Post immediately', type: 'boolean', required: false, default: true },
      ]},
    ],
    triggers: [],
  },



  {
    id: 'instagram',
    name: 'Instagram',
    category: 'social',
    description: 'Schedule posts, reels captions, and stories for Instagram business accounts',
    icon: '📸',
    color: '#E1306C',
    auth: 'oauth2',
    base_url: 'https://graph.facebook.com/v19.0',
    docs_url: 'https://developers.facebook.com/docs/instagram',
    tags: ['social', 'instagram', 'posts', 'reels', 'stories'],
    actions: [
      { id: 'create_post', label: 'Create feed post', description: 'Publish an image/video post with caption', method: 'POST', path: '/{ig_user_id}/media_publish', params: [
        { name: 'ig_user_id', label: 'IG User ID', type: 'template', required: true },
        { name: 'caption', label: 'Caption text', type: 'template', required: true },
        { name: 'image_url', label: 'Image URL', type: 'template', required: false },
        { name: 'video_url', label: 'Video URL', type: 'template', required: false },
      ]},
      { id: 'create_story', label: 'Post story', description: 'Publish an image story', method: 'POST', path: '/{ig_user_id}/media_publish', params: [
        { name: 'ig_user_id', label: 'IG User ID', type: 'template', required: true },
        { name: 'image_url', label: 'Story image URL', type: 'template', required: true },
      ]},
      { id: 'create_reel', label: 'Create reel', description: 'Publish a reel with caption', method: 'POST', path: '/{ig_user_id}/media_publish', params: [
        { name: 'ig_user_id', label: 'IG User ID', type: 'template', required: true },
        { name: 'video_url', label: 'Reel video URL', type: 'template', required: true },
        { name: 'caption', label: 'Reel caption', type: 'template', required: false },
      ]},
    ],
    triggers: [
      { id: 'comment_received', label: 'New comment', event_type: 'instagram.comment', webhook_event: 'comments', description: 'Fired when someone comments on your post' },
      { id: 'mention_received', label: 'Mention received', event_type: 'instagram.mention', webhook_event: 'mentions', description: 'Fired when your account is mentioned' },
    ],
  },

  {
    id: 'youtube',
    name: 'YouTube',
    category: 'social',
    description: 'Upload videos, manage playlists, and interact with YouTube API (via Postiz Library)',
    icon: '▶️',
    color: '#FF0000',
    auth: 'oauth2',
    base_url: 'https://www.googleapis.com/youtube/v3',
    docs_url: 'https://developers.google.com/youtube/v3',
    tags: ['social', 'youtube', 'video', 'streaming', 'content', 'postiz'],
    actions: [
      { id: 'upload_video', label: 'Upload video', description: 'Upload a video to your YouTube channel', method: 'POST', path: '/upload', params: [
        { name: 'title', label: 'Video title', type: 'template', required: true },
        { name: 'description', label: 'Video description', type: 'template', required: false },
        { name: 'tags', label: 'Tags (comma-separated)', type: 'template', required: false },
        { name: 'privacy_status', label: 'Privacy status', type: 'select', required: false, options: ['public', 'private', 'unlisted', 'scheduled'], default: 'private' },
        { name: 'category_id', label: 'Category ID', type: 'template', required: false },
      ]},
      { id: 'create_playlist', label: 'Create playlist', description: 'Create a new playlist', method: 'POST', path: '/playlists', params: [
        { name: 'title', label: 'Playlist title', type: 'template', required: true },
        { name: 'description', label: 'Playlist description', type: 'template', required: false },
        { name: 'privacy_status', label: 'Privacy status', type: 'select', required: false, options: ['public', 'private', 'unlisted'], default: 'private' },
      ]},
      { id: 'add_to_playlist', label: 'Add video to playlist', description: 'Add a video to an existing playlist', method: 'POST', path: '/playlistItems', params: [
        { name: 'playlist_id', label: 'Playlist ID', type: 'template', required: true },
        { name: 'video_id', label: 'Video ID', type: 'template', required: true },
        { name: 'position', label: 'Position (optional)', type: 'number', required: false },
      ]},
    ],
    triggers: [
      { id: 'video_published', label: 'Video published', event_type: 'youtube.video.published', webhook_event: 'youtube#video#published', description: 'Fired when a video is published on your channel' },
      { id: 'comment_added', label: 'New comment', event_type: 'youtube.comment.added', webhook_event: 'youtube#comment#insert', description: 'Fired when a comment is added to your video' },
    ],
  },

  // ── BLOGGING ────────────────────────────────────────────────────────────

  {
    id: 'medium',
    name: 'Medium',
    category: 'blogging',
    description: 'Publish and manage blog posts on Medium',
    icon: '📝',
    color: '#00AB6C',
    auth: 'api_key',
    base_url: 'https://api.medium.com/v1',
    tags: ['blog', 'medium', 'publishing', 'content'],
    actions: [
      { id: 'create_post', label: 'Publish post', description: 'Create and publish a post on Medium', method: 'POST', path: '/users/{user_id}/posts', params: [
        { name: 'user_id', label: 'Medium User ID', type: 'template', required: true },
        { name: 'title', label: 'Post title', type: 'template', required: true },
        { name: 'content', label: 'Post body (HTML or Markdown)', type: 'template', required: true },
        { name: 'content_format', label: 'Format', type: 'select', required: false, options: ['html', 'markdown'], default: 'markdown' },
        { name: 'publish_status', label: 'Status', type: 'select', required: false, options: ['draft', 'public'], default: 'draft' },
        { name: 'tags', label: 'Tags (comma-separated)', type: 'template', required: false },
        { name: 'canonical_url', label: 'Canonical URL (optional)', type: 'template', required: false },
      ]},
    ],
    triggers: [],
  },

  {
    id: 'ghost',
    name: 'Ghost',
    category: 'blogging',
    description: 'Publish posts to your Ghost blog or newsletter',
    icon: '👻',
    color: '#FF1A75',
    auth: 'api_key',
    base_url: '{ghost_url}/ghost/api/admin',
    tags: ['blog', 'ghost', 'newsletter', 'publishing', 'content'],
    actions: [
      { id: 'create_post', label: 'Create post', description: 'Create a new blog post in Ghost', method: 'POST', path: '/posts/', params: [
        { name: 'title', label: 'Post title', type: 'template', required: true },
        { name: 'html', label: 'Post body (HTML)', type: 'template', required: true },
        { name: 'status', label: 'Status', type: 'select', required: false, options: ['draft', 'published', 'scheduled'], default: 'draft' },
        { name: 'tags', label: 'Tags (JSON array of {name})', type: 'template', required: false },
        { name: 'feature_image', label: 'Feature image URL (optional)', type: 'template', required: false },
        { name: 'custom_excerpt', label: 'Excerpt (optional)', type: 'template', required: false },
      ]},
      { id: 'send_newsletter', label: 'Send newsletter', description: 'Email the post to all newsletter subscribers', method: 'PUT', path: '/posts/{post_id}/', params: [
        { name: 'post_id', label: 'Post ID', type: 'template', required: true },
        { name: 'email_only', label: 'Email only (no blog publish)', type: 'boolean', required: false, default: false },
      ]},
    ],
    triggers: [
      { id: 'post_published', label: 'Post published', event_type: 'ghost.post.published', webhook_event: 'post.published', description: 'Fired when a post goes live' },
      { id: 'member_added', label: 'New member/subscriber', event_type: 'ghost.member.added', webhook_event: 'member.added', description: 'Fired when someone subscribes' },
    ],
  },

  {
    id: 'wordpress',
    name: 'WordPress',
    category: 'blogging',
    description: 'Create and publish posts on WordPress.com or self-hosted sites',
    icon: '🔵',
    color: '#21759B',
    auth: 'basic',
    base_url: '{wordpress_url}/wp-json/wp/v2',
    tags: ['blog', 'wordpress', 'cms', 'publishing', 'content'],
    actions: [
      { id: 'create_post', label: 'Create post', description: 'Create a new WordPress post', method: 'POST', path: '/posts', params: [
        { name: 'title', label: 'Post title', type: 'template', required: true },
        { name: 'content', label: 'Post body (HTML)', type: 'template', required: true },
        { name: 'status', label: 'Status', type: 'select', required: false, options: ['draft', 'publish', 'future'], default: 'draft' },
        { name: 'excerpt', label: 'Excerpt (optional)', type: 'template', required: false },
        { name: 'tags', label: 'Tag IDs (comma-separated)', type: 'template', required: false },
        { name: 'featured_media', label: 'Featured image media ID (optional)', type: 'template', required: false },
      ]},
      { id: 'update_post', label: 'Update post', description: 'Edit an existing post', method: 'PUT', path: '/posts/{post_id}', params: [
        { name: 'post_id', label: 'Post ID', type: 'template', required: true },
        { name: 'title', label: 'New title', type: 'template', required: false },
        { name: 'content', label: 'New content', type: 'template', required: false },
        { name: 'status', label: 'New status', type: 'select', required: false, options: ['draft', 'publish'] },
      ]},
    ],
    triggers: [
      { id: 'post_published', label: 'Post published', event_type: 'wordpress.post.published', webhook_event: 'publish_post', description: 'Fires when a post is published' },
      { id: 'comment_added', label: 'New comment', event_type: 'wordpress.comment.added', webhook_event: 'comment_post', description: 'Fires when a comment is added' },
    ],
  },

  {
    id: 'hashnode',
    name: 'Hashnode',
    category: 'blogging',
    description: 'Publish developer-focused blogs to Hashnode',
    icon: '🔷',
    color: '#2962FF',
    auth: 'api_key',
    base_url: 'https://gql.hashnode.com',
    tags: ['blog', 'hashnode', 'developer', 'content', 'tech'],
    actions: [
      { id: 'create_post', label: 'Publish post', description: 'Create and publish a post on Hashnode', method: 'POST', path: '/', params: [
        { name: 'title', label: 'Post title', type: 'template', required: true },
        { name: 'content_markdown', label: 'Content (Markdown)', type: 'template', required: true },
        { name: 'publication_id', label: 'Publication ID', type: 'template', required: true },
        { name: 'tags', label: 'Tag slugs (JSON array)', type: 'template', required: false },
        { name: 'subtitle', label: 'Subtitle / SEO description', type: 'template', required: false },
      ]},
    ],
    triggers: [],
  },

  // ── INVESTMENT ───────────────────────────────────────────────────────────

  {
    id: 'trading-212',
    name: 'Trading 212',
    category: 'investment',
    // Read-only sync (connectors/trading-212.yaml `resources:`) plus three
    // order-placement write actions below. Write access was enabled as an
    // explicit, dated product decision: personal single-tenant use, the
    // account owner acting on their own Trading 212 account through Kairos
    // as their own assistant — not a multi-tenant offering to other
    // customers, so the PRD's Phase-4 "compliance review" gate (aimed at a
    // firm serving the public) doesn't apply here. What does still apply,
    // and is enforced in packages/engine/src/trading/trade-executor.ts, not
    // here: nothing places an order unless (a) KAIROS_ALLOW_LIVE_TRADING=true,
    // (b) the tenant has opted in via /portfolio/live-trading/opt-in, and
    // (c) the stored credential has extra.live_mode=true — all off by
    // default. This entry must stay factually aligned with
    // connectors/trading-212.yaml (auth type, event naming) — a past drift
    // here silently broke detector matching.
    description: 'Sync of portfolio positions, account summary, and order-fill notifications from Trading 212, plus market-order placement/cancellation gated behind explicit tenant opt-in.',
    icon: '📈',
    color: '#00A3E0',
    auth: 'basic',
    base_url: 'https://demo.trading212.com/api/v0',
    live_base_url: 'https://live.trading212.com/api/v0',
    docs_url: 'https://helpcentre.trading212.com/hc/en-us/articles/14516685101658-API',
    tags: ['trading', 'brokerage', 'portfolio', 'investment', 'stocks', 'etfs'],
    supported_countries: ['GB'],
    actions: [
      { id: 'get_portfolio', label: 'Get portfolio', description: 'Fetch open positions and portfolio value', method: 'GET', path: '/equity/portfolio', params: [
        { name: 'include_positions', label: 'Include positions', type: 'boolean', required: false, default: true },
      ], output_schema: { positions: 'Array of open positions' } },
      { id: 'get_account', label: 'Get account summary', description: 'Fetch cash, invested value, and total account value', method: 'GET', path: '/equity/account', params: [], output_schema: { cash: 'Available cash', total: 'Total account value' } },
      // Cash endpoint — returns availableToTrade, free, invested, total in
      // minor units. Used by momentum-rebalance.ts to verify the broker's
      // actual available cash before deploying, instead of relying on the
      // synced signal (which may be up to 15 min stale).
      { id: 'get_cash', label: 'Get cash balance', description: 'Fetch available-to-trade cash, free cash, and invested balances', method: 'GET', path: '/equity/account/cash', params: [], output_schema: { availableToTrade: 'Available to trade (minor units)', free: 'Free cash (minor units)', invested: 'Invested value (minor units)' } },
      // Market orders only — Trading 212's live (real-money) API currently
      // supports market orders via the public API; limit/stop orders remain
      // demo-only. Quantity sign encodes side: positive = buy, negative =
      // sell (matches Trading 212's own convention, so no side-mapping bug
      // can flip a buy into a sell on the way out).
      { id: 'place_market_order', label: 'Place market order', description: 'Place a market order (positive quantity = buy, negative = sell)', method: 'POST', path: '/equity/orders/market', params: [
        { name: 'ticker', label: 'Ticker', type: 'string', required: true, description: 'Trading 212 instrument code, e.g. AAPL_US_EQ' },
        { name: 'quantity', label: 'Quantity', type: 'number', required: true, description: 'Signed share count: positive buys, negative sells' },
        { name: 'extendedHours', label: 'Allow extended hours', type: 'boolean', required: false, default: false },
      ], output_schema: { id: 'Broker order id', status: 'Order status from Trading 212' } },
      // Phase 2: Limit orders for better execution (saves ~5-10 bps per trade).
      // Trading 212 supports limit orders via POST /equity/orders/limit with
      // ticker, quantity (signed), limitPrice, and timeValidity ('DAY' or 'GTC').
      { id: 'place_limit_order', label: 'Place limit order', description: 'Place a limit order at a specified price (positive quantity = buy, negative = sell)', method: 'POST', path: '/equity/orders/limit', params: [
        { name: 'ticker', label: 'Ticker', type: 'string', required: true, description: 'Trading 212 instrument code, e.g. AAPL_US_EQ' },
        { name: 'quantity', label: 'Quantity', type: 'number', required: true, description: 'Signed share count: positive buys, negative sells' },
        { name: 'limitPrice', label: 'Limit price', type: 'number', required: true, description: 'Maximum price for buy, minimum for sell (in pence)' },
        { name: 'timeValidity', label: 'Time validity', type: 'string', required: false, default: 'DAY', description: 'DAY or GTC (good-til-cancelled)' },
      ], output_schema: { id: 'Broker order id', status: 'Order status from Trading 212' } },
      // Phase 2: Stop orders for automated risk management.
      { id: 'place_stop_order', label: 'Place stop order', description: 'Place a stop order (market order triggered at stop price)', method: 'POST', path: '/equity/orders/stop', params: [
        { name: 'ticker', label: 'Ticker', type: 'string', required: true, description: 'Trading 212 instrument code' },
        { name: 'quantity', label: 'Quantity', type: 'number', required: true, description: 'Signed share count: positive buys, negative sells' },
        { name: 'stopPrice', label: 'Stop price', type: 'number', required: true, description: 'Price that triggers the market order' },
      ], output_schema: { id: 'Broker order id', status: 'Order status from Trading 212' } },
      // Order id type is 'string' in the param schema but the executor coerces
      // numbers to strings — Trading 212 returns numeric order ids (e.g.
      // 55203751789) and we store them as strings for consistent reconciliation.
      { id: 'get_order', label: 'Get order status', description: 'Fetch a specific pending or recently-placed order by id', method: 'GET', path: '/equity/orders/{id}', params: [
        { name: 'id', label: 'Order id', type: 'string', required: true },
      ], output_schema: { status: 'Order status from Trading 212' } },
      // Instrument metadata — used by broker-execution.ts to fetch per-instrument
      // quantityPrecision. The endpoint is rate-limited to 1 req/50s, so the
      // caller caches the full list for 6 hours.
      { id: 'get_instruments', label: 'Get instrument metadata', description: 'Fetch tradable instrument metadata (ticker, quantityPrecision, currency)', method: 'GET', path: '/equity/metadata/instruments', params: [], output_schema: { instruments: 'Array of instrument metadata' } },
      { id: 'cancel_order', label: 'Cancel order', description: 'Cancel a pending order (not guaranteed if already filling)', method: 'DELETE', path: '/equity/orders/{id}', params: [
        { name: 'id', label: 'Order id', type: 'string', required: true },
      ], output_schema: {} },
      // Pie API (deprecated but still operational). Used to create/update a
      // Pie that mirrors the strategy's target allocation, so the user can
      // see and manage the autonomous strategy as a Trading 212 Pie.
      { id: 'get_pies', label: 'Get all pies', description: 'Fetch all pies for the account', method: 'GET', path: '/equity/pies', params: [], output_schema: { pies: 'Array of pie objects' } },
      { id: 'get_pie', label: 'Get pie details', description: 'Fetch a specific pie with detailed instrument allocation', method: 'GET', path: '/equity/pies/{id}', params: [
        { name: 'id', label: 'Pie id', type: 'string', required: true },
      ], output_schema: { pie: 'Pie details with instruments' } },
      { id: 'create_pie', label: 'Create pie', description: 'Create a new pie with a target allocation of instruments', method: 'POST', path: '/equity/pies', params: [
        { name: 'name', label: 'Pie name', type: 'string', required: true },
        { name: 'instruments', label: 'Instruments (JSON array of {ticker, expectedShare})', type: 'template', required: true },
      ], output_schema: { id: 'Pie id' } },
      { id: 'update_pie', label: 'Update pie', description: 'Update an existing pie\'s target allocation', method: 'POST', path: '/equity/pies/{id}', params: [
        { name: 'id', label: 'Pie id', type: 'string', required: true },
        { name: 'name', label: 'Pie name', type: 'string', required: false },
        { name: 'instruments', label: 'Instruments (JSON array of {ticker, expectedShare})', type: 'template', required: true },
      ], output_schema: { id: 'Pie id' } },
    ],
    triggers: [
      { id: 'portfolio_updated', label: 'Portfolio updated', event_type: 'portfolio_position', webhook_event: 'portfolio.updated', description: 'Fired when portfolio positions change' },
      { id: 'order_executed', label: 'Order executed', event_type: 'order_event', webhook_event: 'order.executed', description: 'Fired when an order is filled or cancelled' },
    ],
  },

  {
    id: 'zerodha',
    name: 'Zerodha (Kite Connect)',
    category: 'investment',
    // Read-only sync (connectors/zerodha.yaml `resources:`) plus order-placement
    // write actions below. Zerodha is India's largest broker; Kite Connect v3
    // uses a per-tenant OAuth flow (each tenant registers their own app at
    // developers.kite.trade and stores api_key + api_secret via
    // POST /connectors/zerodha/credentials). See connectors/zerodha.yaml auth
    // notes for the full flow. Order placement endpoints require a static
    // egress IP (NSE retail algo circular) — infra concern, not encoded here.
    // Live trading is gated the same way as Trading 212: KAIROS_ALLOW_LIVE_TRADING,
    // tenant opt-in, and extra.live_mode=true on the credential.
    description: 'Sync of holdings, positions, funds, and order events from Zerodha Kite Connect, plus order placement/cancellation gated behind explicit tenant opt-in.',
    icon: '🪁',
    color: '#387ED1',
    auth: 'oauth2_kite',
    base_url: 'https://api.kite.trade',
    docs_url: 'https://kite.trade/docs/connect/v3/',
    tags: ['trading', 'brokerage', 'portfolio', 'investment', 'india', 'nse', 'bse'],
    supported_countries: ['IN'],
    actions: [
      { id: 'get_holdings', label: 'Get holdings', description: 'Fetch long-term equity holdings from demat account', method: 'GET', path: '/portfolio/holdings', params: [], output_schema: { holdings: 'Array of demat holdings' } },
      { id: 'get_positions', label: 'Get positions', description: 'Fetch intraday and overnight positions', method: 'GET', path: '/portfolio/positions', params: [], output_schema: { net: 'Array of net positions' } },
      { id: 'get_funds', label: 'Get funds & margins', description: 'Fetch available cash and margin balances', method: 'GET', path: '/user/margins', params: [], output_schema: { equity: 'Equity segment margins', commodity: 'Commodity segment margins' } },
      { id: 'place_regular_order', label: 'Place regular order', description: 'Place a CNC (delivery), MIS (intraday), or NRML (overnight) order', method: 'POST', path: '/orders/regular', params: [
        { name: 'exchange', label: 'Exchange', type: 'select', required: true, options: ['NSE', 'BSE', 'NFO', 'BFO', 'MCX', 'CDS'] },
        { name: 'tradingsymbol', label: 'Trading symbol', type: 'string', required: true, description: 'Kite trading symbol, e.g. INFY' },
        { name: 'transaction_type', label: 'Transaction type', type: 'select', required: true, options: ['BUY', 'SELL'] },
        { name: 'quantity', label: 'Quantity', type: 'number', required: true },
        { name: 'product', label: 'Product', type: 'select', required: true, options: ['CNC', 'MIS', 'NRML'] },
        { name: 'order_type', label: 'Order type', type: 'select', required: true, options: ['MARKET', 'LIMIT', 'SL', 'SL-M'] },
        { name: 'price', label: 'Price', type: 'number', required: false, description: 'Required for LIMIT and SL orders' },
        { name: 'trigger_price', label: 'Trigger price', type: 'number', required: false, description: 'Required for SL and SL-M orders' },
      ], output_schema: { order_id: 'Kite order id' } },
      { id: 'get_order', label: 'Get order status', description: 'Fetch a specific order by id', method: 'GET', path: '/orders/{order_id}', params: [
        { name: 'order_id', label: 'Order id', type: 'string', required: true },
      ], output_schema: { status: 'Order status from Kite' } },
      { id: 'cancel_order', label: 'Cancel order', description: 'Cancel a pending order', method: 'DELETE', path: '/orders/{order_id}', params: [
        { name: 'order_id', label: 'Order id', type: 'string', required: true },
      ], output_schema: {} },
    ],
    triggers: [
      { id: 'portfolio_updated', label: 'Portfolio updated', event_type: 'portfolio_position', webhook_event: 'portfolio.updated', description: 'Fired when holdings or positions change' },
      { id: 'order_executed', label: 'Order executed', event_type: 'order_event', webhook_event: 'order.executed', description: 'Fired when an order is filled or cancelled' },
    ],
  },

  {
    id: 'alpha-vantage',
    name: 'Alpha Vantage',
    category: 'investment',
    description: 'Daily market-data backfill for stocks and ETFs. Used to seed price history for momentum, volatility, and trend-following models before enough broker sync snapshots have accumulated.',
    icon: '💹',
    color: '#1F5AF6',
    auth: 'api_key',
    base_url: 'https://www.alphavantage.co',
    docs_url: 'https://www.alphavantage.co/documentation/',
    tags: ['market-data', 'stocks', 'etfs', 'prices', 'investment', 'backfill'],
    actions: [],
    triggers: [
      { id: 'daily_price', label: 'Daily price', event_type: 'market_price', description: 'Daily OHLCV price record for a configured symbol', webhook_event: 'alphavantage.daily.price' },
    ],
  },

  {
    id: 'yfinance',
    name: 'Yahoo Finance (yfinance)',
    category: 'investment',
    description: 'Free 20+ year daily price history and fundamentals via the yfinance Python library. No API key required. Best for backtesting across multiple market regimes.',
    icon: '📈',
    color: '#5F01D1',
    auth: 'none',
    base_url: 'https://query1.finance.yahoo.com',
    docs_url: 'https://github.com/ranaroussi/yfinance',
    tags: ['market-data', 'stocks', 'etfs', 'prices', 'investment', 'backfill', 'free', 'fundamentals'],
    actions: [],
    triggers: [
      { id: 'daily_price', label: 'Daily price', event_type: 'market_price', description: 'Daily OHLCV price record (20+ year history) for a configured symbol', webhook_event: 'yfinance.daily.price' },
      { id: 'fundamentals', label: 'Fundamentals', event_type: 'company_fundamentals', description: 'Income statement, balance sheet, and key ratios for a configured symbol', webhook_event: 'yfinance.fundamentals' },
    ],
  },

  {
    id: 'hf-data',
    name: 'HF Data Library',
    category: 'investment',
    description: 'Free research-grade 1-minute OHLCV bars for 1,391 US stocks since 2002. CC BY 4.0. Clean REST API. Ideal for multi-regime backtesting.',
    icon: '🔬',
    color: '#00897B',
    auth: 'api_key',
    base_url: 'https://api.hfdatalibrary.com/v1',
    docs_url: 'https://hfdatalibrary.com/pages/api',
    tags: ['market-data', 'stocks', 'etfs', 'prices', 'investment', 'backfill', 'free', 'research', 'intraday'],
    actions: [],
    triggers: [
      { id: 'daily_bars', label: 'Daily bars', event_type: 'market_price', description: 'Daily OHLCV bars (aggregated from 1-minute data) for a configured symbol', webhook_event: 'hfdata.daily.bars' },
    ],
  },

  {
    id: 'finnhub',
    name: 'Finnhub',
    category: 'investment',
    description: 'Real-time stock quotes and company fundamentals. Free tier: 60 calls/min. Historical candles require paid plan — use yfinance for history.',
    icon: '🦈',
    color: '#0EA5E9',
    auth: 'api_key',
    base_url: 'https://finnhub.io/api/v1',
    docs_url: 'https://finnhub.io/docs/api',
    tags: ['market-data', 'stocks', 'prices', 'investment', 'fundamentals', 'real-time'],
    actions: [],
    triggers: [
      { id: 'realtime_quote', label: 'Real-time quote', event_type: 'market_price', description: 'Real-time quote (current price, OHLC, previous close) for a configured US symbol', webhook_event: 'finnhub.realtime.quote' },
      { id: 'company_profile', label: 'Company profile', event_type: 'company_fundamentals', description: 'Company profile (market cap, industry, share outstanding) for a configured symbol', webhook_event: 'finnhub.company.profile' },
    ],
  },

  {
    id: 'polygon',
    name: 'Polygon.io',
    category: 'investment',
    description: 'US stock market data. Free tier: 5 calls/min, 2 years daily history, 15min delayed. Paid tiers unlock real-time and 15+ year history.',
    icon: '⬡',
    color: '#635BFF',
    auth: 'api_key',
    base_url: 'https://api.polygon.io',
    docs_url: 'https://polygon.io/docs/stocks',
    tags: ['market-data', 'stocks', 'prices', 'investment', 'fundamentals'],
    actions: [],
    triggers: [
      { id: 'daily_aggs', label: 'Daily aggregates', event_type: 'market_price', description: 'Daily aggregated OHLCV bars for a configured symbol (2 years on free tier)', webhook_event: 'polygon.daily.aggs' },
      { id: 'ticker_details', label: 'Ticker details', event_type: 'company_fundamentals', description: 'Ticker details (name, sector, industry, market cap) for a configured symbol', webhook_event: 'polygon.ticker.details' },
    ],
  },

  // ── INTERNAL ─────────────────────────────────────────────────────────────

  {
    id: 'kairos_webhook',
    name: 'Webhook (generic)',
    category: 'internal',
    description: 'Send or receive data via any HTTP webhook',
    icon: '🔌',
    color: '#6366F1',
    auth: 'none',
    base_url: '',
    tags: ['webhook', 'http', 'generic'],
    actions: [
      { id: 'post_webhook', label: 'POST to URL', description: 'Send JSON payload to any URL', method: 'POST', path: '{url}', params: [
        { name: 'url', label: 'Target URL', type: 'template', required: true },
        { name: 'payload', label: 'Payload (JSON)', type: 'template', required: true },
        { name: 'headers', label: 'Headers (JSON)', type: 'template', required: false },
      ]},
    ],
    triggers: [
      { id: 'webhook_received', label: 'Webhook received', event_type: 'webhook.received', webhook_event: 'kairos.webhook', description: 'Any inbound webhook payload' },
    ],
  },
]

// ── Registry API ───────────────────────────────────────────────────────────────

export class ConnectorRegistry {
  private index: Map<string, ConnectorDef>

  constructor(defs: ConnectorDef[] = CONNECTORS) {
    this.index = new Map(defs.map(c => [c.id, c]))
  }

  all(): ConnectorDef[] {
    return [...this.index.values()]
  }

  get(id: string): ConnectorDef | undefined {
    return this.index.get(id)
  }

  byCategory(category: ConnectorCategory): ConnectorDef[] {
    return this.all().filter(c => c.category === category)
  }

  search(query: string): ConnectorDef[] {
    const q = query.toLowerCase()
    return this.all().filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.tags.some(t => t.includes(q)) ||
      c.description.toLowerCase().includes(q),
    )
  }

  getAction(connectorId: string, actionId: string): ConnectorAction | undefined {
    return this.get(connectorId)?.actions.find(a => a.id === actionId)
  }

  /** Summary for Studio UI — no base_url or auth secrets */
  summary(): Array<{ id: string; name: string; category: ConnectorCategory; icon: string; color: string; action_count: number; trigger_count: number; tags: string[]; supported_countries?: string[] }> {
    return this.all().map(c => ({
      id: c.id,
      name: c.name,
      category: c.category,
      icon: c.icon,
      color: c.color,
      action_count: c.actions.length,
      trigger_count: c.triggers.length,
      tags: c.tags,
      ...(c.supported_countries ? { supported_countries: c.supported_countries } : {}),
    }))
  }
}

export const connectorRegistry = new ConnectorRegistry()
