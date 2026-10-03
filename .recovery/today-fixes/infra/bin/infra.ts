#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EmailStack } from '../lib/email-stack';
import { AuthStack } from '../lib/auth-stack';
import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { CertificateStack } from '../lib/certificate-stack';
import { MediaStack } from '../lib/media-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { MigrationStack } from '../lib/migration-stack';

const app = new cdk.App();

const environmentName = app.node.tryGetContext('environmentName') ?? process.env.OPENMIC_ENVIRONMENT ?? 'dev';
const domainName = app.node.tryGetContext('domainName') ?? process.env.OPENMIC_SES_DOMAIN ?? 'openmics.org';
const senderAddress = app.node.tryGetContext('senderAddress') ?? process.env.OPENMIC_SES_SENDER ?? `noreply@${domainName}`;
const callbackUrls = (
  app.node.tryGetContext('authCallbackUrls') ??
  process.env.OPENMIC_AUTH_CALLBACK_URLS ??
  'http://localhost:5173,https://openmics.org'
)
  .split(',')
  .map((url: string) => url.trim());

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const emailStack = new EmailStack(app, `OpenMicEmailStack-${environmentName}`, {
  environmentName,
  domainName,
  senderAddress,
  env,
});

const authStack = new AuthStack(app, `OpenMicAuthStack-${environmentName}`, {
  environmentName,
  callbackUrls,
  env,
});

const networkStack = new NetworkStack(app, `OpenMicNetworkStack-${environmentName}`, {
  environmentName,
  env,
});

const databaseStack = new DatabaseStack(app, `OpenMicDatabaseStack-${environmentName}`, {
  environmentName,
  vpc: networkStack.vpc,
  env,
});

// CloudFront certificates must live in us-east-1 regardless of the app's home region.
const certificateStack = new CertificateStack(app, `OpenMicCertificateStack-${environmentName}`, {
  domainName,
  environmentName,
  env: { account: env.account, region: 'us-east-1' },
});

// Media storage/delivery (bucket, media subdomain distribution, renditions queue +
// Lambdas) must exist before the API task so its env/IAM can reference them.
const mediaStack = new MediaStack(app, `OpenMicMediaStack-${environmentName}`, {
  environmentName,
  domainName,
  certificate: certificateStack.certificate,
  vpc: networkStack.vpc,
  databaseSecret: databaseStack.instance.secret!,
  databaseSecurityGroup: databaseStack.securityGroup,
  databaseHost: databaseStack.instance.dbInstanceEndpointAddress,
  databaseName: databaseStack.databaseName,
  appBaseUrl: `https://${domainName}`,
  env,
});

const apiStack = new ApiStack(app, `OpenMicApiStack-${environmentName}`, {
  environmentName,
  vpc: networkStack.vpc,
  databaseSecret: databaseStack.instance.secret!,
  databaseSecurityGroup: databaseStack.securityGroup,
  databaseHost: databaseStack.instance.dbInstanceEndpointAddress,
  databaseName: databaseStack.databaseName,
  emailQueue: emailStack.emailQueue,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
  appBaseUrl: `https://${domainName}`,
  mediaBucket: mediaStack.bucket,
  mediaCdnBaseUrl: mediaStack.mediaCdnBaseUrl,
  mediaRenditionsQueue: mediaStack.renditionsQueue,
  mediaRenditionsCallbackSecret: mediaStack.renditionsCallbackSecret,
  env,
});

new MigrationStack(app, `OpenMicMigrationStack-${environmentName}`, {
  environmentName,
  vpc: networkStack.vpc,
  databaseSecret: databaseStack.instance.secret!,
  databaseSecurityGroup: databaseStack.securityGroup,
  databaseHost: databaseStack.instance.dbInstanceEndpointAddress,
  databaseName: databaseStack.databaseName,
  env,
});

new FrontendStack(app, `OpenMicFrontendStack-${environmentName}`, {
  environmentName,
  domainName,
  certificate: certificateStack.certificate,
  apiLoadBalancer: apiStack.loadBalancer,
  env,
});

