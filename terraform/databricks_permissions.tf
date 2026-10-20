/*
 * Unity Catalog permission baseline (customer file: databricks_permissions.tf).
 *
 * Reads terraform/.declared-grants.json when present (local/private capture,
 * gitignored) and otherwise the public declared-grants.json example. Grant
 * writes stay off until manage_catalog_grants=true.
 */
locals {
  declared_grants_path = (
    fileexists("${path.module}/.declared-grants.json")
    ? "${path.module}/.declared-grants.json"
    : "${path.module}/declared-grants.json"
  )
  grants_file    = jsondecode(file(local.declared_grants_path))
  catalog_grants = try(local.grants_file.catalog, local.grants_file)

  schema_grant_pairs = flatten([
    for schema_name, principals in try(local.grants_file.schemas, {}) : [
      for principal, privileges in principals : {
        key        = "${schema_name}/${principal}"
        schema     = "${var.catalog_name}.${schema_name}"
        principal  = principal
        privileges = privileges
      }
    ]
  ])
  schema_grants = { for item in local.schema_grant_pairs : item.key => item }

  table_grant_pairs = flatten([
    for table_name, principals in try(local.grants_file.tables, {}) : [
      for principal, privileges in principals : {
        key        = "${table_name}/${principal}"
        table      = "${var.catalog_name}.${table_name}"
        principal  = principal
        privileges = privileges
      }
    ]
  ])
  table_grants = { for item in local.table_grant_pairs : item.key => item }
}

resource "databricks_grant" "target_catalog" {
  for_each = var.manage_catalog_grants ? local.catalog_grants : {}

  catalog    = var.catalog_name
  principal  = each.key
  privileges = each.value
}

resource "databricks_grant" "target_schema" {
  for_each = var.manage_catalog_grants ? local.schema_grants : {}

  schema     = each.value.schema
  principal  = each.value.principal
  privileges = each.value.privileges
}

resource "databricks_grant" "target_table" {
  for_each = var.manage_catalog_grants ? local.table_grants : {}

  table      = each.value.table
  principal  = each.value.principal
  privileges = each.value.privileges
}

import {
  for_each = var.manage_catalog_grants ? local.catalog_grants : {}

  to = databricks_grant.target_catalog[each.key]
  id = "catalog/${var.catalog_name}/${each.key}"
}
