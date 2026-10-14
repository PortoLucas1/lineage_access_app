variable "databricks_host" {
  description = "Databricks workspace host."
  type        = string
  default     = "https://e2-demo-field-eng.cloud.databricks.com"
}

variable "databricks_profile" {
  description = "Databricks CLI profile used by the provider."
  type        = string
  default     = "e2-demo-west"
}

variable "catalog_name" {
  description = "Unity Catalog catalog containing the analysis target."
  type        = string
  default     = "porto_catalog"
}

variable "schema_name" {
  description = "Default schema analyzed by the Lineage & Access app."
  type        = string
  default     = "dbdemos_pipeline_bike"
}

variable "manage_catalog_grants" {
  description = <<-EOT
    Safety gate for the catalog-level grants inherited by the target schema.
    Leave false for normal plans. Set true only after reviewing the inventory
    and confirming that Terraform should become authoritative for these
    principal/catalog pairs.
  EOT
  type        = bool
  default     = false
}
