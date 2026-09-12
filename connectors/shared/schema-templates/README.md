# Connector Schema Templates

This directory contains JSON Schema templates for connector event validation.

## Schema Structure

Each connector should have a `schemas/` directory with JSON Schema files for their events:

```
connectors/
├── stripe/
│   ├── stripe.yaml
│   └── schemas/
│       ├── charge.succeeded.json
│       ├── charge.failed.json
│       └── subscription.created.json
├── shopify/
│   ├── shopify.yaml
│   └── schemas/
│       ├── orders.create.json
│       └── customers.create.json
```

## Schema Format

Schemas follow JSON Schema Draft 2020-12 format with Kairos-specific extensions:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://kairos.io/schemas/stripe/charge.succeeded/v1.0.0",
  "title": "Stripe Charge Succeeded Event",
  "description": "Schema for Stripe charge.succeeded webhook events",
  "type": "object",
  "kairos": {
    "connector_id": "stripe",
    "event_type": "charge.succeeded",
    "schema_version": "1.0.0",
    "signal_type": "payment.received",
    "min_schema_version": "1.0.0"
  },
  "required": ["id", "object", "created", "amount", "currency"],
  "properties": {
    "id": {
      "type": "string",
      "description": "Charge ID"
    },
    "object": {
      "type": "string",
      "const": "charge"
    },
    "amount": {
      "type": "integer",
      "description": "Amount in minor units"
    },
    "currency": {
      "type": "string",
      "pattern": "^[a-z]{3}$",
      "description": "ISO 4217 currency code"
    }
  }
}
```

## Kairos Extensions

- `kairos.connector_id`: Connector identifier
- `kairos.event_type`: Original provider event type
- `kairos.schema_version`: Schema version (semver)
- `kairos.signal_type`: Mapped Kairos signal type
- `kairos.min_schema_version`: Minimum schema version for detectors

## Schema Versioning

Schema versions follow Semantic Versioning (semver):
- **MAJOR**: Breaking changes to required fields
- **MINOR**: Non-breaking additions (new optional fields)
- **PATCH**: Bug fixes, documentation updates

## Validation

Schemas are validated using the EventSchemaRegistry:
- Automatic validation on webhook ingestion
- Manual validation via API endpoints
- Schema compatibility checks for detector registration

## Creating New Schemas

1. Copy the appropriate template from `templates/`
2. Customize for your connector's events
3. Add to connector's `schemas/` directory
4. Update connector YAML with schema references
5. Test validation using schema registry API
