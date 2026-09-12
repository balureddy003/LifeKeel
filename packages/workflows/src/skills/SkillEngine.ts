/**
 * Kairos Skill Engine
 *
 * 12 reusable AI primitives that any workflow node can call.
 * Each skill is stateless, composable, and has a structured output schema.
 *
 * Skills:
 *   classify      — assign one or more labels from a fixed set
 *   extract       — pull structured fields from unstructured text
 *   summarize     — condense long text to key points
 *   sentiment     — score tone: positive / neutral / negative + intensity
 *   generate      — free-form text generation with persona
 *   translate     — translate to target language
 *   score         — rate a value against a rubric (0–100)
 *   decide        — make a yes/no/maybe decision with reasoning
 *   route         — pick the best path from a list of options
 *   compare       — compare two versions (A/B, before/after)
 *   enrich        — augment structured data with inferred fields
 *   plan          — decompose a goal into ordered steps
 */

export type SkillName =
  | 'classify'
  | 'extract'
  | 'summarize'
  | 'sentiment'
  | 'generate'
  | 'translate'
  | 'score'
  | 'decide'
  | 'route'
  | 'compare'
  | 'enrich'
  | 'plan'

// ── Per-skill config types ─────────────────────────────────────────────────

export interface ClassifyConfig {
  text: string
  labels: string[]           // e.g. ["billing","technical","general"]
  multi?: boolean            // allow multiple labels
  output_key: string
}

export interface ExtractConfig {
  text: string
  fields: Array<{ name: string; description: string; type?: 'string' | 'number' | 'boolean' | 'date' }>
  output_key: string
}

export interface SummarizeConfig {
  text: string
  max_sentences?: number
  style?: 'bullets' | 'paragraph' | 'tldr'
  output_key: string
}

export interface SentimentConfig {
  text: string
  output_key: string         // writes { score: -1..1, label: 'positive'|'neutral'|'negative', confidence: 0..1 }
}

export interface GenerateConfig {
  prompt: string
  persona?: string
  tone?: string
  max_words?: number
  output_key: string
  fallback?: string
}

export interface TranslateConfig {
  text: string
  target_language: string
  output_key: string
}

export interface ScoreConfig {
  subject: string
  rubric: string             // description of what makes a high/low score
  min?: number
  max?: number
  output_key: string         // writes { score: number, reasoning: string }
}

export interface DecideConfig {
  question: string
  context: string
  options?: string[]         // default: ["yes", "no", "escalate"]
  output_key: string         // writes { decision: string, confidence: number, reasoning: string }
}

export interface RouteConfig {
  description: string        // what to route
  routes: Array<{ id: string; label: string; when: string }>
  output_key: string         // writes the matching route id
}

export interface CompareConfig {
  version_a: string
  version_b: string
  criteria?: string
  output_key: string         // writes { winner: 'a'|'b'|'tie', reasoning: string }
}

export interface EnrichConfig {
  data: Record<string, unknown>
  infer_fields: Array<{ name: string; description: string }>
  output_key: string
}

export interface PlanConfig {
  goal: string
  constraints?: string
  output_key: string         // writes { steps: Array<{ step: number; action: string; tool?: string }> }
}

export type SkillConfig =
  | ({ skill: 'classify' } & ClassifyConfig)
  | ({ skill: 'extract' } & ExtractConfig)
  | ({ skill: 'summarize' } & SummarizeConfig)
  | ({ skill: 'sentiment' } & SentimentConfig)
  | ({ skill: 'generate' } & GenerateConfig)
  | ({ skill: 'translate' } & TranslateConfig)
  | ({ skill: 'score' } & ScoreConfig)
  | ({ skill: 'decide' } & DecideConfig)
  | ({ skill: 'route' } & RouteConfig)
  | ({ skill: 'compare' } & CompareConfig)
  | ({ skill: 'enrich' } & EnrichConfig)
  | ({ skill: 'plan' } & PlanConfig)

// ── Skill Engine ─────────────────────────────────────────────────────────────

export type LlmFn = (system: string, prompt: string, model: string) => Promise<string>

/**
 * Default reasoning tier per skill.
 * The LLM router resolves 'tier:X' to the appropriate model for the active provider.
 *
 *  fast      — classify, sentiment, translate, summarize (simple, structured output)
 *  balanced  — extract, generate, score, route, compare  (moderate reasoning)
 *  powerful  — decide, plan, enrich                      (multi-step, strategic)
 */
