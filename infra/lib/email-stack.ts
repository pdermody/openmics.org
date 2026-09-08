import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export type EmailStackProps = cdk.StackProps & {
  /** e.g. "dev", "staging", "prod" — used to namespace resource names. */
  environmentName: string;
  /** Domain to verify with SES (e.g. "openmics.org"). DNS records must be added manually after deploy. */
  domainName: string;
  /** Default "From" address used by the email-sender Lambda. */
  senderAddress: string;
};

/**
 * SES + SQS + Lambda transactional email pipeline.
 *
 * The API never calls SES directly: it enqueues a JSON message onto `emailQueue`,
 * and this Lambda (subscribed as an SQS event source) sends the message via SES.
 * Failed sends are retried by SQS and land in `emailDeadLetterQueue` after 3 attempts.
 */
export class EmailStack extends cdk.Stack {
  public readonly emailQueue: sqs.Queue;
  public readonly emailDeadLetterQueue: sqs.Queue;
  public readonly emailSenderFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props);

    const domainIdentity = new ses.EmailIdentity(this, 'DomainIdentity', {
      identity: ses.Identity.domain(props.domainName),
    });

    this.emailDeadLetterQueue = new sqs.Queue(this, 'EmailDeadLetterQueue', {
      queueName: `openmic-email-dlq-${props.environmentName}`,
      retentionPeriod: cdk.Duration.days(14),
    });

    this.emailQueue = new sqs.Queue(this, 'EmailQueue', {
      queueName: `openmic-email-${props.environmentName}`,
      visibilityTimeout: cdk.Duration.seconds(30),
      deadLetterQueue: {
        queue: this.emailDeadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    this.emailSenderFunction = new NodejsFunction(this, 'EmailSenderFunction', {
      functionName: `openmic-email-sender-${props.environmentName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: `${__dirname}/lambda/email-sender/index.ts`,
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      bundling: { minify: true, sourceMap: true },
      environment: {
        SENDER_ADDRESS: props.senderAddress,
      },
    });

    this.emailSenderFunction.addEventSource(new lambdaEventSources.SqsEventSource(this.emailQueue, {
      batchSize: 10,
      reportBatchItemFailures: true,
    }));

    this.emailSenderFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: [domainIdentity.emailIdentityArn],
    }));

    new cdk.CfnOutput(this, 'EmailQueueUrl', { value: this.emailQueue.queueUrl });
    new cdk.CfnOutput(this, 'EmailQueueArn', { value: this.emailQueue.queueArn });
    new cdk.CfnOutput(this, 'EmailDeadLetterQueueUrl', { value: this.emailDeadLetterQueue.queueUrl });
    new cdk.CfnOutput(this, 'SesDkimVerificationRecords', {
      value: 'Check the SES console for this identity\'s DKIM CNAME records; add them to DNS to complete domain verification.',
    });
  }
}
