import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export type AuthStackProps = cdk.StackProps & {
  /** e.g. "dev", "staging", "prod" — used to namespace resource names. */
  environmentName: string;
  /** Callback/logout URLs the hosted UI is allowed to redirect back to (SPA origins). */
  callbackUrls: string[];
  /** Require MFA at sign-in. Optional for MVP per docs/architecture/infrastructure.md §3.4. */
  requireMfa?: boolean;
};

/**
 * Cognito User Pool + hosted-UI app client used by the frontend (Amplify SDK) and verified
 * server-side by the API's `createCognitoVerifier` (apps/api/src/auth/cognito-verifier.ts).
 *
 * The pool stores only identity claims (email, sub); all app-specific performer/organizer
 * data stays in PostgreSQL (see docs/architecture/infrastructure.md §3.4).
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `openmic-${props.environmentName}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      mfa: props.requireMfa ? cognito.Mfa.REQUIRED : cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `openmic-${props.environmentName}-spa`,
      // SPA (public) client: no client secret, since it can't be kept confidential in the browser.
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: props.callbackUrls,
        logoutUrls: props.callbackUrls,
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
    });

    // Cognito's default domain prefix must be globally unique; namespace it with the account id
    // rather than committing to a custom domain (which needs Route53 + ACM) before it's needed.
    this.userPoolDomain = this.userPool.addDomain('UserPoolDomain', {
      cognitoDomain: {
        domainPrefix: `openmic-${props.environmentName}-${cdk.Stack.of(this).account}`,
      },
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'UserPoolDomainUrl', {
      value: this.userPoolDomain.baseUrl(),
    });
  }
}
