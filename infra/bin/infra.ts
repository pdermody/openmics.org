#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EmailStack } from '../lib/email-stack';

const app = new cdk.App();

const environmentName = app.node.tryGetContext('environmentName') ?? process.env.OPENMIC_ENVIRONMENT ?? 'dev';
const domainName = app.node.tryGetContext('domainName') ?? process.env.OPENMIC_SES_DOMAIN ?? 'openmics.org';
const senderAddress = app.node.tryGetContext('senderAddress') ?? process.env.OPENMIC_SES_SENDER ?? `noreply@${domainName}`;

new EmailStack(app, `OpenMicEmailStack-${environmentName}`, {
  environmentName,
  domainName,
  senderAddress,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
