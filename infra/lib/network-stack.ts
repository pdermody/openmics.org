import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export type NetworkStackProps = cdk.StackProps & {
  /** e.g. "dev", "staging", "prod" — used to namespace resource names. */
  environmentName: string;
};

/**
 * Minimal VPC for the MVP launch: no NAT Gateway (cost/time tradeoff). RDS sits in isolated
 * private subnets (needs no internet route); the Fargate service runs in public subnets with
 * a public IP instead, so it can still reach Cognito JWKS/SQS/LocationIQ. Revisit before scaling
 * past the first event (see docs/decisions.md → Infrastructure, Milestone 7 hardening).
 */
export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `openmic-${props.environmentName}`,
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
  }
}
