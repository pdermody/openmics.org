import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export type MediaStackProps = cdk.StackProps & {
  /** e.g. "dev", "staging", "prod" — used to namespace resource names. */
  environmentName: string;
  /** Apex domain (e.g. "openmics.org"). Media is served from a dedicated subdomain. */
  domainName: string;
  /** Must be an ACM certificate issued in us-east-1 whose SAN list covers the media subdomain (see certificate-stack.ts). */
  certificate: acm.ICertificate;
  /** The purge task reads PendingS3Deletions from the database, so it joins the VPC. */
  vpc: ec2.IVpc;
  databaseSecret: secretsmanager.ISecret;
  databaseSecurityGroup: ec2.ISecurityGroup;
  databaseHost: string;
  databaseName: string;
  /** Public base URL of the API/site (e.g. "https://openmics.org") — the rendition Lambda calls back here. */
  appBaseUrl: string;
};

/**
 * Media storage and delivery pipeline (see docs/decisions.md → "Media delivery"):
 *
 * - Private S3 bucket (OAC-only reads) with the flat per-media-id object layout:
 *   `tmp/{accountId}/{uuid}.{ext}` (24h lifecycle), `original/{mediaId}.{ext}`,
 *   `renditions/{mediaId}/{thumb|grid|lightbox}.webp`.
 * - A dedicated CloudFront distribution on `media.<domain>` (`media-<env>.<domain>` for
 *   non-prod) fronts the bucket. The media domain stays cookie-free and is deliberately
 *   NOT an alias on the main distribution.
 * - An SQS queue + Lambda consumer (mirroring the email pattern) generates sharp
 *   renditions and reports them back to the API's internal callback, signed with a
 *   shared secret generated here and shared with the API task.
 * - A scheduled (daily) Fargate purge task processes PendingS3Deletions rows. Its public
 *   IP lets it reach S3 in the no-NAT VPC; bytes are never deleted inline by the API.
 *
 * The bucket is RemovalPolicy.RETAIN from day one: `cdk destroy` of this stack must never
 * take user media with it.
 */
