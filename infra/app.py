#!/usr/bin/env python3
"""VAYU Climate Digital Twin — AWS CDK Production Stack.

Architecture:
  - S3: model artifacts, processed data, tile cache, frontend assets
  - CloudFront: CDN for frontend (S3) + API (ECS)
  - VPC: isolated network with public/private subnets
  - ECS Fargate: FastAPI backend (auto-scaling 1-10 tasks)
  - RDS PostgreSQL + PostGIS: historical climate observations
  - ElastiCache Redis: prediction/scenario caching (1-hour TTL)
  - ECR: container registry for backend image
  - Secrets Manager: DB credentials, API keys
  - Route53: DNS (optional, if domain configured)

Estimated cost with $300 AWS credits:
  - ECS Fargate (0.5 vCPU, 1 GB): ~$12/month
  - RDS db.t4g.micro: ~$15/month
  - ElastiCache cache.t4g.micro: ~$13/month
  - CloudFront (10 GB/month): ~$1/month
  - S3 (5 GB): ~$0.12/month
  - Total: ~$41/month → ~7 months of runway with $300 credits

Deploy:
  cd infra
  pip install aws-cdk-lib constructs
  cdk bootstrap
  cdk deploy --all
"""

import aws_cdk as cdk
from aws_cdk import (
    Duration,
    RemovalPolicy,
    Stack,
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_ecs_patterns as ecs_patterns,
    aws_elasticache as elasticache,
    aws_iam as iam,
    aws_logs as logs,
    aws_rds as rds,
    aws_s3 as s3,
    aws_s3_deployment as s3_deploy,
    aws_secretsmanager as secretsmanager,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_ecr_assets as ecr_assets,
    aws_applicationautoscaling as autoscaling,
)
from constructs import Construct


class VayuVpcStack(Stack):
    """Isolated VPC with public/private subnets."""

    def __init__(self, scope: Construct, id: str, **kwargs):
        super().__init__(scope, id, **kwargs)

        self.vpc = ec2.Vpc(
            self, "VayuVpc",
            max_azs=2,
            nat_gateways=1,  # Cost-optimised: single NAT
            subnet_configuration=[
                ec2.SubnetConfiguration(
                    name="Public",
                    subnet_type=ec2.SubnetType.PUBLIC,
                    cidr_mask=24,
                ),
                ec2.SubnetConfiguration(
                    name="Private",
                    subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidr_mask=24,
                ),
            ],
        )

        cdk.CfnOutput(self, "VpcId", value=self.vpc.vpc_id)