const SKILL_TIERS: Record<SkillName, string> = {
  classify:  'tier:fast',
  sentiment: 'tier:fast',
  translate: 'tier:fast',
  summarize: 'tier:fast',
  extract:   'tier:balanced',
  generate:  'tier:balanced',
  score:     'tier:balanced',
  route:     'tier:balanced',
  compare:   'tier:balanced',
  enrich:    'tier:powerful',
  decide:    'tier:powerful',
  plan:      'tier:powerful',
}

export class SkillEngine {
  /**
   * Optional optimized prompt store — injected by the API/worker when a MongoDB
   * connection is available. When present, each skill call checks for an optimized
   * system prompt produced by SkillOptimizer and uses it instead of the hardcoded default.
   *
   * Shape: Map<skillName, optimizedSystemPrompt>
   * Populated by calling SkillEngine.loadOptimizedPrompts(db, tenantId).
   */
  private optimizedPrompts: Map<string, string> = new Map()

  constructor(
    private llm: LlmFn,
    /** Optional pre-loaded optimized prompts from SkillOptimizer. */
    optimizedPrompts?: Map<string, string>,
  ) {
    if (optimizedPrompts) this.optimizedPrompts = optimizedPrompts
  }

  /** Load tenant-specific optimized prompts from MongoDB (call once at worker init). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static async loadOptimizedPrompts(db: { collection: (n: string) => any }, tenantId: string): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    try {
      const docs = await db.collection('skill_optimized_prompts')
        .find({ target: 'skill', tenant_id: { $in: [tenantId, 'all'] } })
        .sort({ score: -1 }) // prefer higher-scored optimization
        .toArray() as Array<{ target_id: string; prompt: string }>
      for (const doc of docs) {
        if (!map.has(doc.target_id)) map.set(doc.target_id, doc.prompt)
      }
    } catch { /* DB unavailable — use defaults */ }
    return map
  }

  /** Get system prompt: use SkillOpt-optimized version if available, else default. */
  private getSystemPrompt(skillName: string, defaultPrompt: string): string {
    return this.optimizedPrompts.get(skillName) ?? defaultPrompt
  }

  async run(cfg: SkillConfig): Promise<Record<string, unknown>> {
    // Resolve the tier-aware model once at the top — private methods receive it directly
    const model = SKILL_TIERS[cfg.skill]!
    switch (cfg.skill) {
      case 'classify':  return this.classify(cfg, model)
      case 'extract':   return this.extract(cfg, model)
      case 'summarize': return this.summarize(cfg, model)
      case 'sentiment': return this.sentiment(cfg, model)
      case 'generate':  return this.generate(cfg, model)
      case 'translate': return this.translate(cfg, model)
      case 'score':     return this.score(cfg, model)
      case 'decide':    return this.decide(cfg, model)
      case 'route':     return this.route(cfg, model)
      case 'compare':   return this.compare(cfg, model)
      case 'enrich':    return this.enrich(cfg, model)
      case 'plan':      return this.plan(cfg, model)
      default:
        throw new Error(`Unknown skill: ${(cfg as { skill: string }).skill}`)
    }
  }

  // ── classify ──────────────────────────────────────────────────────────────

  private async classify(cfg: ClassifyConfig, model: string): Promise<Record<string, unknown>> {
    const labels = cfg.labels.join(', ')
    const multi = cfg.multi ? 'You may select multiple labels.' : 'Select exactly one label.'
    const system = this.getSystemPrompt('classify', `You are a text classifier. Respond ONLY with valid JSON.`)
    const prompt = `Classify the following text into one of these labels: [${labels}]. ${multi}

Text: "${cfg.text}"

Respond with JSON: { "labels": ["label1"], "confidence": 0.95, "reasoning": "..." }
If multi-select is off, "labels" should have exactly 1 item.`

    try {
      const raw = await this.llm(system, prompt, model)
      const parsed = extractJson(raw)
      return { [cfg.output_key]: parsed }
    } catch {
      return { [cfg.output_key]: { labels: [cfg.labels[0]], confidence: 0, reasoning: 'fallback' } }
    }
  }

  // ── extract ──────────────────────────────────────────────────────────────

  private async extract(cfg: ExtractConfig, model: string): Promise<Record<string, unknown>> {
    const fieldList = cfg.fields.map(f => `  "${f.name}" (${f.type ?? 'string'}): ${f.description}`).join('\n')
    const system = this.getSystemPrompt('extract', `You are a data extraction assistant. Extract fields from text. Respond ONLY with valid JSON.`)
    const prompt = `Extract the following fields from the text below. If a field cannot be found, use null.

Fields to extract:
${fieldList}

Text: "${cfg.text}"

Respond with JSON matching exactly the field names above.`

    try {
      const raw = await this.llm(system, prompt, model)
      const parsed = extractJson(raw)
      return { [cfg.output_key]: parsed }
    } catch {
      const fallback = Object.fromEntries(cfg.fields.map(f => [f.name, null]))
      return { [cfg.output_key]: fallback }
    }
  }

  // ── summarize ─────────────────────────────────────────────────────────────

  private async summarize(cfg: SummarizeConfig, model: string): Promise<Record<string, unknown>> {
    const styleHint = cfg.style === 'bullets'
      ? 'Format as bullet points starting with •'
      : cfg.style === 'tldr'
      ? 'Format as a single TLDR sentence starting with "TLDR:"'
      : 'Format as a short paragraph'

    const system = this.getSystemPrompt('summarize', `You are a concise summarization assistant.`)
    const prompt = `Summarize the following text in ${cfg.max_sentences ?? 3} sentences or fewer. ${styleHint}

Text: "${cfg.text}"`

    try {
      const summary = await this.llm(system, prompt, model)
      return { [cfg.output_key]: summary.trim() }
    } catch {
      return { [cfg.output_key]: cfg.text.slice(0, 200) + '...' }
    }
  }

  // ── sentiment ─────────────────────────────────────────────────────────────

  private async sentiment(cfg: SentimentConfig, model: string): Promise<Record<string, unknown>> {
    const system = this.getSystemPrompt('sentiment', `You are a sentiment analysis model. Respond ONLY with valid JSON.`)
    const prompt = `Analyze the sentiment of this text:

"${cfg.text}"

Respond with JSON: { "score": 0.8, "label": "positive", "confidence": 0.92, "emotions": ["satisfaction", "trust"] }
score ranges from -1 (very negative) to +1 (very positive).
label is one of: "positive", "neutral", "negative".`

    try {
      const raw = await this.llm(system, prompt, model)
      const parsed = extractJson(raw)
      return { [cfg.output_key]: parsed }
    } catch {
      return { [cfg.output_key]: { score: 0, label: 'neutral', confidence: 0, emotions: [] } }
    }
  }

  // ── generate ──────────────────────────────────────────────────────────────

  private async generate(cfg: GenerateConfig, model: string): Promise<Record<string, unknown>> {
    const persona = cfg.persona ?? 'a helpful professional assistant'
    const tone = cfg.tone ?? 'professional and friendly'
    const wordLimit = cfg.max_words ? ` Keep it under ${cfg.max_words} words.` : ''

    const system = `You are ${persona}. Write in a ${tone} tone.${wordLimit}`

    try {
      const output = await this.llm(system, cfg.prompt, 'claude-haiku-4-5')
      return { [cfg.output_key]: output.trim() }
    } catch {
      const fallback = cfg.fallback ?? `[Generated content for: ${cfg.prompt.slice(0, 50)}...]`
      return { [cfg.output_key]: fallback }
    }
  }

  // ── translate ─────────────────────────────────────────────────────────────

  private async translate(cfg: TranslateConfig, model: string): Promise<Record<string, unknown>> {
    const system = this.getSystemPrompt('translate', `You are a professional translator. Translate accurately, preserving tone and meaning.`)
    const prompt = `Translate the following text to ${cfg.target_language}. Return only the translated text, nothing else.

"${cfg.text}"`

    try {
      const translated = await this.llm(system, prompt, model)
      return { [cfg.output_key]: translated.trim() }
    } catch {
      return { [cfg.output_key]: cfg.text }
    }
  }

  // ── score ─────────────────────────────────────────────────────────────────

  private async score(cfg: ScoreConfig, model: string): Promise<Record<string, unknown>> {
    const min = cfg.min ?? 0
    const max = cfg.max ?? 100
    const system = this.getSystemPrompt('score', `You are an objective scoring assistant. Respond ONLY with valid JSON.`)
    const prompt = `Score the following on a scale from ${min} to ${max} based on this rubric:

Rubric: "${cfg.rubric}"
Subject: "${cfg.subject}"

Respond with JSON: { "score": 75, "reasoning": "...", "strengths": [], "weaknesses": [] }`

    try {
      const raw = await this.llm(system, prompt, model)
      const parsed = extractJson(raw)
      return { [cfg.output_key]: parsed }
    } catch {
      return { [cfg.output_key]: { score: Math.round((min + max) / 2), reasoning: 'fallback', strengths: [], weaknesses: [] } }
    }
  }

  // ── decide ────────────────────────────────────────────────────────────────

  private async decide(cfg: DecideConfig, model: string): Promise<Record<string, unknown>> {
    const options = (cfg.options ?? ['yes', 'no', 'escalate']).join(', ')
    const system = this.getSystemPrompt('decide', `You are a decision-making assistant. Respond ONLY with valid JSON.`)
    const prompt = `Make a decision about the following:

Question: "${cfg.question}"
Context: "${cfg.context}"

Available decisions: [${options}]

Respond with JSON: { "decision": "yes", "confidence": 0.87, "reasoning": "...", "risks": [] }`

    try {
      const raw = await this.llm(system, prompt, model)
      const parsed = extractJson(raw)
      return { [cfg.output_key]: parsed }
    } catch {
      return { [cfg.output_key]: { decision: 'escalate', confidence: 0, reasoning: 'fallback', risks: [] } }
    }
  }

  // ── route ─────────────────────────────────────────────────────────────────

  private async route(cfg: RouteConfig, model: string): Promise<Record<string, unknown>> {
    const routeList = cfg.routes.map(r => `  - "${r.id}": ${r.label} (when: ${r.when})`).join('\n')
    const system = this.getSystemPrompt('route', `You are a routing assistant. Respond ONLY with valid JSON.`)
    const prompt = `Route the following to the most appropriate destination:

Subject: "${cfg.description}"

Available routes:
${routeList}

Respond with JSON: { "route_id": "billing", "confidence": 0.91, "reasoning": "..." }`

    try {
      const raw = await this.llm(system, prompt, model)
      const parsed = extractJson(raw) as Record<string, unknown> | null
      return { [cfg.output_key]: (parsed?.route_id as string | undefined) ?? cfg.routes[0]?.id, [`${cfg.output_key}_detail`]: parsed }
    } catch {
      return { [cfg.output_key]: cfg.routes[0]?.id }
    }
  }

  // ── compare ───────────────────────────────────────────────────────────────

  private async compare(cfg: CompareConfig, model: string): Promise<Record<string, unknown>> {
    const criteria = cfg.criteria ?? 'quality, clarity, and effectiveness'
    const system = this.getSystemPrompt('compare', `You are an objective comparison assistant. Respond ONLY with valid JSON.`)
    const prompt = `Compare these two versions based on: ${criteria}

Version A: "${cfg.version_a}"
Version B: "${cfg.version_b}"

Respond with JSON: { "winner": "a", "scores": { "a": 78, "b": 65 }, "reasoning": "...", "recommendation": "..." }`

    try {
      const raw = await this.llm(system, prompt, model)
      const parsed = extractJson(raw)
      return { [cfg.output_key]: parsed }
    } catch {
      return { [cfg.output_key]: { winner: 'tie', scores: { a: 50, b: 50 }, reasoning: 'fallback', recommendation: '' } }
    }
  }

  // ── enrich ────────────────────────────────────────────────────────────────

  private async enrich(cfg: EnrichConfig, model: string): Promise<Record<string, unknown>> {
    const fieldList = cfg.infer_fields.map(f => `  "${f.name}": ${f.description}`).join('\n')
    const system = this.getSystemPrompt('enrich', `You are a data enrichment assistant. Infer missing fields from available data. Respond ONLY with valid JSON.`)
    const prompt = `Given this data, infer the following additional fields:

Existing data:
${JSON.stringify(cfg.data, null, 2)}

Fields to infer:
${fieldList}

Respond with JSON containing only the inferred fields.`

    try {
      const raw = await this.llm(system, prompt, model)
      const parsed = extractJson(raw) as Record<string, unknown>
      return { [cfg.output_key]: { ...cfg.data, ...parsed } }
    } catch {
      return { [cfg.output_key]: cfg.data }
    }
  }

  // ── plan ──────────────────────────────────────────────────────────────────

  private async plan(cfg: PlanConfig, model: string): Promise<Record<string, unknown>> {
    const constraints = cfg.constraints ? `\nConstraints: ${cfg.constraints}` : ''
    const system = this.getSystemPrompt('plan', `You are a strategic planning assistant. Respond ONLY with valid JSON.`)
    const prompt = `Create a step-by-step execution plan for this goal:

Goal: "${cfg.goal}"${constraints}

Respond with JSON: { "steps": [{ "step": 1, "action": "...", "tool": "email", "estimated_minutes": 5, "depends_on": [] }], "total_estimated_minutes": 25 }`

    try {
      const raw = await this.llm(system, prompt, model)
      const parsed = extractJson(raw)
      return { [cfg.output_key]: parsed }
    } catch {
      return { [cfg.output_key]: { steps: [{ step: 1, action: cfg.goal }], total_estimated_minutes: 0 } }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractJson(text: string): unknown {
  // Try to parse the whole string; if it fails, extract the first {...} block
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('No JSON found in response')
  }
}
