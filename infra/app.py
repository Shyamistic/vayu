#!/usr/bin/env python3
"""VAYU Climate Digital Twin — AWS CDK stacks.

Two backend profiles are available, selected with the `lean` context flag.

LEAN (default, `-c lean=true`) — event/demo profile
  VPC with public subnets only (no NAT Gateway), Fargate task with a public IP,
  ALB, and *no* RDS / ElastiCache / Secrets Manager. The API keeps working:
  DatabaseClient degrades to "persistence disabled" and CacheClient falls back to
  an in-process TTL cache. Deploys in ~5 minutes.

    Hourly: ALB ~$0.023 + Fargate 1vCPU/2GB ~$0.049  ≈ $0.072/h  ≈ $1.75/day

FULL (`-c lean=false`) — scaled profile
  Adds a NAT Gateway, RDS PostgreSQL, and an ElastiCache Redis node, with the
  Fargate task in private subnets. This is the profile that produced roughly
  $200/month: NAT ~$32, RDS ~$25, ElastiCache ~$12, ALB ~$17, Fargate ~$36.
  Deploys in 25-30 minutes; RDS is the slow and failure-prone step.

Deploy frontend only (no Docker, no backend):
  cdk deploy VayuStorage VayuFrontend --require-approval never -c api_proxy=false

Deploy everything (lean):
  cdk deploy --all --require-approval never

NOTE: the API is intentionally unauthenticated — every endpoint is reachable by
anyone who has the CloudFront or ALB hostname. That is acceptable for a public
read-only demo, but `POST /api/scenario` runs model inference on request, so a
public deployment left running is exposed to compute-cost abuse. Add an API key
or WAF rate limit before any long-lived deployment.
"""

import os
import aws_cdk as cdk
from aws_cdk import (
    Duration,
    RemovalPolicy,
    Stack,
    CfnOutput,
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_ecs_patterns as ecs_patterns,
    aws_elasticache as elasticache,
    aws_iam as iam,
    aws_logs as logs,
    aws_rds as rds,
    aws_s3 as s3,
    aws_secretsmanager as secretsmanager,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_ecr as ecr,
)
from constructs import Construct


# ══════════════════════════════════════════════════════════════════════════════
# Phase 1: Storage + Frontend (NO Docker needed)
# ══════════════════════════════════════════════════════════════════════════════

class VayuStorageStack(Stack):
    """S3 buckets + ECR repo."""

    def __init__(self, scope: Construct, id: str, **kwargs):
        super().__init__(scope, id, **kwargs)

        self.model_bucket = s3.Bucket(
            self, "ModelBucket",
            bucket_name=f"vayu-climate-models-{self.account}",
            versioned=True,
            encryption=s3.BucketEncryption.S3_MANAGED,
            removal_policy=RemovalPolicy.RETAIN,
        )

        self.frontend_bucket = s3.Bucket(
            self, "FrontendBucket",
            bucket_name=f"vayu-frontend-{self.account}",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            website_index_document="index.html",
            website_error_document="index.html",
            block_public_access=s3.BlockPublicAccess(
                block_public_acls=False,
                block_public_policy=False,
                ignore_public_acls=False,
                restrict_public_buckets=False,
            ),
        )
        self.frontend_bucket.grant_public_access()

        self.ecr_repo = ecr.Repository(
            self, "BackendRepo",
            repository_name="vayu-backend",
            removal_policy=RemovalPolicy.DESTROY,
            lifecycle_rules=[
                ecr.LifecycleRule(max_image_count=10)
            ],
        )

        CfnOutput(self, "ModelBucketName", value=self.model_bucket.bucket_name)
        CfnOutput(self, "FrontendBucketName", value=self.frontend_bucket.bucket_name)
        CfnOutput(self, "EcrRepoUri", value=self.ecr_repo.repository_uri)


