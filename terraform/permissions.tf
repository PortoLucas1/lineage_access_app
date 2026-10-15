/*
 * Permission baseline for porto_catalog.dbdemos_pipeline_bike.
 *
 * Discovery on 2026-10-14 found no direct grants on the schema or any of its
 * 13 assets. Every effective asset grant is inherited from porto_catalog, so
 * reproducing the existing model means declaring the catalog grants below.
 *
 * databricks_grant is authoritative only for one principal on one securable.
 * The safety flag keeps this reference configuration read-only by default.
 */
locals {
  # This manifest is also bundled into the app for its drift comparison.
  catalog_grants = jsondecode(file("${path.module}/declared-grants.json"))
}

resource "databricks_grant" "target_catalog" {
  for_each = var.manage_catalog_grants ? local.catalog_grants : {}

  catalog    = var.catalog_name
  principal  = each.key
  privileges = each.value
}

# Import existing principal/catalog pairs instead of attempting to recreate
# them when the safety gate is deliberately enabled.
import {
  for_each = var.manage_catalog_grants ? local.catalog_grants : {}

  to = databricks_grant.target_catalog[each.key]
  id = "catalog/${var.catalog_name}/${each.key}"
}
