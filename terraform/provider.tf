provider "databricks" {
  host    = var.databricks_host
  profile = var.databricks_profile
}

data "databricks_catalog" "target" {
  name = var.catalog_name
}

data "databricks_schema" "target" {
  name = "${var.catalog_name}.${var.schema_name}"
}
