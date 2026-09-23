import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

export type DatabaseStackProps = cdk.StackProps & {
  /** e.g. "dev", "staging", "prod" — used to namespace resource names. */
  environmentName: string;
  vpc: ec2.Vpc;
};

/**
 * Single-AZ RDS PostgreSQL/PostGIS instance, sized for the MVP launch (cost-minimized, not HA;
 * see plan's "Cost minimization" notes). Credentials are auto-generated into Secrets Manager;
 * api-stack.ts injects the individual username/password/host fields into the API's task
 * (see apps/api/src/config.ts PGHOST/PGUSER/PGPASSWORD support).
 */
export class DatabaseStack extends cdk.Stack {
  public readonly instance: rds.DatabaseInstance;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly databaseName = 'openmic';

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    this.securityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: props.vpc,
      description: 'RDS Postgres. Inbound rules added by api-stack.ts for the Fargate service only',
      allowAllOutbound: false,
    });

    this.instance = new rds.DatabaseInstance(this, 'Database', {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_13 }),
      // Graviton burstable instance — cheaper than the equivalent t3 for this low-traffic MVP.
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MICRO),
      allocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      credentials: rds.Credentials.fromGeneratedSecret('openmic', {
        secretName: `openmic-db-credentials-${props.environmentName}`,
      }),
      databaseName: this.databaseName,
      securityGroups: [this.securityGroup],
      multiAz: false,
      backupRetention: cdk.Duration.days(3),
      deleteAutomatedBackups: true,
      storageEncrypted: true,
      // Performance Insights / Enhanced Monitoring intentionally left off to minimize cost.
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', { value: this.instance.secret!.secretArn });
    new cdk.CfnOutput(this, 'DatabaseEndpoint', { value: this.instance.dbInstanceEndpointAddress });
  }
}
