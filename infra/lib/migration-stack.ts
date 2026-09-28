import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export type MigrationStackProps = cdk.StackProps & {
  environmentName: string;
  vpc: ec2.IVpc;
  databaseSecret: secretsmanager.ISecret;
  databaseSecurityGroup: ec2.ISecurityGroup;
  databaseHost: string;
  databaseName: string;
};

/**
 * An operator-triggered Fargate task for applying database migrations with the release image.
 * It is intentionally separate from the API service so migrations can run before API rollout.
 */
export class MigrationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MigrationStackProps) {
    super(scope, id, props);

    const migrationSecurityGroup = new ec2.SecurityGroup(this, 'MigrationSecurityGroup', {
      vpc: props.vpc,
      description: 'One-off database migration task',
    });

    new ec2.CfnSecurityGroupIngress(this, 'AllowMigrationTaskToDatabase', {
      groupId: props.databaseSecurityGroup.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 5432,
      toPort: 5432,
      sourceSecurityGroupId: migrationSecurityGroup.securityGroupId,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: 256,
      memoryLimitMiB: 512,
    });

    taskDefinition.addContainer('MigrationContainer', {
      image: ecs.ContainerImage.fromAsset(`${__dirname}/../..`, { file: 'apps/api/Dockerfile' }),
      command: ['node', 'node_modules/node-pg-migrate/bin/node-pg-migrate.js', 'up', '--dry-run', '-m', 'apps/api/migrations'],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'migration',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        NODE_ENV: 'production',
        PGHOST: props.databaseHost,
        PGDATABASE: props.databaseName,
        PGSSLMODE: 'no-verify',
      },
      secrets: {
        PGUSER: ecs.Secret.fromSecretsManager(props.databaseSecret, 'username'),
        PGPASSWORD: ecs.Secret.fromSecretsManager(props.databaseSecret, 'password'),
      },
    });

    new cdk.CfnOutput(this, 'MigrationTaskDefinitionArn', { value: taskDefinition.taskDefinitionArn });
    new cdk.CfnOutput(this, 'ClusterName', { value: `openmic-${props.environmentName}` });
    new cdk.CfnOutput(this, 'MigrationSecurityGroupId', { value: migrationSecurityGroup.securityGroupId });
    new cdk.CfnOutput(this, 'PublicSubnetIds', {
      value: cdk.Fn.join(',', props.vpc.publicSubnets.map((subnet) => subnet.subnetId)),
    });
  }
}