import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

export type CertificateStackProps = cdk.StackProps & {
  domainName: string;
};

/**
 * ACM certificates used by CloudFront must be requested in us-east-1 regardless of the app's
 * home region — this stack is always deployed with `env.region: 'us-east-1'` (see bin/infra.ts)
 * and exposes the certificate cross-region via `crossRegionReferences`.
 *
 * Assumes `domainName`'s hosted zone already exists in Route53 (see the plan's Phase A: the
 * registrar's NS records must already point at Route53 before this can validate).
 */
export class CertificateStack extends cdk.Stack {
  public readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, { ...props, crossRegionReferences: true });

    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', { domainName: props.domainName });

    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.domainName,
      // Include the www variant so it can share this same cert/CloudFront distribution.
      subjectAlternativeNames: [`www.${props.domainName}`],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });
  }
}
