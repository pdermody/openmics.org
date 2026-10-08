import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const containerName = 'MigrationContainer';
const migrateCommand = 'node node_modules/node-pg-migrate/bin/node-pg-migrate.js up -m apps/api/migrations';
const cityImportCommand = 'node dist/apps/api/src/cities/import-cli.js';
const listMarker = '__END_MIGRATION_LIST__';
const migratedMarker = '__MIGRATIONS_COMMITTED__';
const importedMarker = '__CITY_IMPORT_COMMITTED__';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runProductionMigration({
  args = process.argv.slice(2),
  env = process.env,
  aws: providedAws,
  print = console.log,
  wait = sleep,
  confirm: providedConfirm,
} = {}) {
  const approvals = args.filter((argument) => argument.startsWith('--expected-preview='));
  const unsupported = args.filter((argument) => !['--preview', '--yes'].includes(argument) && !approvals.includes(argument));
  const expectedPreview = approvals[0]?.slice('--expected-preview='.length);
  if (unsupported.length || (args.includes('--preview') && args.includes('--yes')) ||
      approvals.length > 1 || (expectedPreview !== undefined && !/^[a-f0-9]{64}$/.test(expectedPreview))) {
    throw new Error('Use either --preview or --yes, optionally with --expected-preview=<SHA256>.');
  }
  const previewOnly = args.includes('--preview');
  const assumeYes = args.includes('--yes');
  const profile = env.AWS_PROFILE ?? 'openmic';
  const region = env.AWS_REGION ?? 'eu-west-1';
  const environment = env.OPENMIC_ENVIRONMENT ?? 'prod';
  const expectedAccount = env.OPENMIC_AWS_ACCOUNT ?? '163742164398';
  const stackName = `OpenMicMigrationStack-${environment}`;
  const localMigrations = readdirSync(new URL('../apps/api/migrations', import.meta.url))
    .filter((name) => name.endsWith('.cjs'));
  const aws = providedAws ?? (async (command) => {
    const { stdout } = await exec('aws', [...command, '--profile', profile, '--region', region, '--output', 'json'], {
      env: { ...env, AWS_PAGER: '' },
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim() ? JSON.parse(stdout) : null;
  });

  async function loadTarget() {
    const identity = await aws(['sts', 'get-caller-identity']);
    if (identity.Account !== expectedAccount) {
      throw new Error(`AWS profile "${profile}" resolves to account ${identity.Account}, expected ${expectedAccount}.`);
    }
    const stacks = await aws(['cloudformation', 'describe-stacks', '--stack-name', stackName]);
    const outputs = Object.fromEntries((stacks.Stacks[0].Outputs ?? []).map((output) => [output.OutputKey, output.OutputValue]));
    for (const key of ['MigrationTaskDefinitionArn', 'ClusterName', 'PublicSubnetIds', 'MigrationSecurityGroupId']) {
      if (!outputs[key]) throw new Error(`${stackName} has no ${key} output. Deploy it first.`);
    }
    const definition = await aws(['ecs', 'describe-task-definition', '--task-definition', outputs.MigrationTaskDefinitionArn]);
    const container = definition.taskDefinition.containerDefinitions.find((item) => item.name === containerName);
    const logOptions = container?.logConfiguration?.options;
    if (!logOptions?.['awslogs-group'] || !logOptions['awslogs-stream-prefix']) {
      throw new Error('Migration task has no usable CloudWatch log configuration.');
    }
    return {
      cluster: outputs.ClusterName,
      taskDefinition: outputs.MigrationTaskDefinitionArn,
      subnets: outputs.PublicSubnetIds.split(','),
      securityGroup: outputs.MigrationSecurityGroupId,
      logGroup: logOptions['awslogs-group'],
      logStreamPrefix: logOptions['awslogs-stream-prefix'],
    };
  }

  async function taskLogs(target, taskId) {
    const command = [
      'logs', 'get-log-events', '--log-group-name', target.logGroup,
      '--log-stream-name', `${target.logStreamPrefix}/${containerName}/${taskId}`, '--start-from-head',
    ];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) await wait(3000);
      let events;
      try {
        events = await aws(command);
      } catch (error) {
        if (!String(error).includes('ResourceNotFoundException')) throw error;
        print(`CloudWatch log stream is not available yet (${attempt + 1}/5).`);
        continue;
      }
      const lines = events.events.map((event) => event.message);
      let token = events.nextForwardToken;
      while (token) {
        const page = await aws([...command, '--next-token', token]);
        lines.push(...page.events.map((event) => event.message));
        if (!page.nextForwardToken || page.nextForwardToken === token) break;
        token = page.nextForwardToken;
      }
      if (lines.length) return lines.filter((line) => !line.startsWith("Can't determine timestamp"));
    }
    throw new Error(`No CloudWatch task evidence was available for ${taskId}; inspect it before retrying any write.`);
  }

  async function runTask(target, command, startedBy) {
    const started = await aws([
      'ecs', 'run-task', '--cluster', target.cluster, '--task-definition', target.taskDefinition,
      '--launch-type', 'FARGATE', '--count', '1', '--started-by', startedBy,
      '--network-configuration', JSON.stringify({
        awsvpcConfiguration: { subnets: target.subnets, securityGroups: [target.securityGroup], assignPublicIp: 'ENABLED' },
      }),
      '--overrides', JSON.stringify({ containerOverrides: [{ name: containerName, command: ['sh', '-c', command] }] }),
    ]);
    if (started.failures?.length || !started.tasks?.[0]?.taskArn) {
      throw new Error(`ECS could not start ${startedBy}: ${JSON.stringify(started.failures ?? started)}`);
    }
    const taskArn = started.tasks[0].taskArn;
    const taskId = taskArn.split('/').pop();
    print(`Started ${startedBy} task ${taskArn}; waiting for it to stop...`);
    await aws(['ecs', 'wait', 'tasks-stopped', '--cluster', target.cluster, '--tasks', taskArn]);
    const described = await aws(['ecs', 'describe-tasks', '--cluster', target.cluster, '--tasks', taskArn]);
    const task = described.tasks?.[0];
    const container = task?.containers?.find((item) => item.name === containerName);
    const lines = await taskLogs(target, taskId);
    print(lines.join('\n'));
    if (container?.exitCode !== 0) {
      const partial = lines.includes(migratedMarker)
        ? ' Migrations committed; city import may not have committed. Inspect database state before any separately approved recovery.'
        : '';
      throw new Error(`${startedBy} task failed (exit code ${container?.exitCode ?? 'none'}): ${task?.stoppedReason ?? 'no reason reported'}.${partial}`);
    }
    return lines;
  }

  async function dryRun(target, startedBy) {
    const lines = await runTask(target, `ls -1 apps/api/migrations && echo ${listMarker} && ${migrateCommand} --dry-run`, startedBy);
    const markerIndex = lines.indexOf(listMarker);
    if (markerIndex === -1) throw new Error('Could not read the migration list from the task logs.');
    const imageMigrations = new Set(lines.slice(0, markerIndex).map((line) => line.trim()));
    const missing = localMigrations.filter((name) => !imageMigrations.has(name));
    if (missing.length) throw new Error(`The deployed migration image is missing ${missing.join(', ')}. Redeploy ${stackName} exclusively first.`);
    const output = lines.slice(markerIndex + 1);
    if (!output.length) throw new Error('Migration preview produced no SQL or current-schema evidence.');
    const fingerprint = createHash('sha256').update(JSON.stringify(output)).digest('hex');
    print(`Migration preview SHA256: ${fingerprint}`);
    return { upToDate: output.some((line) => line.includes('No migrations to run')), fingerprint };
  }

  async function previewCities(target) {
    const lines = await runTask(target, `${cityImportCommand} --dry-run`, 'city-import-dry-run');
    if (!lines.some((line) => /^Validated \d+ JSON cities;/.test(line))) {
      throw new Error('City preview did not produce validated catalogue evidence.');
    }
  }

  async function recoveryPoint() {
    const instances = await aws(['rds', 'describe-db-instances']);
    const matches = instances.DBInstances.filter((item) => item.DBInstanceIdentifier.startsWith(`openmicdatabasestack-${environment}-`));
    const instance = matches[0];
    const timestamp = Date.parse(instance?.LatestRestorableTime);
    if (matches.length !== 1 || instance.DBInstanceStatus !== 'available' ||
        !(instance.BackupRetentionPeriod > 0) || !Number.isFinite(timestamp) || timestamp > Date.now()) {
      throw new Error('Cannot verify a unique available production database with enabled backups and a valid recovery point. No apply task will be started.');
    }
    print(`Recovery point: ${instance.DBInstanceIdentifier} restorable to ${instance.LatestRestorableTime} (${instance.BackupRetentionPeriod}-day retention).`);
  }

  async function confirm() {
    if (assumeYes) return true;
    if (providedConfirm) return providedConfirm();
    if (!process.stdin.isTTY) throw new Error('Refusing to apply without a terminal. Use --preview to inspect, then --yes only after explicit approval.');
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return (await prompt.question('\nType "yes" to apply the displayed production database changes: ')).trim() === 'yes';
    } finally {
      prompt.close();
    }
  }

  print(`Target: ${environment} (account ${expectedAccount}, ${region}, profile ${profile})`);
  const target = await loadTarget();
  print('\nChecking pending migrations (dry run)...');
  const preview = await dryRun(target, 'migration-dry-run');
  if (expectedPreview !== undefined && preview.fingerprint !== expectedPreview) {
    throw new Error('Migration preview changed since approval. No apply task will be started; obtain renewed approval.');
  }
  if (preview.upToDate) {
    print('\nDatabase is already up to date; previewing the city catalogue import...');
    await previewCities(target);
  }
  await recoveryPoint();
  print('The city importer preserves existing UUIDs and unmanaged rows, rejects removed managed identities, and links only unambiguous legacy references.');
  print('Migrations and city import commit separately. Import failure does not undo migrations; do not use migration down as data recovery.');
  if (previewOnly) {
    print('\nPreview only; no migrations or city import applied.');
    return;
  }
  if (!(await confirm())) throw new Error('Aborted; no migrations or city import applied.');
  await recoveryPoint();
  const command = preview.upToDate
    ? `${cityImportCommand} && echo ${importedMarker}`
    : `${migrateCommand} && echo ${migratedMarker} && ${cityImportCommand} --dry-run && ${cityImportCommand} && echo ${importedMarker}`;
  const lines = await runTask(target, command, preview.upToDate ? 'city-import' : 'migration-and-city-import');
  if (!lines.includes(importedMarker) ||
      !lines.some((line) => /^Synchronized \d+ JSON cities:/.test(line)) ||
      (!preview.upToDate && !lines.includes(migratedMarker))) {
    throw new Error('Apply task lacks completion evidence. Database writes may have committed; inspect state before any retry.');
  }
  const check = await dryRun(target, 'migration-postcheck');
  if (!check.upToDate) throw new Error('Migrations still pending after apply.');
  await previewCities(target);
  print('\nProduction migrations and city catalogue import completed; review identity coverage before application rollout.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runProductionMigration();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
