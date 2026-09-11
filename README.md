# @phantasy/plugin-woocommerce

Dual-environment WooCommerce tools for Phantasy agents (**staging** + **production**).

Default environment is **staging**. Production writes require `approved: true`.

## Module role

| Layer | Package / path |
|-------|----------------|
| Tools | this package |
| Operating procedure | `skills/phantasy-store-ops` |
| Automation graphs | `templates/workflows/store-*.workflow.json` |
| Architecture map | `@phantasy/store/docs/architecture.md` |
| Product guide | Docs app → Guides → Integrations → WooCommerce Store |

## Config

```json
{
  "plugins": {
    "woocommerce": {
      "enabled": true,
      "defaultEnvironment": "staging",
      "environments": {
        "staging": {
          "baseUrl": "http://127.0.0.1:8081",
          "consumerKey": "ck_...",
          "consumerSecret": "cs_..."
        },
        "production": {
          "baseUrl": "https://shop-api.example.com",
          "consumerKey": "ck_...",
          "consumerSecret": "cs_..."
        }
      }
    }
  }
}
```

### Env vars

| Env | Maps to |
|-----|---------|
| `WC_STAGING_BASE_URL` + `WC_STAGING_CONSUMER_*` | staging |
| `WC_PRODUCTION_BASE_URL` + `WC_PRODUCTION_CONSUMER_*` | production |
| `WC_BASE_URL` + `WC_CONSUMER_*` | fallback → staging (local dogfood) |
| `WC_DEFAULT_ENV` | `staging` (default) |

## Policy

1. Change staging → verify (`store-staging-verify` / skill checklist).
2. Ask human for production approval.
3. Production tools with `environment: "production"` and `approved: true`.

## Tools

- `wc_list_environments`, `wc_compare_health`, `wc_health`
- `wc_ops_summary`, list/get products & orders
- `wc_update_product`, `wc_update_order_status`, `wc_set_tracking` (prod: approved)
- `wc_create_product`, `wc_refund_order` (always approved)
- `wc_pod_providers` (printful / tapstitch)

## Pairing

1. `store/docker/bootstrap.sh` (local) and/or `bootstrap-staging.sh`
2. Printful plugin + Tapstitch REST connect
3. Enable this plugin + skill `phantasy-store-ops`
4. Import `store-staging-verify` + `store-promote-production` workflows
