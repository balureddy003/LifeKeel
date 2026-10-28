/**
 * Read-only tool registry (design D3). Tools close over the request's
 * KeelContext, so their argument schemas contain no tenant, user or family
 * id — there is no parameter a model (or injected text) could use to name
 * another household. There are no write tools. tools.test.ts fails CI if a
 * schema grows an id-like key or a tool loses its role gate.
 *
 * Today the orchestrator picks tools deterministically from the classified
 * intent. Model-chosen tool calls are not enabled: they would need a
 * tool-calling extension to the AI task gateway first.
 */
import { z } from 'zod'
import type { Db } from 'mongodb'
import type { KeelContext } from './context.js'
import { findHelp, type HelpMatch } from './help.js'
import { ROUTE_KEYS, isRouteKey, type RouteKey } from './route-keys.js'
import { getSetupState, type SetupState } from './setup-state.js'

export interface KeelTool<Args extends z.ZodTypeAny, Out> {
  name: string
  description: string
  args: Args
  allowedFor: (ctx: KeelContext) => boolean
  run: (ctx: KeelContext, db: Db, args: z.infer<Args>) => Promise<Out>
}

const adultOnly = (ctx: KeelContext) => ctx.hasFamily && !ctx.isMinor

export const TOOL_DEFS = {
  setupGetState: {
    name: 'setup.get_state',
    description: "The user's setup checklist for their own household and role.",
    args: z.object({}).strict(),
    allowedFor: (ctx) => ctx.isMinor === false,
    run: (ctx, db) => getSetupState(db, ctx),
  } satisfies KeelTool<z.ZodObject<Record<string, never>>, SetupState>,

  helpSearch: {
    name: 'help.search',
    description: 'Find reviewed product help for a question and the page the user is on.',
    args: z.object({ query: z.string().max(2000), route: z.string().max(100).optional() }).strict(),
    allowedFor: (ctx) => !ctx.isMinor,
    run: async (_ctx, _db, args) => findHelp(args.query, args.route),
  } satisfies KeelTool<
    z.ZodObject<{ query: z.ZodString; route: z.ZodOptional<z.ZodString> }>,
    HelpMatch | null
  >,

  navigationResolve: {
    name: 'navigation.resolve',
    description: 'Resolve a route key to an in-app path.',
    args: z.object({ route_key: z.string().max(64) }).strict(),
    allowedFor: adultOnly,
    run: async (_ctx, _db, args): Promise<{ route_key: RouteKey; path: string } | null> =>
      isRouteKey(args.route_key)
        ? { route_key: args.route_key, path: ROUTE_KEYS[args.route_key] }
        : null,
  } satisfies KeelTool<
    z.ZodObject<{ route_key: z.ZodString }>,
    { route_key: RouteKey; path: string } | null
  >,
}

export type ToolName = keyof typeof TOOL_DEFS

/** Bind every tool to one request. The caller can only supply `args`. */
export function bindTools(ctx: KeelContext, db: Db) {
  const bind =
    <Args extends z.ZodTypeAny, Out>(tool: KeelTool<Args, Out>) =>
    async (rawArgs: unknown): Promise<Out> => {
      if (!tool.allowedFor(ctx)) throw new Error(`tool ${tool.name} not allowed for this user`)
      return tool.run(ctx, db, tool.args.parse(rawArgs))
    }
  return {
    setupGetState: bind(TOOL_DEFS.setupGetState as KeelTool<z.ZodTypeAny, SetupState>),
    helpSearch: bind(TOOL_DEFS.helpSearch as KeelTool<z.ZodTypeAny, HelpMatch | null>),
    navigationResolve: bind(
      TOOL_DEFS.navigationResolve as KeelTool<
        z.ZodTypeAny,
        { route_key: RouteKey; path: string } | null
      >,
    ),
  }
}
