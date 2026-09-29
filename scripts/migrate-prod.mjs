import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const profile = process.env.AWS_PROFILE ?? 'openmic';
const region = process.env.AWS_REGION ?? 'eu-west-1';
const environment = process.env.OPENMIC_ENVIRONMENT ?? 'prod';
const expectedAccount = process.env.OPENMIC_AWS_ACCOUNT ?? '163742164398';
const assumeYes = process.argv.includes('--yes');

const stackName = `OpenMicMigrationStack-${environment}`;
const containerName = 'MigrationContainer';
const migrateCommand = 'node node_modules/node-pg-migrate/bin/node-pg-migrate.js up -m apps/api/migrations';
const listMarker = '__END_MIGRATION_LIST__';
const localMigrations = readdirSync(new URL('../apps/api/migrations', import.meta.url)).filter((name) => name.endsWith('.cjs'));

async function aws(args) {
  const { stdout } = await exec('aws', [...args, '--profile', profile, '--region', region, '--output', 'json'], {
    env: { ...process.env, AWS_PAGER: '' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadTarget() {
  const identity = await aws(['sts', 'get-caller-identity']);
  if (identity.Account !== expectedAccount) {
    fail(`AWS profile "${profile}" resolves to account ${identity.Account}, expected ${expectedAccount}.`);
  }

  const stacks = await aws(['cloudformation', 'describe-stacks', '--stack-name', stackName]);
  const outputs = Object.fromEntries((stacks.Stacks[0].Outputs ?? []).map((output) => [output.OutputKey, output.OutputValue]));
  const taskDefinition = outputs.MigrationTaskDefinitionArn;
  if (!taskDefinition) fail(`${stackName} has no MigrationTaskDefinitionArn output. Deploy it first.`);

  const definition = await aws(['ecs', 'describe-task-definition', '--task-definition', taskDefinition]);
  const logOptions = definition.taskDefinition.containerDefinitions.find((container) => container.name === containerName).logConfiguration.options;

  return {
    cluster: outputs.ClusterName,
    taskDefinition,
    subnets: outputs.PublicSubnetIds.split(','),
    securityGroup: outputs.MigrationSecurityGroupId,
    logGroup: logOptions['awslogs-group'],
    logStreamPrefix: logOptions['awslogs-stream-prefix'],
  };
}

async function runTask(target, command, startedBy) {
  const started = await aws([
    'ecs', 'run-task',
    '--cluster', target.cluster,
    '--task-definition', target.taskDefinition,
    '--launch-type', 'FARGATE',
    '--count', '1',
    '--started-by', startedBy,
    '--network-configuration', JSON.stringify({
      awsvpcConfiguration: { subnets: target.subnets, securityGroups: [target.securityGroup], assignPublicIp: 'ENABLED' },
    }),
    '--overrides', JSON.stringify({ containerOverrides: [{ name: containerName, command: ['sh', '-c', command] }] }),
  ]);
  if (started.failures?.length) fail(`ECS could not start the task: ${JSON.stringify(started.failures)}`);

  const taskArn = started.tasks[0].taskArn;
  const taskId = taskArn.split('/').pop();
  console.log(`Started ${startedBy} task ${taskId}; waiting for it to stop...`);
  await aws(['ecs', 'wait', 'tasks-stopped', '--cluster', target.cluster, '--tasks', taskArn]);

  const described = await aws(['ecs', 'describe-tasks', '--cluster', target.cluster, '--tasks', taskArn]);
  const task = described.tasks[0];
  const container = task.containers.find((item) => item.name === containerName);

  const logStream = `${target.logStreamPrefix}/${containerName}/${taskId}`;
  let lines = [];
  // CloudWatch can lag a few seconds behind the task stopping.
  for (let attempt = 0; attempt < 5 && lines.length === 0; attempt += 1) {
    if (attempt > 0) await sleep(3000);
    try {
      const events = await aws(['logs', 'get-log-events', '--log-group-name', target.logGroup, '--log-stream-name', logStream, '--start-from-head']);
      // node-pg-migrate warns once per file because our numeric prefixes aren't timestamps.
      lines = events.events.map((event) => event.message).filter((line) => !line.startsWith("Can't determine timestamp"));
    } catch {
      lines = [];
    }
  }

  if (container?.exitCode !== 0) {
    console.error(lines.join('\n'));
    fail(`${startedBy} task failed (exit code ${container?.exitCode ?? 'none'}): ${task.stoppedReason ?? 'no reason reported'}`);
  }
  return lines;
}

async function dryRun(target, startedBy) {
  const lines = await runTask(target, `ls -1 apps/api/migrations && echo ${listMarker} && ${migrateCommand} --dry-run`, startedBy);
  const markerIndex = lines.indexOf(listMarker);
  if (markerIndex === -1) fail('Could not read the migration list from the task logs.');

  const imageMigrations = new Set(lines.slice(0, markerIndex).map((line) => line.trim()));
  const missing = localMigrations.filter((name) => !imageMigrations.has(name));
  if (missing.length > 0) {
    fail(`The deployed migration image is missing ${missing.join(', ')}.\nRedeploy ${stackName} first (cdk deploy ${stackName} --exclusively).`);
  }

  const output = lines.slice(markerIndex + 1);
  console.log(output.join('\n'));
  return { output, upToDate: output.some((line) => line.includes('No migrations to run')) };
}

async function recoveryPoint() {
  const instances = await aws(['rds', 'describe-db-instances']);
  const instance = instances.DBInstances.find((item) => item.DBInstanceIdentifier.startsWith(`openmicdatabasestack-${environment}`));
  return instance ? `${instance.DBInstanceIdentifier} restorable to ${instance.LatestRestorableTime}` : 'unknown (database instance not found)';
}

async function confirm() {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) fail('Refusing to apply migrations without a terminal. Re-run with --yes to confirm.');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question('\nType "yes" to apply these migrations to production: ');
  prompt.close();
  return answer.trim() === 'yes';
}

console.log(`Target: ${environment} (account ${expectedAccount}, ${region}, profile ${profile})`);
const target = await loadTarget();

console.log('\nChecking pending migrations (dry run)...');
const preview = await dryRun(target, 'migration-dry-run');
if (preview.upToDate) {
  console.log('\nDatabase is already up to date.');
  process.exit(0);
}

console.log(`\nRecovery point: ${await recoveryPoint()}`);
console.log('Migrations cannot be rolled back with "down" once data has been changed; recovery means restoring from that point.');
if (!(await confirm())) fail('Aborted; no migrations were applied.');

console.log('\nApplying migrations...');
console.log((await runTask(target, migrateCommand, 'migration-apply')).join('\n'));

console.log('\nVerifying...');
const check = await dryRun(target, 'migration-postcheck');
if (!check.upToDate) fail('Migrations still pending after apply.');
console.log('\nProduction database is up to date.');
