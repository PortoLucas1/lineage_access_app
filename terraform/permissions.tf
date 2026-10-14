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
  catalog_grants = {
    "irvin.umana@databricks.com"             = ["USE_CATALOG"]
    "filipe.deo@databricks.com"              = ["USE_CATALOG"]
    "shreel.shah@databricks.com"             = ["USE_CATALOG"]
    "3a265965-58c0-4922-af35-ce730c3cdad8"   = ["USE_CATALOG"]
    "reza.shabani@databricks.com"            = ["BROWSE", "EXECUTE", "READ_VOLUME", "SELECT", "USE_CATALOG", "USE_SCHEMA"]
    "account users"                          = ["BROWSE", "EXECUTE", "READ_VOLUME", "SELECT", "USE_CATALOG", "USE_SCHEMA"]
    "diego.gomez@databricks.com"             = ["USE_CATALOG"]
    "e35c1305-3e62-4235-b215-5255a6386d4f"   = ["SELECT", "USE_CATALOG", "USE_SCHEMA"]
    "vladimir.sagot@databricks.com"          = ["USE_CATALOG"]
    "pedro.zanlorensi@databricks.com"        = ["USE_CATALOG"]
    "daniel.granados@databricks.com"         = ["USE_CATALOG"]
    "fernando.come@databricks.com"           = ["USE_CATALOG"]
    "francisco.vargas@databricks.com"        = ["USE_CATALOG"]
    "andres.zuniga@databricks.com"           = ["USE_CATALOG"]
    "eri.adepoju@databricks.com"             = ["USE_CATALOG"]
    "57e7dc57-63b9-4114-a2ad-0a6226794a22"   = ["ALL_PRIVILEGES", "MANAGE"]
    "youssef.mrini@databricks.com"           = ["CREATE_SCHEMA", "USE_CATALOG"]
    "wenwen.xie@databricks.com"              = ["ALL_PRIVILEGES"]
    "marco.ferraro@databricks.com"           = ["USE_CATALOG"]
    "joel.ramirez@databricks.com"            = ["USE_CATALOG"]
    "jose.navarro@databricks.com"            = ["USE_CATALOG"]
    "juandiego.vargasrosales@databricks.com" = ["USE_CATALOG"]
    "ivan.calvo@databricks.com"              = ["USE_CATALOG"]
    "carlos.dip@databricks.com"              = ["USE_CATALOG"]
    "victor.gomes@databricks.com"            = ["USE_CATALOG"]
    "thais.henrique@databricks.com"          = ["USE_CATALOG"]
    "andres.garcia@databricks.com"           = ["USE_CATALOG"]
    "stuart.libby@databricks.com"            = ["USE_CATALOG"]
    "jose.cisneros@databricks.com"           = ["USE_CATALOG"]
    "esteban.castillo@databricks.com"        = ["USE_CATALOG"]
    "nishit.jain@databricks.com"             = ["USE_CATALOG"]
    "kevin.romero@databricks.com"            = ["USE_CATALOG"]
    "esteban.salom@databricks.com"           = ["USE_CATALOG"]
    "a9ec09ba-4c4d-4eab-8dda-9a73cc3bd6ec"   = ["USE_CATALOG"]
    "julian.camacho@databricks.com"          = ["USE_CATALOG"]
    "moises.robles@databricks.com"           = ["USE_CATALOG"]
    "yuki.shiga@databricks.com"              = ["ALL_PRIVILEGES"]
    "jose.delgado@databricks.com"            = ["USE_CATALOG"]
    "joao.gianfaldoni@databricks.com"        = ["USE_CATALOG"]
    "david.leiva@databricks.com"             = ["USE_CATALOG"]
    "bruno.ogata@databricks.com"             = ["USE_CATALOG"]
  }
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