class VayuFrontendStack(Stack):
    """Frontend → CloudFront CDN. Files uploaded via `aws s3 sync` (faster, no Lambda timeout).

    When `backend_dns` is supplied the same distribution also proxies the API
    under `/api/*`. This matters for more than tidiness: the frontend is served
    over HTTPS from CloudFront, and the ALB has no TLS certificate (that needs a
    registered domain), so a browser would refuse every direct
    ``https:// page → http:// ALB`` call as mixed content. Proxying puts the API
    on the same HTTPS origin, which also removes CORS from the picture entirely
    and lets the build keep ``VITE_API_URL`` empty.
    """

    def __init__(
        self, scope: Construct, id: str,
        frontend_bucket: s3.Bucket,
        backend_dns: str | None = None,
        **kwargs,
    ):
        super().__init__(scope, id, **kwargs)

        # Fingerprinted Vite output may be kept at the edge and in browsers for a year.
        # CloudFront compress=True enables negotiated Brotli or gzip at edge locations.
        asset_cache_policy = cloudfront.CachePolicy(
            self, "HashedAssetCachePolicy",
            min_ttl=Duration.seconds(0),
            default_ttl=Duration.seconds(31_536_000),
            max_ttl=Duration.seconds(31_536_000),
            cookie_behavior=cloudfront.CacheCookieBehavior.none(),
            header_behavior=cloudfront.CacheHeaderBehavior.none(),
            query_string_behavior=cloudfront.CacheQueryStringBehavior.none(),
            enable_accept_encoding_brotli=True,
            enable_accept_encoding_gzip=True,
        )
        frontend_origin = origins.HttpOrigin(
            frontend_bucket.bucket_website_domain_name,
            protocol_policy=cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        )
        # SPA deep-link handling.
        #
        # CloudFront `error_responses` are DISTRIBUTION-wide, not per-behaviour. The
        # original config mapped every 403/404 to index.html with status 200, which
        # is fine for a pure static site but silently corrupts the API once /api/*
        # shares the distribution: a genuine 404 would reach the browser as 200
        # with an HTML body. frontend/src/core/api/useNWPComparison.ts branches on
        # `res.status === 404` to fall back to /api/nwp-baseline, so it would try to
        # JSON.parse index.html instead.
        #
        # With the API attached we therefore rewrite extension-less paths to
        # /index.html in a viewer-request function bound only to the SPA behaviour,
        # and drop the global error mapping so API status codes pass through intact.
        spa_rewrite = cloudfront.Function(
            self, "SpaRewrite",
            comment="Rewrite extension-less paths to /index.html for SPA routing",
            code=cloudfront.FunctionCode.from_inline(
                # CloudFront Functions run a restricted JS runtime; stick to ES5.
                "function handler(event) {\n"
                "  var request = event.request;\n"
                "  var uri = request.uri;\n"
                "  if (uri.charAt(uri.length - 1) === '/') {\n"
                "    request.uri = uri + 'index.html';\n"
                "  } else if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) {\n"
                "    request.uri = '/index.html';\n"
                "  }\n"
                "  return request;\n"
                "}\n"
            ),
        ) if backend_dns else None

        additional_behaviors: dict[str, cloudfront.BehaviorOptions] = {
            "assets/*": cloudfront.BehaviorOptions(
                origin=frontend_origin,
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=asset_cache_policy,
                compress=True,
            ),
            "cesium/*": cloudfront.BehaviorOptions(
                origin=frontend_origin,
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=asset_cache_policy,
                compress=True,
            ),
        }

        if backend_dns:
            api_origin = origins.HttpOrigin(
                backend_dns,
                protocol_policy=cloudfront.OriginProtocolPolicy.HTTP_ONLY,
                read_timeout=Duration.seconds(60),   # model inference is not instant
                keepalive_timeout=Duration.seconds(60),
            )
            # Tiles are pure functions of (z, x, y, variable, date) — safe and
            # valuable to cache at the edge. Everything else passes through.
            tile_cache_policy = cloudfront.CachePolicy(
                self, "TileCachePolicy",
                min_ttl=Duration.seconds(0),
                default_ttl=Duration.hours(6),
                max_ttl=Duration.days(1),
                cookie_behavior=cloudfront.CacheCookieBehavior.none(),
                header_behavior=cloudfront.CacheHeaderBehavior.none(),
                query_string_behavior=cloudfront.CacheQueryStringBehavior.all(),
                enable_accept_encoding_brotli=True,
                enable_accept_encoding_gzip=True,
            )
            passthrough = cloudfront.BehaviorOptions(
                origin=api_origin,
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowed_methods=cloudfront.AllowedMethods.ALLOW_ALL,  # POST /api/scenario
                cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
                origin_request_policy=cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                compress=True,
            )
            additional_behaviors["/api/tiles/*"] = cloudfront.BehaviorOptions(
                origin=api_origin,
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowed_methods=cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                cache_policy=tile_cache_policy,
                compress=True,
            )
            for pattern in ("/api/*", "/health", "/docs", "/redoc", "/openapi.json"):
                additional_behaviors[pattern] = passthrough

        self.distribution = cloudfront.Distribution(
            self, "VayuCdn",
            comment="VAYU Climate Digital Twin",
            # HTML, including index.html and SPA error fallbacks, must be revalidated.
            default_behavior=cloudfront.BehaviorOptions(
                origin=frontend_origin,
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
                compress=True,
                function_associations=[
                    cloudfront.FunctionAssociation(
                        function=spa_rewrite,
                        event_type=cloudfront.FunctionEventType.VIEWER_REQUEST,
                    )
                ] if spa_rewrite else None,
            ),
            additional_behaviors=additional_behaviors,
            error_responses=None if backend_dns else [
                cloudfront.ErrorResponse(
                    http_status=403,
                    response_http_status=200,
                    response_page_path="/index.html",
                    ttl=Duration.seconds(0),
                ),
                cloudfront.ErrorResponse(
                    http_status=404,
                    response_http_status=200,
                    response_page_path="/index.html",
                    ttl=Duration.seconds(0),
                ),
            ],
        )

        CfnOutput(self, "CloudFrontUrl",
                  value=f"https://{self.distribution.distribution_domain_name}")
        CfnOutput(self, "DistributionId",
                  value=self.distribution.distribution_id)
        if backend_dns:
            CfnOutput(self, "ApiUrl",
                      value=f"https://{self.distribution.distribution_domain_name}/api")


