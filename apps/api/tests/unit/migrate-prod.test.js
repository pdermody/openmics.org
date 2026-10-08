import { readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { runProductionMigration } from '../../../../scripts/migrate-prod.mjs';

const migrations = readdirSync(new URL('../../migrations', import.meta.url)).filter((name) => name.endsWith('.cjs'));
const env = { AWS_PROFILE: 'test', AWS_REGION: 'eu-west-1', OPENMIC_ENVIRONMENT: 'prod' };

function fixture({
  pending = true,
  backup = {},
  logError,
  emptyLogs = false,
  failedImport = false,
  incompleteApply = false,
} = {}) {
  const commands = [];
  const logs = new Map();
  const print = vi.fn();
  const confirm = vi.fn(async () => true);
  const wait = vi.fn(async () => {});
  const aws = vi.fn(async (args) => {
    const operation = args.slice(0, 2).join(' ');
    switch (operation) {
      case 'sts get-caller-identity':
        return { Account: '163742164398' };
      case 'cloudformation describe-stacks':
        return { Stacks: [{ Outputs: Object.entries({
          MigrationTaskDefinitionArn: 'definition:4',
          ClusterName: 'openmic-prod',
          PublicSubnetIds: 'subnet-one,subnet-two',
          MigrationSecurityGroupId: 'sg-migration',
        }).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })) }] };
      case 'ecs describe-task-definition':
        return { taskDefinition: { containerDefinitions: [{
          name: 'MigrationContainer',
          logConfiguration: { options: { 'awslogs-group': 'migration', 'awslogs-stream-prefix': 'ecs' } },
        }] } };
      case 'ecs run-task': {
        const overrides = JSON.parse(args[args.indexOf('--overrides') + 1]);
        const command = overrides.containerOverrides[0].command[2];
        commands.push(command);
        const id = String(commands.length);
        let lines;
        if (command.startsWith('ls ')) {
          lines = [...migrations, '__END_MIGRATION_LIST__', pending ? 'CREATE TABLE cities (...);' : 'No migrations to run!'];
        } else if (command.endsWith('--dry-run')) {
          lines = ['Validated 50250 JSON cities; 0 to insert, 50250 to update, 0 managed source identities would be removed.'];
        } else {
          lines = [];
          if (command.includes('__MIGRATIONS_COMMITTED__')) lines.push('__MIGRATIONS_COMMITTED__');
          if (!failedImport && !incompleteApply) {
            lines.push('Synchronized 50250 JSON cities: 50250 inserted, 0 updated; linked 0 unambiguous legacy references.', '__CITY_IMPORT_COMMITTED__');
            pending = false;
          }
        }
        logs.set(id, lines);
        return { tasks: [{ taskArn: `arn:task/${id}` }], failures: [] };
      }
      case 'ecs wait':
        return null;
      case 'ecs describe-tasks': {
        const id = args[args.indexOf('--tasks') + 1].split('/').pop();
        const apply = commands[Number(id) - 1].includes('__CITY_IMPORT_COMMITTED__');
        return { tasks: [{ containers: [{ name: 'MigrationContainer', exitCode: failedImport && apply ? 1 : 0 }] }] };
      }
      case 'logs get-log-events': {
        if (logError) throw new Error(logError);
        const id = args[args.indexOf('--log-stream-name') + 1].split('/').pop();
        return { events: emptyLogs ? [] : logs.get(id).map((message) => ({ message })) };
      }
      case 'rds describe-db-instances':
        return { DBInstances: [{
          DBInstanceIdentifier: 'openmicdatabasestack-prod-database-test',
          DBInstanceStatus: 'available',
          BackupRetentionPeriod: 3,
          LatestRestorableTime: new Date(Date.now() - 300000).toISOString(),
          ...backup,
        }] };
      default:
        throw new Error(`Unexpected AWS operation: ${operation}`);
    }
  });
  const run = (args = ['--preview']) => runProductionMigration({ args, env, aws, print, wait, confirm });
  return { run, commands, aws, print, confirm, wait };
}

