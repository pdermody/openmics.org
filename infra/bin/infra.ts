#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EmailStack } from '../lib/email-stack';
import { AuthStack } from '../lib/auth-stack';

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

new EmailStack(app, `OpenMicEmailStack-${environmentName}`, {
  environmentName,
  domainName,
  senderAddress,
  env,
});

new AuthStack(app, `OpenMicAuthStack-${environmentName}`, {
  environmentName,
  callbackUrls,
  env,
});
