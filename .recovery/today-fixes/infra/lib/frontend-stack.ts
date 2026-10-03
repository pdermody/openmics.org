import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

export type FrontendStackProps = cdk.StackProps & {
  /** e.g. "dev", "staging", "prod" — used to namespace resource names. */
  environmentName: string;
  domainName: string;
  /** Must be an ACM certificate issued in us-east-1 (see certificate-stack.ts). */
  certificate: acm.ICertificate;
  apiLoadBalancer: elbv2.IApplicationLoadBalancer;
};

/**
 * S3 (private, OAC) + CloudFront SPA hosting, single domain shared with the API: the default
 * behavior serves the built `apps/web` bundle, and `/api/*` forwards to the ALB in front of the
 * ECS Fargate service (api-stack.ts). One domain/cert covers this because vanity handle URLs are
 * path-based (`/@:handle`), not subdomain-based — see docs/6-open-mic-vanity-urls.md.
 *
 * Requires `apps/web` to already be built (`npm run build:web`) before `cdk deploy`/`cdk synth`,
 * since the S3 deployment asset is read from `apps/web/dist` at synth time.
 */
export class FrontendStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, { ...props, crossRegionReferences: true });

    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: `openmic-web-${props.environmentName}-${cdk.Stack.of(this).account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Redirects www -> apex before index.html ever loads, so no client ever hits /api/* on www.
    const wwwRedirectFunction = new cloudfront.Function(this, 'WwwRedirectFunction', {
      code: cloudfront.FunctionCode.fromInline(`
        function handler(event) {
          var request = event.request;
          var host = request.headers.host && request.headers.host.value;
          if (host === 'www.${props.domainName}') {
            return {
              statusCode: 301,
              statusDescription: 'Moved Permanently',
              headers: { location: { value: 'https://${props.domainName}' + request.uri + (request.querystring ? '?' + Object.keys(request.querystring).map(function (k) { return k + '=' + request.querystring[k].value; }).join('&') : '') } },
            };
          }
          return request;
        }
      `),
    });

    // OG-stamped SPA HTML for media deep links is rendered by the API (spa-routes.ts),
    // so /media/* must reach the ALB rather than the SPA bucket. The API sets
    // `Cache-Control: public, s-maxage=3600, max-age=0`; this policy lets the edge honor
    // the 60-minute s-maxage while browsers always revalidate.
    const mediaDeepLinkCachePolicy = new cloudfront.CachePolicy(this, 'MediaDeepLinkCachePolicy', {
      cachePolicyName: `openmic-media-deep-links-${props.environmentName}`,
      comment: 'OG-stamped SPA HTML for /media/* deep links (s-maxage 3600 honored at the edge)',
      minTtl: cdk.Duration.seconds(0),
      defaultTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.seconds(3600),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      domainNames: [props.domainName, `www.${props.domainName}`],
      certificate: props.certificate,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [{ function: wwwRedirectFunction, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.LoadBalancerV2Origin(props.apiLoadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        '/media/*': {
          origin: new origins.LoadBalancerV2Origin(props.apiLoadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: mediaDeepLinkCachePolicy,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      // SPA client-side routing: unknown paths (e.g. /@handle) 404/403 at S3, re-served as index.html.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(`${__dirname}/../../apps/web/dist`)],
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });

    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', { domainName: props.domainName });

    new route53.ARecord(this, 'SiteAliasRecord', {
      zone: hostedZone,
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution)),
    });

    new route53.ARecord(this, 'WwwAliasRecord', {
      zone: hostedZone,
      recordName: `www.${props.domainName}`,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution)),
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', { value: this.distribution.distributionDomainName });
    new cdk.CfnOutput(this, 'SiteBucketName', { value: this.bucket.bucketName });
  }
}
