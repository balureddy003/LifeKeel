/**
 * Postiz client — the outbound half of the marketing engine.
 *
 * One integration covers every channel the vertical cares about (X,
 * LinkedIn, Instagram, Facebook, TikTok, …) through Postiz's public API:
 * https://docs.postiz.com/public-api
 *
 * Auth note: connectors/postiz.yaml declares `header: x-api-key`, but the
 * documented public API authenticates with a bare `Authorization: <key>`
 * header — this client follows the docs, not the manifest. The manifest is
 * a pipeline-ingestion contract that nothing calls live today; if it's ever
 * wired, its auth block needs the same correction.
 *
 * Config: POSTIZ_API_KEY (required to publish — absent it, callers get a
 * null client and drafts simply stay drafts), POSTIZ_BASE_URL (optional —
 * Postiz is self-hostable; the OSS default would be
 * https://<your-host>/api/public/v1).
 */

const DEFAULT_BASE_URL = 'https://api.postiz.com/public/v1'

/** Platform identifiers Postiz accepts as settings.__type. Unknown channels
 *  omit settings entirely rather than risk a 400 on an unrecognised type. */
const KNOWN_SETTINGS_TYPES = new Set([
  'x', 'linkedin', 'instagram', 'facebook', 'tiktok', 'youtube',
  'pinterest', 'reddit', 'telegram', 'threads', 'bluesky', 'mastodon',
])

export interface PostizIntegration {
  id: string
  name: string
  /** Postiz's platform tag — 'x', 'linkedin', etc. */
  identifier?: string
  disabled?: boolean
}

export interface CreatePostArgs {
  integrationId: string
  content: string
  /** 'now' publishes immediately; 'schedule' queues for `date`. */
  type: 'now' | 'schedule'
  /** Required by Postiz even for type:'now' — pass `new Date()`. */
  date: Date
  /** Channel tag (e.g. 'x', 'linkedin') — becomes settings.__type when known. */
  channel: string
}

export class PostizClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      throw new Error(`Postiz ${res.status} ${method} ${path}: ${detail}`)
    }
    return res.json() as Promise<T>
  }

  listIntegrations(): Promise<PostizIntegration[]> {
    return this.request<PostizIntegration[]>('GET', '/integrations')
  }

  createPost(args: CreatePostArgs): Promise<unknown> {
    return this.request('POST', '/posts', {
      type: args.type,
      date: args.date.toISOString(),
      shortLink: false,
      tags: [],
      posts: [
        {
          integration: { id: args.integrationId },
          value: [{ content: args.content, image: [] }],
          ...(KNOWN_SETTINGS_TYPES.has(args.channel) ? { settings: { __type: args.channel } } : {}),
        },
      ],
    })
  }
}

/** Null when POSTIZ_API_KEY is unset — callers treat null as "publishing not
 *  configured" rather than throwing at boot. */
export function postizClientFromEnv(): PostizClient | null {
  const key = process.env['POSTIZ_API_KEY']
  if (!key) return null
  return new PostizClient(key, process.env['POSTIZ_BASE_URL'] ?? DEFAULT_BASE_URL)
}
