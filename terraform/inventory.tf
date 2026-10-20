/*
 * Example snapshot of one analysis target. Replace target_assets when you
 * point this module at a different schema. Locals are documentation only.
 */
locals {
  target_full_name = "${var.catalog_name}.${var.schema_name}"
  target_owner     = var.catalog_owner

  target_assets = {
    bikes                                          = "MATERIALIZED_VIEW"
    customers                                      = "STREAMING_TABLE"
    customers_cdc_raw                              = "STREAMING_TABLE"
    event_log_1b67790c_94bf_4726_9923_8d44a649f3c9 = "MANAGED"
    maintenance_events                             = "MATERIALIZED_VIEW"
    maintenance_logs                               = "STREAMING_TABLE"
    maintenance_logs_raw                           = "STREAMING_TABLE"
    pipeline_bike_event_logs                       = "MANAGED"
    rides                                          = "STREAMING_TABLE"
    rides_raw                                      = "STREAMING_TABLE"
    stations                                       = "MATERIALIZED_VIEW"
    weather                                        = "STREAMING_TABLE"
    weather_raw                                    = "STREAMING_TABLE"
  }

  # Replace with principals from your catalog. Live grants belong in
  # declared-grants.json (or gitignored .declared-grants.json).
  effective_asset_readers = local.grants_file
}

output "analysis_target" {
  description = "Default Unity Catalog scope for the Lineage & Access app."
  value       = local.target_full_name
}

output "target_assets" {
  description = "Assets present when the permission baseline was captured."
  value       = local.target_assets
}