# ══════════════════════════════════════════════════════════════════════════════
# Phase 2: Backend Infrastructure (needs image in ECR)
# ══════════════════════════════════════════════════════════════════════════════

class VayuBackendStack(Stack):
    """VPC + ECS Fargate, plus RDS and Redis when `lean` is False.

    All in one stack to avoid cross-stack cycles.
    """

    def __init__(
        self, scope: Construct, id: str,
        model_bucket: s3.Bucket,
        ecr_repo: ecr.Repository,
        lean: bool = True,
        data_s3_prefix: str | None = None,
        data_regions: str = "processed_western_ghats",
        region_models: str = "",
        static_regions: str = "",
        **kwargs,
    ):
        super().__init__(scope, id, **kwargs)

        self.lean = lean

        # ── VPC ───────────────────────────────────────────────────────────────
        # A NAT Gateway is ~$32/month plus data processing, and it exists only so
        # private-subnet tasks can reach the internet. In lean mode we place the
        # task in a public subnet with a public IP instead: it still reaches ECR,
        # S3 and CloudWatch, and inbound remains closed at the security group.
        if lean:
            subnet_config = [
                ec2.SubnetConfiguration(name="Public", subnet_type=ec2.SubnetType.PUBLIC, cidr_mask=24),
            ]
            nat_gateways = 0
        else:
            subnet_config = [
                ec2.SubnetConfiguration(name="Public", subnet_type=ec2.SubnetType.PUBLIC, cidr_mask=24),
                ec2.SubnetConfiguration(name="Private", subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS, cidr_mask=24),
            ]
            nat_gateways = 1

        vpc = ec2.Vpc(
            self, "Vpc",
            max_azs=2,
            nat_gateways=nat_gateways,
            subnet_configuration=subnet_config,
        )

        # ── Security Groups ───────────────────────────────────────────────────
        # No inbound rules are declared here. ApplicationLoadBalancedFargateService
        # adds the single ALB→task rule it needs, so even with a public IP the task
        # is not directly reachable.
        ecs_sg = ec2.SecurityGroup(self, "EcsSG", vpc=vpc, allow_all_outbound=True)

        db = None
        redis = None
        db_secret = None

        if not lean:
            db_sg = ec2.SecurityGroup(self, "DbSG", vpc=vpc)
            redis_sg = ec2.SecurityGroup(self, "RedisSG", vpc=vpc)

            db_sg.add_ingress_rule(ecs_sg, ec2.Port.tcp(5432))
            redis_sg.add_ingress_rule(ecs_sg, ec2.Port.tcp(6379))

            # ── Secrets ───────────────────────────────────────────────────────
            db_secret = secretsmanager.Secret(
                self, "DbSecret",
                secret_name="vayu/db-credentials",
                generate_secret_string=secretsmanager.SecretStringGenerator(
                    secret_string_template='{"username": "vayu"}',
                    generate_string_key="password",
                    exclude_punctuation=True,
                    password_length=32,
                ),
            )

            # ── RDS PostgreSQL ────────────────────────────────────────────────
            db = rds.DatabaseInstance(
                self, "Db",
                engine=rds.DatabaseInstanceEngine.postgres(version=rds.PostgresEngineVersion.VER_16),
                instance_type=ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
                vpc=vpc,
                vpc_subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS),
                security_groups=[db_sg],
                credentials=rds.Credentials.from_secret(db_secret),
                database_name="vayu_climate",
                allocated_storage=20,
                max_allocated_storage=100,
                backup_retention=Duration.days(7),
                deletion_protection=False,
                removal_policy=RemovalPolicy.DESTROY,
            )

            # ── Redis ─────────────────────────────────────────────────────────
            redis_subnet_group = elasticache.CfnSubnetGroup(
                self, "RedisSubnets",
                description="VAYU Redis",
                subnet_ids=[s.subnet_id for s in vpc.private_subnets],
            )

            redis = elasticache.CfnCacheCluster(
                self, "Redis",
                cache_node_type="cache.t4g.micro",
                engine="redis",
                num_cache_nodes=1,
                cache_subnet_group_name=redis_subnet_group.ref,
                vpc_security_group_ids=[redis_sg.security_group_id],
                engine_version="7.1",
            )

        # ── ECS Cluster ───────────────────────────────────────────────────────
        cluster = ecs.Cluster(self, "Cluster", vpc=vpc, cluster_name="vayu-cluster")

        # Task roles
        task_role = iam.Role(self, "TaskRole", assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"))
        model_bucket.grant_read(task_role)

        execution_role = iam.Role(
            self, "ExecRole",
            assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name("service-role/AmazonECSTaskExecutionRolePolicy")
            ],
        )
        if db_secret is not None:
            db_secret.grant_read(execution_role)
        ecr_repo.grant_pull(execution_role)

        log_group = logs.LogGroup(
            self, "Logs", log_group_name="/vayu/backend",
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # Task definition
        # 6 GB, not 2. Inference holds the torch runtime, a per-region checkpoint,
        # the ClimateGraphBuilder edge list and an open NetCDF handle (up to 900 MB
        # for the full_india bundle, plus its HDF5 chunk cache) at the same time.
        # 2 GB was OOM-killed on the first /api/predict call; 4 GB survived one
        # region but was OOM-killed after three regions were touched in quick
        # succession even with MAX_CACHED_REGIONS=1, because the kill can land
        # mid-request while the previous region's entry is still being evicted.
        # 6 GB is the largest size 1 vCPU Fargate supports in 1 GB steps below the
        # 8 GB ceiling, and costs roughly +$0.02/h over the 2 GB lean-profile
        # baseline this stack started from.
        task_def = ecs.FargateTaskDefinition(
            self, "TaskDef",
            memory_limit_mib=6144, cpu=1024,
            execution_role=execution_role, task_role=task_role,
        )

        # Dataset location. entrypoint.sh pulls `normalized_*.nc` for each region in
        # DATA_REGIONS out of DATA_S3_PREFIX; without it the API answers /api/predict
        # with synthetic grids while still reporting healthy.
        prefix = data_s3_prefix or f"s3://{model_bucket.bucket_name}/data"

        environment = {
            "MODEL_PATH": "/app/checkpoints/vayu_best.pt",
            "MODEL_S3_URI": f"s3://{model_bucket.bucket_name}/checkpoints/vayu_best.pt",
            # Per-region checkpoints. main.py resolves
            # checkpoints/regions/<region>/vayu_best.pt per request and silently
            # shares the global checkpoint when one is absent, so these must be
            # shipped explicitly for a deployment to actually serve per-region
            # models rather than one model wearing five labels.
            "REGION_MODELS_S3_PREFIX": f"s3://{model_bucket.bucket_name}/checkpoints/regions",
            "REGION_MODELS": region_models,
            # Static rasters are model inputs, not decoration. STATIC_RASTER_ROOT
            # defaults to "D:/" in main.py, which exists on the dev workstation
            # and never inside the container, so it must be set explicitly or
            # every region silently falls back to synthetic terrain.
            "STATIC_RASTER_ROOT": "/app/static",
            "STATIC_S3_PREFIX": f"s3://{model_bucket.bucket_name}/static",
            "STATIC_REGIONS": static_regions,
            "CLIMATE_DATA_ROOT": "/app/data",
            "DATA_S3_PREFIX": prefix,
            "DATA_REGIONS": data_regions,
            "LOG_LEVEL": "INFO",
            "MODEL_VERSION": "2.0.0",
            "CORS_ORIGINS": "*",
        }
        secrets: dict[str, ecs.Secret] = {}

        if not lean:
            environment["REDIS_URL"] = f"redis://{redis.attr_redis_endpoint_address}:6379"
            environment["DB_HOST"] = db.db_instance_endpoint_address
            environment["DB_PORT"] = db.db_instance_endpoint_port
            environment["DB_NAME"] = "vayu_climate"
            secrets = {
                "DB_USERNAME": ecs.Secret.from_secrets_manager(db_secret, "username"),
                "DB_PASSWORD": ecs.Secret.from_secrets_manager(db_secret, "password"),
            }
        else:
            # Point Redis at an address that fails fast rather than leaving the
            # default localhost:6379, so CacheClient reaches its in-process
            # fallback without waiting on the 5 s connect timeout each retry.
            environment["REDIS_URL"] = "redis://disabled.invalid:6379"

        container = task_def.add_container(
            "backend",
            image=ecs.ContainerImage.from_ecr_repository(ecr_repo, tag="latest"),
            logging=ecs.LogDrivers.aws_logs(stream_prefix="vayu", log_group=log_group),
            environment=environment,
            secrets=secrets or None,
            health_check=ecs.HealthCheck(
                command=["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"],
                interval=Duration.seconds(30),
                timeout=Duration.seconds(10),
                retries=3,
                start_period=Duration.seconds(90),
            ),
        )
        container.add_port_mappings(ecs.PortMapping(container_port=8000))

        # Fargate service with ALB.
        # In lean mode the task sits in a public subnet and needs a public IP for
        # egress, because there is no NAT Gateway to route through.
        service = ecs_patterns.ApplicationLoadBalancedFargateService(
            self, "Service",
            cluster=cluster,
            task_definition=task_def,
            desired_count=1,
            public_load_balancer=True,
            security_groups=[ecs_sg],
            assign_public_ip=lean,
            task_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PUBLIC if lean else ec2.SubnetType.PRIVATE_WITH_EGRESS
            ),
            health_check_grace_period=Duration.seconds(300),  # 5 min grace for model download
        )

        # Configure ALB target group health check to be more lenient
        service.target_group.configure_health_check(
            path="/health",
            interval=Duration.seconds(30),
            timeout=Duration.seconds(10),
            healthy_threshold_count=2,
            unhealthy_threshold_count=5,
        )

        # Auto-scaling. Capped tighter in lean mode: each extra task is billed, and
        # with an in-process cache extra tasks do not share memoised predictions.
        scaling = service.service.auto_scale_task_count(
            min_capacity=1, max_capacity=2 if lean else 3,
        )
        scaling.scale_on_cpu_utilization("CpuScale", target_utilization_percent=70)

        self.load_balancer_dns = service.load_balancer.load_balancer_dns_name

        CfnOutput(self, "BackendUrl", value=f"http://{service.load_balancer.load_balancer_dns_name}")
        CfnOutput(self, "Profile", value="lean" if lean else "full")
        if not lean:
            CfnOutput(self, "DbEndpoint", value=db.db_instance_endpoint_address)
            CfnOutput(self, "RedisEndpoint", value=redis.attr_redis_endpoint_address)


