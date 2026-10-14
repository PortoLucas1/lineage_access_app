/*
 * Snapshot of the analysis target at discovery time. These locals are
 * documentation inputs, not resource declarations.
 */
locals {
  target_full_name = "${var.catalog_name}.${var.schema_name}"
  target_owner     = "lucas.porto@databricks.com"

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

  # No direct grants existed on the schema or any asset on 2026-10-14.
  # The following principals can read target tables through catalog inheritance.
  effective_asset_readers = {
    "account users"                        = ["SELECT"]
    "reza.shabani@databricks.com"          = ["SELECT"]
    "e35c1305-3e62-4235-b215-5255a6386d4f" = ["SELECT"]
    "wenwen.xie@databricks.com"            = ["ALL_PRIVILEGES"]
    "yuki.shiga@databricks.com"            = ["ALL_PRIVILEGES"]
    "57e7dc57-63b9-4114-a2ad-0a6226794a22" = ["ALL_PRIVILEGES", "MANAGE"]
  }
}

output "analysis_target" {
  description = "Default Unity Catalog scope for the Lineage & Access app."
  value       = local.target_full_name
}

output "target_assets" {
  description = "Assets present when the permission baseline was captured."
  value       = local.target_assets
}
