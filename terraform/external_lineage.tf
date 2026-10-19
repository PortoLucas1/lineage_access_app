# External BI lineage — registers the BI connections declared in
# external-bi.json as real Unity Catalog External Lineage objects, so a table
# consumed by an outside BI tool (Tableau, Power BI, ...) shows up in the
# native lineage graph the same way a Databricks dashboard does. See
# https://docs.databricks.com/aws/en/data-governance/unity-catalog/external-lineage
#
# The Databricks Terraform provider (pinned in versions.tf) has no resource
# for this yet — External Metadata / External Lineage are Public Preview REST
# APIs only. Rather than hand-roll HTTP calls in Terraform, this shells out
# (via local-exec) to app/scripts/register_external_lineage.py, which is
# idempotent and uses the `databricks` CLI for auth — consistent with how the
# repo's other one-off setup steps (finalize_app.sh, lakebase_setup_db.sh)
# shell out to the CLI instead of hand-authenticating.
#
# This resource only runs when `manage_external_lineage = true`, mirroring the
# `manage_catalog_grants` safety gate elsewhere in this module: leave it false
# for normal plans, flip it on deliberately when you want `terraform apply` to
# mutate the metastore.
#
# Note: the `access` list inside external-bi.json (who can see the Tableau
# dashboard) is NOT part of this registration — Unity Catalog has no
# permission model for an external BI tool's own users. That list is read
# directly by the app (server/uc/bi-consumers.ts) as a declared/simulated
# manifest, exactly like declared-grants.json is for catalog grants.

variable "manage_external_lineage" {
  description = <<-EOT
    Safety gate for the external BI lineage registrations in
    external-bi.json. Leave false for normal plans. Set true to have
    `terraform apply` run app/scripts/register_external_lineage.py, which
    registers each entry as a real Unity Catalog External Metadata object +
    External Lineage relationship (idempotent — safe to re-run, and safe to
    flip back to false afterward since this only ever creates, never deletes).
  EOT
  type        = bool
  default     = false
}

resource "terraform_data" "external_bi_lineage" {
  count = var.manage_external_lineage ? 1 : 0

  triggers_replace = [
    filesha256("${path.module}/external-bi.json"),
    var.catalog_name,
    var.schema_name,
  ]

  provisioner "local-exec" {
    command = "python3 ${path.module}/../app/scripts/register_external_lineage.py --catalog '${var.catalog_name}' --schema '${var.schema_name}' --profile '${var.databricks_profile}'"
  }
}
