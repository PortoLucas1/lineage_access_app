#!/usr/bin/env python3
"""
Register the BI connections declared in terraform/external-bi.json as real
Unity Catalog External Lineage objects, using the Databricks CLI's
`external-metadata` / `external-lineage` command groups (Public Preview as of
CLI 1.17).

Why this exists: Unity Catalog automatically captures lineage for queries run
*inside* Databricks, but a table consumed by an outside BI tool (Tableau,
Power BI, ...) needs to be declared explicitly. This script is the one-time
(idempotent) "apply" step that turns a Terraform-declared BI connection into a
genuine External Metadata object + External Lineage relationship, so it shows
up in the lineage graph the same way a native Databricks dashboard does. See
https://docs.databricks.com/aws/en/data-governance/unity-catalog/external-lineage

This is invoked from terraform/external_lineage.tf via a `local-exec`
provisioner (gated behind `manage_external_lineage`, default false) — the
Databricks Terraform provider has no native resource for this yet, so
Terraform shells out to this script instead, exactly the way the repo's other
one-off setup scripts (app/scripts/finalize_app.sh, lakebase_setup_db.sh) shell
out to the `databricks` CLI rather than hand-authenticating.

Deliberately NOT done here: pushing the `access` list from external-bi.json
anywhere. Unity Catalog has no permission model for an external BI tool's own
users, so that list stays a declared/simulated manifest that the app reads
directly (see app/server/uc/bi-consumers.ts) to show "who has access to this
Tableau dashboard" without it ever being an enforced UC grant.

Usage:
    python3 app/scripts/register_external_lineage.py \
        --catalog <catalog> --schema <schema> [--profile <profile>]

catalog/schema default to $DEMO_CATALOG / $DEMO_SCHEMA — the same env vars the
app itself reads (see app/.env.template).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.parse
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parents[2]
MANIFEST_PATH = REPO_DIR / "terraform" / "external-bi.json"


def cli(*args: str, profile: str | None) -> subprocess.CompletedProcess:
    cmd = ["databricks", *args]
    if profile:
        cmd += ["--profile", profile]
    return subprocess.run(cmd, capture_output=True, text=True)


def ensure_external_metadata(entity: dict, profile: str | None) -> None:
    name = entity["externalMetadataName"]
    got = cli("external-metadata", "get-external-metadata", name, "-o", "json", profile=profile)
    if got.returncode == 0:
        print(f"  external metadata '{name}' already exists — skipping create")
        return
    print(f"  creating external metadata '{name}' ({entity['systemType']} / {entity['entityType']})")
    created = cli(
        "external-metadata",
        "create-external-metadata",
        name,
        entity["systemType"],
        entity["entityType"],
        "--description",
        entity.get("description", ""),
        "--url",
        entity.get("url", ""),
        "-o",
        "json",
        profile=profile,
    )
    if created.returncode != 0:
        raise RuntimeError(f"create-external-metadata failed for '{name}': {created.stderr.strip()}")


def relationship_exists(table_full_name: str, metadata_name: str, profile: str | None) -> bool:
    qs = urllib.parse.urlencode(
        {"object_info.table.name": table_full_name, "lineage_direction": "DOWNSTREAM"}
    )
    result = cli(
        "api", "get", f"/api/2.0/lineage-tracking/external-lineage?{qs}", "-o", "json", profile=profile
    )
    if result.returncode != 0:
        # Table may not exist yet, or the preview API may not be enabled in
        # this workspace — treat as "not found" and let the create call
        # surface the real error if there is one.
        return False
    try:
        body = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return False
    for rel in body.get("external_lineage_relationships", []):
        if rel.get("external_metadata_info", {}).get("name") == metadata_name:
            return True
    return False


def ensure_relationship(table_full_name: str, metadata_name: str, profile: str | None) -> None:
    if relationship_exists(table_full_name, metadata_name, profile):
        print(f"  lineage relationship {table_full_name} -> {metadata_name} already exists — skipping")
        return
    print(f"  creating lineage relationship {table_full_name} -> {metadata_name}")
    body = json.dumps(
        {
            "source": {"table": {"name": table_full_name}},
            "target": {"external_metadata": {"name": metadata_name}},
        }
    )
    created = cli(
        "external-lineage",
        "create-external-lineage-relationship",
        "--json",
        body,
        "-o",
        "json",
        profile=profile,
    )
    if created.returncode != 0:
        raise RuntimeError(f"create-external-lineage-relationship failed: {created.stderr.strip()}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--catalog", default=os.environ.get("DEMO_CATALOG", ""))
    parser.add_argument("--schema", default=os.environ.get("DEMO_SCHEMA", ""))
    parser.add_argument("--profile", default=os.environ.get("DATABRICKS_CONFIG_PROFILE"))
    args = parser.parse_args()

    if not args.catalog or not args.schema:
        sys.exit("error: --catalog/--schema (or DEMO_CATALOG/DEMO_SCHEMA) are required")
    if not MANIFEST_PATH.exists():
        sys.exit(f"error: manifest not found at {MANIFEST_PATH}")

    manifest = json.loads(MANIFEST_PATH.read_text())
    entities = manifest.get("entities", [])
    if not entities:
        print("[external-lineage] no entities declared in external-bi.json — nothing to do")
        return

    for entity in entities:
        leaf = entity["table"].split(".")[-1]
        table_full_name = f"{args.catalog}.{args.schema}.{leaf}"
        print(f"[external-lineage] {entity['externalMetadataName']} -> {table_full_name}")
        ensure_external_metadata(entity, args.profile)
        ensure_relationship(table_full_name, entity["externalMetadataName"], args.profile)

    print("[external-lineage] done.")


if __name__ == "__main__":
    main()
