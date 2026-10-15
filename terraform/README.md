# Unity Catalog permission baseline

This directory is the Git-backed permission reference for the default analysis
target:

```text
porto_catalog.dbdemos_pipeline_bike
```

It was captured from `e2-demo-field-eng` on 2026-10-14.

## What the inventory found

- Catalog owner: `lucas.porto@databricks.com`
- Schema owner: `lucas.porto@databricks.com`
- 13 assets: 3 materialized views, 7 streaming tables, and 3 managed tables
- No direct grants on the schema
- No direct grants on any of the 13 assets
- Every effective table permission is inherited from `porto_catalog`
- Real table and column lineage exists in `system.access`

Because Unity Catalog inheritance is the source of the effective permissions,
`permissions.tf` models the existing grants on `porto_catalog`, using
`declared-grants.json` as the shared manifest consumed by the app's drift
comparison. Adding duplicate schema or table grants would not mirror the current
permission design.

## Safety model

The reference is read-only by default:

```hcl
manage_catalog_grants = false
```

With that default, `terraform plan` reads the target catalog/schema and creates
no grant resources. This is intentional: catalog grants affect every current
and future object in the catalog, not only `dbdemos_pipeline_bike`.

`databricks_grant` is authoritative for one principal on one catalog. Enabling
the gate imports each existing principal/catalog pair and then manages the
privilege list captured in `declared-grants.json`.

Do not enable or apply the grant resources without reviewing the plan:

```bash
terraform init
terraform fmt -check
terraform validate

# Review-only: this reads metadata and proposes no grant changes.
terraform plan

# Explicitly gated: review this plan carefully; do not apply automatically.
terraform plan -var='manage_catalog_grants=true'
```

Authentication uses the `e2-demo-west` Databricks CLI profile by default. No
tokens or secrets belong in this directory.

## Refreshing the baseline

Read direct grants at their actual inheritance level:

```bash
databricks grants get CATALOG porto_catalog \
  --max-results 0 --profile e2-demo-west -o json

databricks grants get SCHEMA porto_catalog.dbdemos_pipeline_bike \
  --max-results 0 --profile e2-demo-west -o json
```

For each asset, verify that direct grants remain empty:

```bash
databricks grants get TABLE \
  porto_catalog.dbdemos_pipeline_bike.<asset> \
  --max-results 0 --profile e2-demo-west -o json
```

Use `get-effective` to see inherited access:

```bash
databricks grants get-effective TABLE \
  porto_catalog.dbdemos_pipeline_bike.bikes \
  --max-results 0 --profile e2-demo-west -o json
```

Ownership and metastore-inherited `READ_METADATA` are not grant resources in
this configuration.
