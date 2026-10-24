import type { ConnectorAction } from './ConnectorRegistry.js'

export interface AgentResourceLink {
  label: string
  kind: 'llms' | 'skill' | 'mcp' | 'openapi' | 'github' | 'docs'
  url: string
  description: string
}

export interface AgentToolPack {
  id: string
  label: string
  description: string
  source: string
  allowlist_env: string
  recommended_allowlist: string[]
  resources: AgentResourceLink[]
}

export const X_AGENT_TOOL_PACK: AgentToolPack = {
  id: 'x_agent_tools',
  label: 'X Agent Tools',
  description: 'Agent-native X API tools based on X MCP/OpenAPI operation naming.',
  source: 'https://docs.x.com/tools/ai',
  allowlist_env: 'LIFEKEEL_X_TOOL_ALLOWLIST',
  recommended_allowlist: [
    'createPosts',
    'deletePosts',
    'searchPostsRecent',
    'getPostsById',
    'getUsersMe',
    'getUsersByUsername',
    'likePost',
    'repostPost',
  ],
  resources: [
    {
      label: 'Agent resources',
      kind: 'docs',
      url: 'https://docs.x.com/tools/ai',
      description: 'Index for X agent resources, including MCP, OpenAPI, llms.txt, and skill.md.',
    },
    {
      label: 'llms.txt',
      kind: 'llms',
      url: 'https://docs.x.com/llms.txt',
      description: 'Documentation index for LLM and agent discovery.',
    },
    {
      label: 'skill.md',
      kind: 'skill',
      url: 'https://docs.x.com/skill.md',
      description: 'Capability summary for agent skill builders.',
    },
    {
      label: 'Docs MCP',
      kind: 'mcp',
      url: 'https://docs.x.com/mcp',
      description: 'MCP metadata for searching and reading X documentation.',
    },
    {
      label: 'OpenAPI spec',
      kind: 'openapi',
      url: 'https://api.x.com/2/openapi.json',
      description: 'Machine-readable X API v2 contract for generating future tools.',
    },
    {
      label: 'XMCP',
      kind: 'github',
      url: 'https://github.com/xdevplatform/xmcp',
      description: 'Reference MCP server exposing X API OpenAPI operations as tools.',
    },
  ],
}

export const X_AGENT_ACTIONS: ConnectorAction[] = [
  {
    id: 'createPosts',
    label: 'Create post',
    description: 'Agent tool: publish a single X post.',
    method: 'POST',
    path: '/tweets',
    params: [
      {
        name: 'text',
        label: 'Post text',
        type: 'template',
        required: true,
        description: 'Up to 280 characters',
      },
    ],
    output_schema: { id: 'Created post ID' },
  },
  {
    id: 'createThread',
    label: 'Create thread',
    description: 'Agent tool: publish a thread by posting replies in sequence.',
    method: 'POST',
    path: '/tweets/thread',
    params: [
      {
        name: 'tweets',
        label: 'Thread items',
        type: 'template',
        required: true,
        description: 'JSON array of post text strings',
      },
    ],
    output_schema: { id: 'Last post ID', tweets: 'All created post responses' },
  },
  {
    id: 'replyPost',
    label: 'Reply to post',
    description: 'Agent tool: reply to an existing X post.',
    method: 'POST',
    path: '/tweets',
    params: [
      { name: 'text', label: 'Reply text', type: 'template', required: true },
      { name: 'reply_to_id', label: 'Post ID to reply to', type: 'template', required: true },
    ],
    output_schema: { id: 'Created reply post ID' },
  },
  {
    id: 'deletePosts',
    label: 'Delete post',
    description: "Agent tool: delete one of the authenticated user's posts.",
    method: 'DELETE',
    path: '/tweets/{post_id}',
    params: [{ name: 'post_id', label: 'Post ID', type: 'template', required: true }],
  },
  {
    id: 'getUsersMe',
    label: 'Get authenticated user',
    description: 'Agent tool: resolve the connected X account.',
    method: 'GET',
    path: '/users/me?user.fields=id,name,username,description,verified,public_metrics,profile_image_url',
    params: [],
    output_schema: { id: 'Authenticated user ID', username: 'Authenticated username' },
  },
  {
    id: 'getUsersByUsername',
    label: 'Get user by username',
    description: 'Agent tool: look up an X user profile by username.',
    method: 'GET',
    path: '/users/by/username/{username}?user.fields=id,name,username,verified,public_metrics,profile_image_url',
    params: [{ name: 'username', label: 'Username', type: 'template', required: true }],
    output_schema: { id: 'User ID', username: 'Username' },
  },
  {
    id: 'getPostsById',
    label: 'Get post by ID',
    description: 'Agent tool: fetch a post and public metrics.',
    method: 'GET',
    path: '/tweets/{post_id}?tweet.fields=created_at,author_id,public_metrics,conversation_id,referenced_tweets',
    params: [{ name: 'post_id', label: 'Post ID', type: 'template', required: true }],
    output_schema: { id: 'Post ID', text: 'Post text' },
  },
  {
    id: 'searchPostsRecent',
    label: 'Search recent posts',
    description: 'Agent tool: search recent X posts.',
    method: 'GET',
    path: '/tweets/search/recent?query={query}&max_results={max_results}&tweet.fields=created_at,author_id,public_metrics,conversation_id',
    params: [
      { name: 'query', label: 'Search query', type: 'template', required: true },
      { name: 'max_results', label: 'Max results', type: 'number', required: false, default: 10 },
    ],
    output_schema: { data: 'Matching posts' },
  },
  {
    id: 'likePost',
    label: 'Like post',
    description: 'Agent tool: like a post as the connected user.',
    method: 'POST',
    path: '/users/{user_id}/likes',
    params: [
      { name: 'user_id', label: 'Connected user ID', type: 'template', required: true },
      { name: 'post_id', label: 'Post ID', type: 'template', required: true },
    ],
  },
  {
    id: 'repostPost',
    label: 'Repost',
    description: 'Agent tool: repost a post as the connected user.',
    method: 'POST',
    path: '/users/{user_id}/retweets',
    params: [
      { name: 'user_id', label: 'Connected user ID', type: 'template', required: true },
      { name: 'post_id', label: 'Post ID', type: 'template', required: true },
    ],
  },
]

export function resolveXAgentActions(allowlist?: string): ConnectorAction[] {
  const requested = (allowlist ?? process.env['LIFEKEEL_X_TOOL_ALLOWLIST'] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (requested.length === 0) return X_AGENT_ACTIONS

  const allowed = new Set(requested)
  return X_AGENT_ACTIONS.filter((action) => allowed.has(action.id))
}
