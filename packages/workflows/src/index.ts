export type { ActionReceipt, ActionReceiptOutcome } from './types.js'
export { ConnectorRegistry, CONNECTORS, connectorRegistry } from './connectors/ConnectorRegistry.js'
export type { ConnectorDef, ConnectorAction, ConnectorTrigger, ConnectorCategory } from './connectors/ConnectorRegistry.js'
export { X_AGENT_TOOL_PACK, X_AGENT_ACTIONS, resolveXAgentActions } from './connectors/XAgentTools.js'
export type { AgentToolPack, AgentResourceLink } from './connectors/XAgentTools.js'
export { ConnectorActionExecutor } from './connectors/ConnectorActionExecutor.js'
export type { ConnectorCredential, ActionResult } from './connectors/ConnectorActionExecutor.js'
export { CausalExperimentTracker, estimateWithinTenantAttribution } from './attribution/CausalExperimentTracker.js'
export type {
  CausalExperiment,
  KpiObservation,
  OutcomeAttribution,
} from './attribution/CausalExperimentTracker.js'
export { ConnectorSchemaRegistry, connectorSchemaRegistry } from './schema-registry.js'
export type { ConnectorSchema, SchemaCompatibility } from './schema-registry.js'

// ── General-purpose durable workflow engine ─────────────────────────────────
// See README.md — nothing here runs unless application code explicitly
// calls WorkflowEngine.start()/.resume()/.approve()/.reject().
export { defineWorkflow } from './engine/define-workflow.js'
export { WorkflowEngine } from './engine/workflow-engine.js'
export type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowStepContext,
  WorkflowStepResult,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStepRun,
  WorkflowApproval,
} from './engine/types.js'