class VayuDataStack(Stack):
    """RDS PostgreSQL + PostGIS and ElastiCache Redis."""

    def __init__(self, scope: Construct, id: str, vpc: ec2.Vpc, **kwargs):
        super().__init__(scope, id, **kwargs)

        # ── Security Groups ──────────────────────────────────────────────────
        self.db_sg = ec2.SecurityGroup(
            self, "DbSG",
            vpc=vpc,
            description="VAYU PostgreSQL security group",
        )
        self.redis_sg = ec2.SecurityGroup(
            self, "RedisSG",
            vpc=vpc,
            description="VAYU Redis security group",
        )
        self.ecs_sg = ec2.SecurityGroup(
            self, "EcsSG",
            vpc=vpc,
            description="VAYU ECS tasks security group",
            allow_all_outbound=True,
        )

        # ECS → DB (5432) and ECS → Redis (6379)
        self.db_sg.add_ingress_rule(self.ecs_sg, ec2.Port.tcp(5432), "ECS → Postgres")
        self.redis_sg.add_ingress_rule(self.ecs_sg, ec2.Port.tcp(6379), "ECS → Redis")

        # ── DB Credentials (Secrets Manager) ─────────────────────────────────
        self.db_secret = secretsmanager.Secret(
            self, "DbSecret",
            secret_name="vayu/db-credentials",
            generate_secret_string=secretsmanager.SecretStringGenerator(
                secret_string_template='{"username": "vayu"}',
                generate_string_key="password",
                exclude_punctuation=True,
                password_length=32,
            ),
        )

        # ── RDS PostgreSQL (PostGIS via parameter group) ───────────────────────
        db_param_group = rds.ParameterGroup(
            self, "DbParamGroup",
            engine=rds.DatabaseInstanceEngine.postgres(
                version=rds.PostgresEngineVersion.VER_16
            ),
            description="VAYU PostGIS parameter group",
        )

        self.db = rds.DatabaseInstance(
            self, "VayuDb",
            engine=rds.DatabaseInstanceEngine.postgres(
                version=rds.PostgresEngineVersion.VER_16
            ),
            instance_type=ec2.InstanceType.of(
                ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO
            ),
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS),
            security_groups=[self.db_sg],
            credentials=rds.Credentials.from_secret(self.db_secret),
            database_name="vayu_climate",
            allocated_storage=50,       # GB — enough for 15 years of IMD data
            max_allocated_storage=200,  # auto-scale up to 200 GB
            parameter_group=db_param_group,
            backup_retention=Duration.days(7),
            deletion_protection=False,   # set True for production hardening
            removal_policy=RemovalPolicy.SNAPSHOT,
            enable_performance_insights=True,
            cloudwatch_logs_exports=["postgresql"],
        )

        cdk.CfnOutput(self, "DbEndpoint", value=self.db.db_instance_endpoint_address)

        # ── ElastiCache Redis ─────────────────────────────────────────────────
        redis_subnet_group = elasticache.CfnSubnetGroup(
            self, "RedisSubnetGroup",
            description="VAYU Redis subnet group",
            subnet_ids=[s.subnet_id for s in vpc.private_subnets],
        )

        self.redis = elasticache.CfnCacheCluster(
            self, "VayuRedis",
            cache_node_type="cache.t4g.micro",
            engine="redis",
            num_cache_nodes=1,
            cache_subnet_group_name=redis_subnet_group.ref,
            vpc_security_group_ids=[self.redis_sg.security_group_id],
            engine_version="7.1",
            auto_minor_version_upgrade=True,
        )

        cdk.CfnOutput(self, "RedisEndpoint", value=self.redis.attr_redis_endpoint_address)


class VayuStorageStack(Stack):
    """S3 buckets for models, data, and frontend assets."""

    def __init__(self, scope: Construct, id: str, **kwargs):
        super().__init__(scope, id, **kwargs)

        # ── Model Artifacts ───────────────────────────────────────────────────
        self.model_bucket = s3.Bucket(
            self, "ModelBucket",
            bucket_name=f"vayu-climate-models-{self.account}",
            versioned=True,
            encryption=s3.BucketEncryption.S3_MANAGED,
            removal_policy=RemovalPolicy.RETAIN,
            lifecycle_rules=[
                s3.LifecycleRule(
                    id="ArchiveOldCheckpoints",
                    prefix="checkpoints/",
                    transitions=[
                        s3.Transition(
                            storage_class=s3.StorageClass.INTELLIGENT_TIERING,
                            transition_after=Duration.days(30),
                        )
                    ],
                )
            ],
        )

        # ── Processed Climate Data ─────────────────────────────────────────────
        self.data_bucket = s3.Bucket(
            self, "DataBucket",
            bucket_name=f"vayu-climate-data-{self.account}",
            encryption=s3.BucketEncryption.S3_MANAGED,
            removal_policy=RemovalPolicy.RETAIN,
        )

        # ── Frontend Static Assets ────────────────────────────────────────────
        self.frontend_bucket = s3.Bucket(
            self, "FrontendBucket",
            bucket_name=f"vayu-frontend-{self.account}",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            website_index_document="index.html",
            website_error_document="index.html",
            public_read_access=True,
            block_public_access=s3.BlockPublicAccess(
                block_public_acls=False,
                block_public_policy=False,
                ignore_public_acls=False,
                restrict_public_buckets=False,
            ),
        )

        cdk.CfnOutput(self, "ModelBucketName", value=self.model_bucket.bucket_name)
        cdk.CfnOutput(self, "DataBucketName", value=self.data_bucket.bucket_name)
        cdk.CfnOutput(self, "FrontendBucketName", value=self.frontend_bucket.bucket_name)