export class MediaStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly renditionsQueue: sqs.Queue;
  public readonly renditionsDeadLetterQueue: sqs.Queue;
  public readonly renditionsFunction: NodejsFunction;
  public readonly purgeTaskDefinition: ecs.FargateTaskDefinition;
  public readonly renditionsCallbackSecret: secretsmanager.Secret;
  public readonly mediaDomainName: string;
  public readonly mediaCdnBaseUrl: string;

  constructor(scope: Construct, id: string, props: MediaStackProps) {
    super(scope, id, { ...props, crossRegionReferences: true });

    this.mediaDomainName = props.environmentName === 'prod'
      ? `media.${props.domainName}`
      : `media-${props.environmentName}.${props.domainName}`;
    this.mediaCdnBaseUrl = `https://${this.mediaDomainName}`;

    this.bucket = new s3.Bucket(this, 'MediaBucket', {
      bucketName: `openmic-media-${props.environmentName}-${cdk.Stack.of(this).account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          // Browser PUTs go straight to S3 via presigned URLs from the SPA origin
          // (and localhost in local dev). CDN GETs through CloudFront are not CORS
          // traffic; the media origin is listed only for direct-to-bucket tooling.
          allowedOrigins: [
            `https://${props.domainName}`,
            `https://${this.mediaDomainName}`,
            'http://localhost:5173',
          ],
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedHeaders: ['Content-Type', 'Content-Disposition', 'Content-Length'],
          exposedHeaders: ['ETag'],
        },
      ],
      lifecycleRules: [
        {
          id: 'expire-abandoned-tmp-uploads',
          prefix: 'tmp/',
          expiration: cdk.Duration.days(1),
        },
      ],
    });

    this.distribution = new cloudfront.Distribution(this, 'MediaDistribution', {
      domainNames: [this.mediaDomainName],
      certificate: props.certificate,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      // Not an SPA: no errorResponses fallback. A missing object is a real 403/404.
    });

    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', { domainName: props.domainName });
    new route53.ARecord(this, 'MediaAliasRecord', {
      zone: hostedZone,
      recordName: this.mediaDomainName,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution)),
    });

    this.renditionsDeadLetterQueue = new sqs.Queue(this, 'MediaRenditionsDeadLetterQueue', {
      queueName: `openmic-media-renditions-dlq-${props.environmentName}`,
      retentionPeriod: cdk.Duration.days(14),
    });

    this.renditionsQueue = new sqs.Queue(this, 'MediaRenditionsQueue', {
      queueName: `openmic-media-renditions-${props.environmentName}`,
      visibilityTimeout: cdk.Duration.minutes(2),
      deadLetterQueue: {
        queue: this.renditionsDeadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    // Shared secret for the rendition callback: generated here, injected into the API
    // task (api-stack.ts) as a container secret, and read by the rendition Lambda at
    // cold start so it can HMAC-sign its callback body.
    this.renditionsCallbackSecret = new secretsmanager.Secret(this, 'MediaRenditionsCallbackSecret', {
      secretName: `openmic-media-renditions-callback-secret-${props.environmentName}`,
      generateSecretString: { excludePunctuation: true, passwordLength: 40 },
    });

    this.renditionsFunction = new NodejsFunction(this, 'MediaRenditionsFunction', {
      functionName: `openmic-media-renditions-${props.environmentName}`,
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: `${__dirname}/lambda/media-renditions/index.ts`,
      handler: 'handler',
      timeout: cdk.Duration.minutes(2),
      memorySize: 1024,
      bundling: {
        minify: true,
        sourceMap: true,
        // sharp ships native binaries, so bundling must run in a Lambda-matching
        // container instead of using the host esbuild.
        forceDockerBundling: true,
      },
      environment: {
        MEDIA_BUCKET: this.bucket.bucketName,
        MEDIA_CDN_BASE_URL: this.mediaCdnBaseUrl,
        API_BASE_URL: props.appBaseUrl,
        CALLBACK_SECRET_ARN: this.renditionsCallbackSecret.secretArn,
      },
    });

    this.renditionsFunction.addEventSource(new lambdaEventSources.SqsEventSource(this.renditionsQueue, {
      batchSize: 5,
      reportBatchItemFailures: true,
    }));

    this.bucket.grantReadWrite(this.renditionsFunction);
    this.renditionsCallbackSecret.grantRead(this.renditionsFunction);

    const purgeSecurityGroup = new ec2.SecurityGroup(this, 'PurgeSecurityGroup', {
      vpc: props.vpc,
      description: 'Scheduled media purge task (reads PendingS3Deletions, deletes S3 objects)',
    });

    new ec2.CfnSecurityGroupIngress(this, 'AllowPurgeLambdaToDatabase', {
      groupId: props.databaseSecurityGroup.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 5432,
      toPort: 5432,
      sourceSecurityGroupId: purgeSecurityGroup.securityGroupId,
    });

    const purgeCluster = new ecs.Cluster(this, 'MediaPurgeCluster', {
      vpc: props.vpc,
      clusterName: `openmic-media-workers-${props.environmentName}`,
    });
    this.purgeTaskDefinition = new ecs.FargateTaskDefinition(this, 'MediaPurgeTaskDefinition', {
      cpu: 256,
      memoryLimitMiB: 512,
    });
    this.purgeTaskDefinition.addContainer('MediaPurgeContainer', {
      image: ecs.ContainerImage.fromAsset(`${__dirname}/../..`, { file: 'apps/api/Dockerfile' }),
      command: ['node', 'dist/apps/api/src/media/purge-cli.js'],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'purge',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        NODE_ENV: 'production',
        AWS_REGION: cdk.Stack.of(this).region,
        PGHOST: props.databaseHost,
        PGDATABASE: props.databaseName,
        PGSSLMODE: 'no-verify',
        MEDIA_BUCKET: this.bucket.bucketName,
      },
      secrets: {
        PGUSER: ecs.Secret.fromSecretsManager(props.databaseSecret, 'username'),
        PGPASSWORD: ecs.Secret.fromSecretsManager(props.databaseSecret, 'password'),
      },
    });

    this.purgeTaskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['s3:DeleteObject'],
      resources: [this.bucket.arnForObjects('*')],
    }));

    new events.Rule(this, 'MediaPurgeSchedule', {
      ruleName: `openmic-media-purge-${props.environmentName}`,
      schedule: events.Schedule.rate(cdk.Duration.days(1)),
      targets: [new eventsTargets.EcsTask({
        cluster: purgeCluster,
        taskDefinition: this.purgeTaskDefinition,
        taskCount: 1,
        launchType: ecs.LaunchType.FARGATE,
        subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
        securityGroups: [purgeSecurityGroup],
        assignPublicIp: true,
      })],
    });

    new cdk.CfnOutput(this, 'MediaBucketName', { value: this.bucket.bucketName });
    new cdk.CfnOutput(this, 'MediaDistributionDomainName', { value: this.distribution.distributionDomainName });
    new cdk.CfnOutput(this, 'MediaCdnBaseUrl', { value: this.mediaCdnBaseUrl });
    new cdk.CfnOutput(this, 'RenditionsQueueUrl', { value: this.renditionsQueue.queueUrl });
    new cdk.CfnOutput(this, 'PurgeTaskDefinitionArn', { value: this.purgeTaskDefinition.taskDefinitionArn });
    new cdk.CfnOutput(this, 'PurgeClusterName', { value: purgeCluster.clusterName });
    new cdk.CfnOutput(this, 'PurgeSecurityGroupId', { value: purgeSecurityGroup.securityGroupId });
    new cdk.CfnOutput(this, 'PurgePublicSubnetIds', {
      value: cdk.Fn.join(',', props.vpc.publicSubnets.map((subnet) => subnet.subnetId)),
    });
  }
}
