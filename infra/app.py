#!/usr/bin/env python3
"""VAYU Climate Digital Twin — AWS CDK Production Stack (No Docker Required Locally).

Deploy Phase 1 (frontend only, no Docker):
  cdk deploy VayuStorage VayuFrontend --require-approval never

Deploy Phase 2 (full backend — after pushing image to ECR):
  cdk deploy --all --require-approval never

Estimated monthly cost: ~$41/month → 7 months on $300 credits
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
    """Frontend → CloudFront CDN. Files uploaded via `aws s3 sync` (faster, no Lambda timeout)."""

    def __init__(self, scope: Construct, id: str, frontend_bucket: s3.Bucket, **kwargs):
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
        self.distribution = cloudfront.Distribution(
            self, "VayuCdn",
            comment="VAYU Climate Digital Twin",
            # HTML, including index.html and SPA error fallbacks, must be revalidated.
            default_behavior=cloudfront.BehaviorOptions(
                origin=frontend_origin,
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
                compress=True,
            ),
            additional_behaviors={
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
            },
            error_responses=[
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


# ══════════════════════════════════════════════════════════════════════════════
# Phase 2: Backend Infrastructure (needs image in ECR)
# ══════════════════════════════════════════════════════════════════════════════

class VayuBackendStack(Stack):
    """VPC + RDS + Redis + ECS Fargate — all in one stack to avoid cycles."""

    def __init__(
        self, scope: Construct, id: str,
        model_bucket: s3.Bucket,
        ecr_repo: ecr.Repository,
        **kwargs,
    ):
        super().__init__(scope, id, **kwargs)

        # ── VPC ───────────────────────────────────────────────────────────────
        vpc = ec2.Vpc(
            self, "Vpc",
            max_azs=2,
            nat_gateways=1,
            subnet_configuration=[
                ec2.SubnetConfiguration(name="Public", subnet_type=ec2.SubnetType.PUBLIC, cidr_mask=24),
                ec2.SubnetConfiguration(name="Private", subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS, cidr_mask=24),
            ],
        )

        # ── Security Groups ───────────────────────────────────────────────────
        ecs_sg = ec2.SecurityGroup(self, "EcsSG", vpc=vpc, allow_all_outbound=True)
        db_sg = ec2.SecurityGroup(self, "DbSG", vpc=vpc)
        redis_sg = ec2.SecurityGroup(self, "RedisSG", vpc=vpc)

        db_sg.add_ingress_rule(ecs_sg, ec2.Port.tcp(5432))
        redis_sg.add_ingress_rule(ecs_sg, ec2.Port.tcp(6379))

        # ── Secrets ───────────────────────────────────────────────────────────
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

        # ── RDS PostgreSQL ────────────────────────────────────────────────────
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

        # ── Redis ─────────────────────────────────────────────────────────────
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
        db_secret.grant_read(execution_role)
        ecr_repo.grant_pull(execution_role)

        log_group = logs.LogGroup(
            self, "Logs", log_group_name="/vayu/backend",
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # Task definition
        task_def = ecs.FargateTaskDefinition(
            self, "TaskDef",
            memory_limit_mib=2048, cpu=1024,
            execution_role=execution_role, task_role=task_role,
        )

        container = task_def.add_container(
            "backend",
            image=ecs.ContainerImage.from_ecr_repository(ecr_repo, tag="latest"),
            logging=ecs.LogDrivers.aws_logs(stream_prefix="vayu", log_group=log_group),
            environment={
                "MODEL_PATH": "/app/checkpoints/vayu_best.pt",
                "MODEL_S3_URI": f"s3://{model_bucket.bucket_name}/checkpoints/vayu_best.pt",
                "REDIS_URL": f"redis://{redis.attr_redis_endpoint_address}:6379",
                "LOG_LEVEL": "INFO",
                "MODEL_VERSION": "2.0.0",
                "CORS_ORIGINS": "*",
                "DB_HOST": db.db_instance_endpoint_address,
                "DB_PORT": db.db_instance_endpoint_port,
                "DB_NAME": "vayu_climate",
            },
            secrets={
                "DB_USERNAME": ecs.Secret.from_secrets_manager(db_secret, "username"),
                "DB_PASSWORD": ecs.Secret.from_secrets_manager(db_secret, "password"),
            },
            health_check=ecs.HealthCheck(
                command=["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"],
                interval=Duration.seconds(30),
                timeout=Duration.seconds(10),
                retries=3,
                start_period=Duration.seconds(90),
            ),
        )
        container.add_port_mappings(ecs.PortMapping(container_port=8000))

        # Fargate service with ALB
        service = ecs_patterns.ApplicationLoadBalancedFargateService(
            self, "Service",
            cluster=cluster,
            task_definition=task_def,
            desired_count=1,
            public_load_balancer=True,
            security_groups=[ecs_sg],
            assign_public_ip=False,
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

        # Auto-scaling
        scaling = service.service.auto_scale_task_count(min_capacity=1, max_capacity=3)
        scaling.scale_on_cpu_utilization("CpuScale", target_utilization_percent=70)

        CfnOutput(self, "BackendUrl", value=f"http://{service.load_balancer.load_balancer_dns_name}")
        CfnOutput(self, "DbEndpoint", value=db.db_instance_endpoint_address)
        CfnOutput(self, "RedisEndpoint", value=redis.attr_redis_endpoint_address)


# ══════════════════════════════════════════════════════════════════════════════
# App
# ══════════════════════════════════════════════════════════════════════════════

app = cdk.App()

env = cdk.Environment(
    account=app.node.try_get_context("account") or None,
    region=app.node.try_get_context("region") or "ap-south-1",
)

# Phase 1 stacks (no Docker)
storage = VayuStorageStack(app, "VayuStorage", env=env)
frontend = VayuFrontendStack(app, "VayuFrontend", frontend_bucket=storage.frontend_bucket, env=env)
frontend.add_dependency(storage)

# Phase 2 stack (all backend in one stack — no cross-stack cycles)
backend = VayuBackendStack(
    app, "VayuBackend",
    model_bucket=storage.model_bucket,
    ecr_repo=storage.ecr_repo,
    env=env,
)
backend.add_dependency(storage)

app.synth()
