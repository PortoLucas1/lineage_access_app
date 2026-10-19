variable "databricks_host" {
  description = "Databricks workspace host, for example https://adb-xxxx.azuredatabricks.net."
  type        = string
}

variable "databricks_profile" {
  description = "Databricks CLI profile used by the provider."
  type        = string
}

variable "catalog_name" {
  description = "Unity Catalog catalog containing the analysis target."
  type        = string
}

variable "schema_name" {
  description = "Default schema analyzed by the Lineage & Access app."
  type        = string
}

variable "catalog_owner" {
  description = "Documented catalog owner. Used only as inventory metadata, not as a grant resource."
  type        = string
  default     = ""
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
