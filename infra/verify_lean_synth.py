#!/usr/bin/env python3
"""Assert the two backend profiles synthesize to the resources we expect.

The whole point of the lean profile is that the three constructs which produced
the ~$200/month bill are *absent*, not merely configured smaller. That is a claim
about the generated CloudFormation, so check the template rather than the source.

Run:
    python infra/verify_lean_synth.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

INFRA_DIR = Path(__file__).resolve().parent
REPO_ROOT = INFRA_DIR.parent

#: Resource types that carry a standing hourly charge with no free tier here.
BILLABLE = {
    "AWS::EC2::NatGateway": "NAT Gateway (~$32/mo + data processing)",
    "AWS::RDS::DBInstance": "RDS instance (~$25/mo + storage)",
    "AWS::ElastiCache::CacheCluster": "ElastiCache node (~$12/mo)",
    "AWS::SecretsManager::Secret": "Secrets Manager secret ($0.40/mo)",
    "AWS::ElasticLoadBalancingV2::LoadBalancer": "ALB (~$17/mo + LCU)",
    "AWS::ECS::Service": "Fargate service (~$36/mo at 1vCPU/2GB)",
}

LEAN_FORBIDDEN = {
    "AWS::EC2::NatGateway",
    "AWS::RDS::DBInstance",
    "AWS::ElastiCache::CacheCluster",
    "AWS::SecretsManager::Secret",
}


def synth(lean: bool, outdir: Path) -> dict[str, dict]:
    """Synthesize the app and return {stack_name: template}."""
    cmd = [
        sys.executable, str(INFRA_DIR / "app.py"),
    ]
    env = {
        **_base_env(),
        "CDK_OUTDIR": str(outdir),
        "CDK_CONTEXT_JSON": json.dumps({"lean": lean}),
    }
    proc = subprocess.run(cmd, cwd=INFRA_DIR, env=env, capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit(f"synth failed (lean={lean}):\n{proc.stdout}\n{proc.stderr}")

    templates: dict[str, dict] = {}
    for path in sorted(outdir.glob("*.template.json")):
        templates[path.name.replace(".template.json", "")] = json.loads(path.read_text())
    if not templates:
        raise SystemExit(f"no templates written to {outdir}")
    return templates


def _base_env() -> dict[str, str]:
    import os
    env = dict(os.environ)
    env["PYTHONPATH"] = str(REPO_ROOT)
    return env


def resource_counts(template: dict) -> Counter:
    return Counter(r["Type"] for r in template.get("Resources", {}).values())


def report(profile: str, templates: dict[str, dict]) -> Counter:
    print(f"\n{'=' * 70}\nPROFILE: {profile}\n{'=' * 70}")
    total = Counter()
    for name, template in sorted(templates.items()):
        counts = resource_counts(template)
        total += counts
        print(f"  {name}: {sum(counts.values())} resources")
    print("\n  Billable resources:")
    for rtype, label in sorted(BILLABLE.items()):
        n = total.get(rtype, 0)
        mark = "x" if n else "-"
        print(f"    [{mark}] {n} x {label}")
    return total


def assign_public_ip(templates: dict[str, dict]) -> str | None:
    """Return the ECS service's AssignPublicIp setting, or None if not found."""
    for template in templates.values():
        for res in template.get("Resources", {}).values():
            if res["Type"] != "AWS::ECS::Service":
                continue
            net = res["Properties"].get("NetworkConfiguration", {})
            return net.get("AwsvpcConfiguration", {}).get("AssignPublicIp")
    return None


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        lean_templates = synth(True, Path(tmp) / "lean")
        full_templates = synth(False, Path(tmp) / "full")
        lean_totals = report("lean (-c lean=true, default)", lean_templates)
        full_totals = report("full (-c lean=false)", full_templates)
        lean_ip = assign_public_ip(lean_templates)
        full_ip = assign_public_ip(full_templates)

    failures: list[str] = []
    for rtype in sorted(LEAN_FORBIDDEN):
        if lean_totals.get(rtype):
            failures.append(f"lean profile still creates {lean_totals[rtype]} x {rtype}")
        if not full_totals.get(rtype):
            failures.append(f"full profile no longer creates {rtype} — regression")

    # The lean task needs a public IP: with no NAT Gateway there is no other
    # egress path to ECR, so a lean deploy without it fails at image pull.
    print(f"\n  AssignPublicIp: lean={lean_ip} full={full_ip}")
    if lean_ip != "ENABLED":
        failures.append(f"lean ECS service AssignPublicIp={lean_ip}, expected ENABLED "
                        "(no NAT means no other route to ECR)")
    if full_ip != "DISABLED":
        failures.append(f"full ECS service AssignPublicIp={full_ip}, expected DISABLED")

    print(f"\n{'=' * 70}")
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        return 1
    print("PASS: lean drops NAT + RDS + ElastiCache + Secrets; full retains all four.")
    print(f"      lean total resources: {sum(lean_totals.values())}")
    print(f"      full total resources: {sum(full_totals.values())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
