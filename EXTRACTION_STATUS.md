# @phantasy/plugin-woocommerce

- Repo URL: https://github.com/phantasy-bot/plugin-woocommerce
- Extraction phase: `source-extracted`
- Source of truth: `standalone-repo`
- Runtime load mode: `git`
- Source owner: `standalone-repo`
- Source payload: `standalone-only`
- Monorepo package status: `removed`
- Sync mode: `standalone-repo`

## Meaning

This repo owns the WooCommerce implementation. The main Phantasy monorepo keeps
only the plugin contract, catalog metadata, and git-install configuration.

## Next Step

Maintain, test, and publish this plugin from this repository. Production writes
still require `approved: true` after staging verification.