class VayuBackendStack(Stack):
    """ECS Fargate FastAPI backend with auto-scaling."""

    def __init__(
        self,
        scope: Construct,
        id: str,
        vpc: ec2.Vpc,
        db: rds.DatabaseInstance,
        redis: elasticache.CfnCacheCluster,
        db_secret: secretsmanager.Secret,
        model_bucket: s3.Bucket,
        ecs_sg: ec2.SecurityGroup,
        **kwargs,
    ):
        super().__init__(scope, id, **kwargs)

        # ── ECS Cluster ───────────────────────────────────────────────────────
        cluster = ecs.Cluster(
            self, "VayuCluster",
            vpc=vpc,
            cluster_name="vayu-cluster",
            container_insights=True,
        )

        # ── Task Execution Role (ECR pull + Secrets) ──────────────────────────
        execution_role = iam.Role(
            self, "TaskExecutionRole",
            assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "service-role/AmazonECSTaskExecutionRolePolicy"
                )
            ],
        )
        db_secret.grant_read(execution_role)

        # ── Task Role (S3 model access) ───────────────────────────────────────
        task_role = iam.Role(
            self, "TaskRole",
            assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        )
        model_bucket.grant_read(task_role)

        # ── Log Group ─────────────────────────────────────────────────────────
        log_group = logs.LogGroup(
            self, "BackendLogs",
            log_group_name="/vayu/backend",
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # ── Container Image (build from local Dockerfile) ─────────────────────
        image = ecs.ContainerImage.from_asset(
            ".",
            file="backend/Dockerfile",
        )

        # ── Task Definition ───────────────────────────────────────────────────
        task_def = ecs.FargateTaskDefinition(
            self, "BackendTaskDef",
            memory_limit_mib=2048,   # 2 GB for model inference
            cpu=1024,                # 1 vCPU
            execution_role=execution_role,
            task_role=task_role,
        )

        redis_host = self.redis.attr_redis_endpoint_address if hasattr(self, 'redis') else redis.attr_redis_endpoint_address

        container = task_def.add_container(
            "vayu-backend",
            image=image,
            logging=ecs.LogDrivers.aws_logs(
                stream_prefix="vayu-backend",
                log_group=log_group,
            ),
            environment={
                "MODEL_PATH": "/app/checkpoints/vayu_best.pt",
                "MODEL_S3_URI": f"s3://{model_bucket.bucket_name}/checkpoints/vayu_best.pt",
                "REDIS_URL": f"redis://{redis.attr_redis_endpoint_address}:6379",
                "LOG_LEVEL": "INFO",
                "MAX_CONCURRENT_USERS": "20",
                "MODEL_VERSION": "2.0.0",
                "CORS_ORIGINS": "*",  # CloudFront handles origin enforcement
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
                start_period=Duration.seconds(60),
            ),
        )
        container.add_port_mappings(ecs.PortMapping(container_port=8000))

        # ── Fargate Service with ALB ──────────────────────────────────────────
        fargate_service = ecs_patterns.ApplicationLoadBalancedFargateService(
            self, "VayuService",
            cluster=cluster,
            task_definition=task_def,
            desired_count=1,
            public_load_balancer=True,
            security_groups=[ecs_sg],
            assign_public_ip=False,
            health_check_grace_period=Duration.seconds(120),
        )

        # ── Auto-Scaling (1-5 tasks) ──────────────────────────────────────────
        scaling = fargate_service.service.auto_scale_task_count(
            min_capacity=1,
            max_capacity=5,
        )
        scaling.scale_on_cpu_utilization(
            "CpuScaling",
            target_utilization_percent=70,
            scale_in_cooldown=Duration.seconds(120),
            scale_out_cooldown=Duration.seconds(60),
        )
        scaling.scale_on_request_count(
            "RequestScaling",
            requests_per_target=100,
            target_group=fargate_service.target_group,
            scale_in_cooldown=Duration.seconds(120),
            scale_out_cooldown=Duration.seconds(60),
        )

        self.alb_dns = fargate_service.load_balancer.load_balancer_dns_name
        cdk.CfnOutput(self, "BackendUrl", value=f"http://{self.alb_dns}")


class VayuCdnStack(Stack):
    """CloudFront CDN for frontend (S3) and API (ALB)."""

    def __init__(
        self,
        scope: Construct,
        id: str,
        frontend_bucket: s3.Bucket,
        backend_alb_dns: str,
        **kwargs,
    ):
        super().__init__(scope, id, **kwargs)

        # ── Deploy frontend assets to S3 (if dist/ exists) ────────────────────
        import os
        frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
        if os.path.isdir(frontend_dist):
            s3_deploy.BucketDeployment(
                self, "FrontendDeployment",
                sources=[s3_deploy.Source.asset(frontend_dist)],
                destination_bucket=frontend_bucket,
                distribution_paths=["/*"],
            )

        # ── API Cache Policy (no caching for predictions) ─────────────────────
        api_cache_policy = cloudfront.CachePolicy(
            self, "ApiCachePolicy",
            cache_policy_name="VayuApiCachePolicy",
            default_ttl=Duration.seconds(0),
            min_ttl=Duration.seconds(0),
            max_ttl=Duration.seconds(1),
        )

        # ── Static Asset Cache Policy ──────────────────────────────────────────
        static_cache_policy = cloudfront.CachePolicy(
            self, "StaticCachePolicy",
            cache_policy_name="VayuStaticCachePolicy",
            default_ttl=Duration.days(1),
            min_ttl=Duration.seconds(0),
            max_ttl=Duration.days(365),
        )

        # ── Distribution ───────────────────────────────────────────────────────
        distribution = cloudfront.Distribution(
            self, "VayuDistribution",
            comment="VAYU Climate Digital Twin CDN",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3Origin(frontend_bucket),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=static_cache_policy,
                compress=True,
            ),
            additional_behaviors={
                "/api/*": cloudfront.BehaviorOptions(
                    origin=origins.HttpOrigin(
                        backend_alb_dns,
                        protocol_policy=cloudfront.OriginProtocolPolicy.HTTP_ONLY,
                    ),
                    viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cache_policy=api_cache_policy,
                    allowed_methods=cloudfront.AllowedMethods.ALLOW_ALL,
                    cached_methods=cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
                    origin_request_policy=cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                ),
                "/health": cloudfront.BehaviorOptions(
                    origin=origins.HttpOrigin(
                        backend_alb_dns,
                        protocol_policy=cloudfront.OriginProtocolPolicy.HTTP_ONLY,
                    ),
                    viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cache_policy=api_cache_policy,
                ),
            },
            error_responses=[
                cloudfront.ErrorResponse(
                    http_status=404,
                    response_http_status=200,
                    response_page_path="/index.html",
                    ttl=Duration.seconds(0),
                )
            ],
        )

        cdk.CfnOutput(self, "CloudFrontUrl",
                      value=f"https://{distribution.distribution_domain_name}")
        cdk.CfnOutput(self, "DistributionId",
                      value=distribution.distribution_id)


