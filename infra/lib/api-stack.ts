import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export type ApiStackProps = cdk.StackProps & {
  /** e.g. "dev", "staging", "prod" — used to namespace resource names. */
  environmentName: string;
  vpc: ec2.Vpc;
  databaseSecret: secretsmanager.ISecret;
  databaseSecurityGroup: ec2.ISecurityGroup;
  databaseHost: string;
  databaseName: string;
  emailQueue: sqs.IQueue;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  appBaseUrl: string;
};

/**
 * ECS Fargate API service, run on Fargate Spot to minimize compute cost for the MVP launch
 * (user accepted the interruption-risk tradeoff — see the plan's event-day runbook note about
 * switching to on-demand capacity for the event window itself).
 *
 * TLS terminates at CloudFront (frontend-stack.ts); the ALB here is plain HTTP, matching the
 * `/api/*` origin behavior wired there.
 */
export class ApiStack extends cdk.Stack {
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly service: ecs.FargateService;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const streamTokenSecret = new secretsmanager.Secret(this, 'StreamTokenSecret', {
      secretName: `openmic-stream-token-secret-${props.environmentName}`,
      generateSecretString: { excludePunctuation: true, passwordLength: 40 },
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: props.vpc,
      clusterName: `openmic-${props.environmentName}`,
      enableFargateCapacityProviders: true,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: 256,
      memoryLimitMiB: 512,
    });

    taskDefinition.addContainer('ApiContainer', {
      image: ecs.ContainerImage.fromAsset(`${__dirname}/../..`, { file: 'apps/api/Dockerfile' }),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'api',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '3000',
        AWS_REGION: cdk.Stack.of(this).region,
        // Explicit, not just omitted, so it can't be left enabled by a stray container env change.
        SIMULATED_AUTH_MODE: 'false',
        EMAIL_ADAPTER: 'ses',
        EMAIL_QUEUE_URL: props.emailQueue.queueUrl,
        COGNITO_USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClient.userPoolClientId,
        APP_BASE_URL: props.appBaseUrl,
        PGHOST: props.databaseHost,
        PGDATABASE: props.databaseName,
        // RDS rejects unencrypted connections; "no-verify" encrypts without needing the RDS CA
        // bundle mounted (Node's default trust store doesn't include it). Needed by node-pg-migrate
        // (run via one-off task override), which reads raw PG* env vars, not our composed DATABASE_URL.
        PGSSLMODE: 'no-verify',
      },
      secrets: {
        PGUSER: ecs.Secret.fromSecretsManager(props.databaseSecret, 'username'),
        PGPASSWORD: ecs.Secret.fromSecretsManager(props.databaseSecret, 'password'),
        STREAM_TOKEN_SECRET: ecs.Secret.fromSecretsManager(streamTokenSecret),
      },
      portMappings: [{ containerPort: 3000 }],
    });

    props.emailQueue.grantSendMessages(taskDefinition.taskRole);

    const serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
      vpc: props.vpc,
      description: 'Fargate API service',
    });

    this.service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [serviceSecurityGroup],
      capacityProviderStrategies: [{ capacityProvider: 'FARGATE_SPOT', weight: 1 }],
      circuitBreaker: { rollback: true },
    });

    // Standalone ingress resource (not an inline rule on the DB stack's security group) so this
    // stack depends on DatabaseStack without creating a reverse/circular dependency.
    new ec2.CfnSecurityGroupIngress(this, 'AllowApiToDatabase', {
      groupId: props.databaseSecurityGroup.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 5432,
      toPort: 5432,
      sourceSecurityGroupId: serviceSecurityGroup.securityGroupId,
    });

    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: props.vpc,
      description: 'Public ALB in front of the Fargate API service',
    });
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Public HTTP (TLS terminates at CloudFront)');
    serviceSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(3000), 'ALB to task');

    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const listener = this.loadBalancer.addListener('HttpListener', { port: 80, open: false });
    listener.addTargets('ApiTargets', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.service],
      healthCheck: { path: '/health', healthyHttpCodes: '200' },
    });

    new cdk.CfnOutput(this, 'LoadBalancerDnsName', { value: this.loadBalancer.loadBalancerDnsName });
  }
}