describe('production migration safety', () => {
  it('previews pending SQL without starting an apply task or prompting', async () => {
    const f = fixture();
    await f.run();
    expect(f.commands).toHaveLength(1);
    expect(f.commands[0]).toContain('up -m apps/api/migrations --dry-run');
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.print).toHaveBeenCalledWith('\nPreview only; no migrations or city import applied.');
  });

  it('previews cities only when their schema already exists', async () => {
    const f = fixture({ pending: false });
    await f.run();
    expect(f.commands).toHaveLength(2);
    expect(f.commands[1]).toMatch(/import-cli\.js --dry-run$/);
    expect(f.confirm).not.toHaveBeenCalled();
  });

  it('rejects SQL that differs from the approved preview without applying', async () => {
    const f = fixture();
    await expect(f.run(['--yes', `--expected-preview=${'0'.repeat(64)}`])).rejects.toThrow('Migration preview changed since approval');
    expect(f.commands).toHaveLength(1);
  });

  it.each([['--preview', '--yes'], ['--unknown']])('rejects invalid arguments %j before any AWS call', async (...args) => {
    const f = fixture();
    await expect(f.run(args)).rejects.toThrow('Use either');
    expect(f.aws).not.toHaveBeenCalled();
  });

  it.each([
    { BackupRetentionPeriod: 0 },
    { LatestRestorableTime: undefined },
    { LatestRestorableTime: 'invalid' },
    { LatestRestorableTime: '2999-01-01T00:00:00Z' },
    { DBInstanceStatus: 'backing-up' },
  ])('refuses apply without verified recovery evidence %j', async (backup) => {
    const f = fixture({ backup });
    await expect(f.run(['--yes'])).rejects.toThrow('Cannot verify');
    expect(f.commands).toHaveLength(1);
  });

  it('propagates CloudWatch authorization errors without retrying them', async () => {
    const f = fixture({ logError: 'AccessDeniedException' });
    await expect(f.run(['--yes'])).rejects.toThrow('AccessDeniedException');
    expect(f.wait).not.toHaveBeenCalled();
    expect(f.commands).toHaveLength(1);
  });

  it('fails closed when successful task exit has no logs', async () => {
    const f = fixture({ emptyLogs: true });
    await expect(f.run(['--yes'])).rejects.toThrow('No CloudWatch task evidence');
    expect(f.commands).toHaveLength(1);
  });

  it('retries only temporary missing log streams and reports the delay', async () => {
    const f = fixture({ logError: 'ResourceNotFoundException' });
    await expect(f.run()).rejects.toThrow('No CloudWatch task evidence');
    expect(f.wait).toHaveBeenCalledTimes(4);
    expect(f.print).toHaveBeenCalledWith('CloudWatch log stream is not available yet (1/5).');
  });

  it('migrates and imports sequentially in one apply task with postchecks', async () => {
    const f = fixture();
    await f.run([]);
    expect(f.confirm).toHaveBeenCalledTimes(1);
    expect(f.commands).toHaveLength(4);
    expect(f.commands[1]).toContain('up -m apps/api/migrations && echo __MIGRATIONS_COMMITTED__ && node dist/apps/api/src/cities/import-cli.js --dry-run && node dist/apps/api/src/cities/import-cli.js');
    expect(f.commands[2]).toContain('--dry-run');
    expect(f.commands[3]).toMatch(/import-cli\.js --dry-run$/);
    expect(f.aws.mock.calls.filter(([args]) => args[0] === 'rds')).toHaveLength(2);
  });

  it('imports without migration apply when schema is current', async () => {
    const f = fixture({ pending: false });
    await f.run(['--yes']);
    expect(f.commands[2]).toBe('node dist/apps/api/src/cities/import-cli.js && echo __CITY_IMPORT_COMMITTED__');
  });

  it('reports partial completion and does not retry a failed import', async () => {
    const f = fixture({ failedImport: true });
    await expect(f.run(['--yes'])).rejects.toThrow('Migrations committed; city import may not have committed');
    expect(f.commands).toHaveLength(2);
  });

  it('rejects missing apply completion evidence even with zero exit code', async () => {
    const f = fixture({ incompleteApply: true });
    await expect(f.run(['--yes'])).rejects.toThrow('Database writes may have committed');
    expect(f.commands).toHaveLength(2);
  });

  it('does not apply after an operator declines', async () => {
    const f = fixture();
    f.confirm.mockResolvedValue(false);
    await expect(f.run([])).rejects.toThrow('Aborted');
    expect(f.commands).toHaveLength(1);
  });
});
