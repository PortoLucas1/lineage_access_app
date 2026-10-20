/*
 * External-system permission baseline (customer file: extsystem_permissions.tf).
 *
 * Unity Catalog has no ACL for Tableau / Power BI / other external lineage
 * users. Those principals live on the External Metadata object declared in
 * external-bi.json and are shown on that node in the lineage access panel.
 */
locals {
  external_bi = jsondecode(file("${path.module}/external-bi.json"))
  external_access = {
    for entity in local.external_bi.entities :
    coalesce(try(entity.externalMetadataName, null), entity.id) => try(entity.access, [])
  }
}

output "external_lineage_access" {
  description = "Declared permissions on external lineage objects (Tableau and similar)."
  value       = local.external_access
}
