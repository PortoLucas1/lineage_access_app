# Unity Catalog permission baseline

This Terraform module is a Git-backed permission reference for **your**
catalog and schema. It does not assume a particular customer, workspace, or
owner.

1. Copy `terraform.tfvars.example` to `terraform.tfvars`.
2. Set `databricks_host`, `databricks_profile`, `catalog_name`, and `schema_name`.
3. Put Unity Catalog grants in `databricks_permissions.tf` and external-lineage
   grants (Tableau and similar) in `extsystem_permissions.tf`. The public
   `declared-grants.json` is a sanitized example for `dbdemos_pipeline_bike.rides`.
   For a private capture of a real catalog, write gitignored
   `terraform/.declared-grants.json` — Terraform and the app prefer that file
   when it exists, so colleague emails never land in the public repo.
4. Run `terraform plan`. Grant writes stay off until you set `manage_catalog_grants=true`.
   Point the app at this folder (or a workspace copy of it) on the
   **Terraform source** page so the App service principal can read it.

The Lineage & Access Console reads the same `declared-grants.json` for drift
comparison on the Permissions mapping page. The app can show the module path
and catalog/schema you intend to plan against; that UI stores values in the
browser only. Production still uses env vars:

| Env var | Purpose |
|---|---|
| `TERRAFORM_MODULE_PATH` | Relative path to this directory (default `terraform`) |
| `TERRAFORM_CATALOG` | Catalog Terraform should manage (falls back to `DEMO_CATALOG`) |
| `TERRAFORM_SCHEMA` | Schema Terraform should document (falls back to `DEMO_SCHEMA`) |

## Safety model

```hcl
manage_catalog_grants = false
```

With that default, `terraform plan` reads catalog/schema metadata and creates
no grant resources. Catalog grants affect every current and future object in
the catalog, not only one schema.

`databricks_grant` is authoritative for one principal on one catalog. Enabling
the gate imports each principal/catalog pair in `declared-grants.json`.

```bash
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars

terraform init
terraform fmt -check
terraform validate

# Review-only: reads metadata, proposes no grant changes.
terraform -chdir=terraform plan

# Explicitly gated: review this plan carefully; do not apply automatically.
terraform -chdir=terraform plan -var='manage_catalog_grants=true'
```

Do not commit tokens, `.tfvars` with real hosts, or `*.tfstate`.

## Refreshing the baseline

Read direct grants at their actual inheritance level:

```bash
databricks grants get CATALOG <catalog> --max-results 0 -o json
databricks grants get SCHEMA <catalog>.<schema> --max-results 0 -o json
```

For each table, verify whether direct grants exist:

```bash
databricks grants get TABLE <catalog>.<schema>.<table> --max-results 0 -o json
```

Use `get-effective` to see inherited access:

```bash
databricks grants get-effective TABLE <catalog>.<schema>.<table> --max-results 0 -o json
```

Ownership and metastore-inherited `READ_METADATA` are not grant resources in
this configuration. `inventory.tf` is a documentation snapshot of the objects
present when the baseline was last captured — replace `target_assets` when you
point the module at a different schema.

## External BI lineage (Tableau, ...)

`external-bi.json` declares tables consumed by BI tools outside Databricks
(Tableau, Power BI, ...) plus who can see each one — see `external_lineage.tf`.
This uses the same safety-gate pattern as grants, but mutates via a script
instead of a provider resource, because the Databricks Terraform provider has
no resource for Unity Catalog's External Lineage API yet (Public Preview):

```hcl
manage_external_lineage = false
```

With that default, `terraform apply` does nothing for this file. Setting it to
`true` runs `../app/scripts/register_external_lineage.py` via `local-exec`,
which creates (idempotently — safe to re-run) an External Metadata object and
an External Lineage relationship in Unity Catalog for each entry. You can also
run that script directly without touching Terraform at all:

```bash
python3 ../app/scripts/register_external_lineage.py \
  --catalog <catalog> --schema <schema> --profile <cli-profile>
```

The `access` list inside each entity (who can see that BI tool's dashboard) is
never pushed anywhere — Unity Catalog doesn't model permissions for an
external tool's own users. The Lineage & Access Console reads it directly from
`external-bi.json` (synced to `app/config/external-bi.json`) to show it in the
access panel as declared/simulated knowledge, the same way `declared-grants.json`
backs the Terraform-vs-effective comparison for catalog grants.