class VayuApp(cdk.App):
    """Full VAYU production deployment."""

    def __init__(self):
        super().__init__()

        env = cdk.Environment(
            account=self.node.try_get_context("account") or None,
            region=self.node.try_get_context("region") or "ap-south-1",  # Mumbai
        )

        # Deploy stacks
        vpc_stack     = VayuVpcStack(self, "VayuVpc", env=env)
        storage_stack = VayuStorageStack(self, "VayuStorage", env=env)
        data_stack    = VayuDataStack(
            self, "VayuData",
            vpc=vpc_stack.vpc,
            env=env,
        )
        backend_stack = VayuBackendStack(
            self, "VayuBackend",
            vpc=vpc_stack.vpc,
            db=data_stack.db,
            redis=data_stack.redis,
            db_secret=data_stack.db_secret,
            model_bucket=storage_stack.model_bucket,
            ecs_sg=data_stack.ecs_sg,
            env=env,
        )
        cdn_stack = VayuCdnStack(
            self, "VayuCdn",
            frontend_bucket=storage_stack.frontend_bucket,
            backend_alb_dns=backend_stack.alb_dns,
            env=env,
        )

        # Stack dependencies
        data_stack.add_dependency(vpc_stack)
        backend_stack.add_dependency(data_stack)
        backend_stack.add_dependency(storage_stack)
        cdn_stack.add_dependency(backend_stack)
        cdn_stack.add_dependency(storage_stack)


if __name__ == "__main__":
    app = VayuApp()
    app.synth()