# ══════════════════════════════════════════════════════════════════════════════
# App
# ══════════════════════════════════════════════════════════════════════════════

app = cdk.App()


def _ctx_bool(key: str, default: bool) -> bool:
    """Read a boolean context value. `-c key=false` must actually mean False."""
    raw = app.node.try_get_context(key)
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


env = cdk.Environment(
    account=app.node.try_get_context("account") or None,
    region=app.node.try_get_context("region") or "ap-south-1",
)

LEAN = _ctx_bool("lean", True)
# Routing the API through CloudFront is what makes the lean profile usable from an
# HTTPS page, so it defaults on with lean. It creates a VayuFrontend → VayuBackend
# dependency, so a frontend-only deploy must pass `-c api_proxy=false`.
API_PROXY = _ctx_bool("api_proxy", LEAN)

DATA_S3_PREFIX = app.node.try_get_context("data_s3_prefix") or None
# The 1981-2025 rebuild lives in processed_<region>_1981 directories; the older
# 2010-2025 layout used processed_<region>. _resolve_dataset_path globs
# `processed_<region>*`, so the directory name shipped here must match what was
# actually uploaded or the region resolves to None and serves synthetic grids.
DATA_REGIONS = app.node.try_get_context("data_regions") or (
    "processed_western_ghats_1981 processed_north_east_india_1981 "
    "processed_indo_gangetic_plain_1981 processed_central_india_1981 "
    "processed_full_india_05"
)
REGION_MODELS = app.node.try_get_context("region_models") or (
    "western_ghats north_east_india indo_gangetic_plain central_india full_india"
)
# Must match main.py _REGION_STATIC_DIRS. full_india uses the 0.5 deg product:
# the 0.25 deg static_full_india shares no latitude value with the 0.5 deg grid,
# so reusing it yields an empty intersection rather than an error.
STATIC_REGIONS = app.node.try_get_context("static_regions") or (
    "static_western_ghats static_north_east_india static_indo_gangetic_plain "
    "static_central_india static_full_india_05"
)

# Phase 1 stacks (no Docker)
storage = VayuStorageStack(app, "VayuStorage", env=env)

# Phase 2 stack (all backend in one stack — no cross-stack cycles)
backend = VayuBackendStack(
    app, "VayuBackend",
    model_bucket=storage.model_bucket,
    ecr_repo=storage.ecr_repo,
    lean=LEAN,
    data_s3_prefix=DATA_S3_PREFIX,
    data_regions=DATA_REGIONS,
    region_models=REGION_MODELS,
    static_regions=STATIC_REGIONS,
    env=env,
)
backend.add_dependency(storage)

frontend = VayuFrontendStack(
    app, "VayuFrontend",
    frontend_bucket=storage.frontend_bucket,
    backend_dns=backend.load_balancer_dns if API_PROXY else None,
    env=env,
)
frontend.add_dependency(storage)
if API_PROXY:
    frontend.add_dependency(backend)

app.synth()
