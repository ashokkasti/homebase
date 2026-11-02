import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  backupOverviewSchema,
  backupEventsSchema,
  type BackupMutation,
} from "../backup-schemas";
import { sshExec } from "./ssh";

export function shellQuote(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
const dispatch = `import json,os,pathlib,sys
agent=pathlib.Path('/opt/homeserver-backup/control.py')
if agent.is_file():
 os.execv('/usr/bin/python3',['/usr/bin/python3',str(agent)])
p=pathlib.Path('/etc/homeserver-backup/config.json')
c=json.loads(p.read_text()) if p.is_file() else {}
print(json.dumps({'kind':'not_installed','legacy':bool(c),'mount':c.get('mount','/srv/backups'),'project':c.get('project','')}))`;

export async function backupRequest(
  serverId: string,
  input: { action: string; settings?: unknown },
) {
  const text = await sshExec(
    serverId,
    (_docker, privileged) => `${privileged}python3 -c ${shellQuote(dispatch)}`,
    { input: JSON.stringify(input), timeoutMs: 30000 },
  );
  const output: unknown = JSON.parse(text);
  return output;
}
export async function serverBackupOverview(serverId: string) {
  return backupOverviewSchema.parse(
    await backupRequest(serverId, { action: "overview" }),
  );
}
export async function serverBackupEvents(serverId: string) {
  return backupEventsSchema.parse(
    await backupRequest(serverId, { action: "logs" }),
  );
}

const bundleFiles = [
  "backup_service.py",
  "setup.py",
  "verify_restore.py",
  "control.py",
  "destination.py",
  "systemd/homeserver-backup.service",
  "systemd/homeserver-backup-destination.service",
  "systemd/homeserver-backup.timer",
  "systemd/homeserver-backup-health.service",
  "systemd/homeserver-backup-health.timer",
  "systemd/homeserver-backup-maintenance.service",
  "systemd/homeserver-backup-maintenance.timer",
  "systemd/homeserver-backup-recover.service",
  "systemd/homeserver-backup-verify.service",
  "systemd/homeserver-backup-verify.timer",
];
export async function agentBundle() {
  return Promise.all(
    bundleFiles.map(async (name) => {
      const bytes = await readFile(join(process.cwd(), "backup-agent", name));
      return {
        name,
        content: bytes.toString("base64"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  );
}
const installer = `import base64,hashlib,json,os,pathlib,shutil,subprocess,sys,tempfile
payload=json.load(sys.stdin)
release=pathlib.Path(tempfile.mkdtemp(prefix='homebase-backup-',dir='/opt'))
try:
 for item in payload['files']:
  p=pathlib.PurePosixPath(item['name'])
  if p.is_absolute() or '..' in p.parts: raise ValueError('Invalid bundle path')
  b=base64.b64decode(item['content'],validate=True)
  if hashlib.sha256(b).hexdigest()!=item['sha256']: raise ValueError('Bundle checksum mismatch')
  dest=release/p
  dest.parent.mkdir(parents=True,exist_ok=True)
  dest.write_bytes(b)
  dest.chmod(0o600)
 def execute(args):
  result=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=150,env={**os.environ,'DEBIAN_FRONTEND':'noninteractive'})
  if result.returncode: raise RuntimeError(result.stdout[-2000:])
 if not shutil.which('restic'):
  execute(['apt-get','update'])
  execute(['apt-get','install','-y','restic'])
 args=['/usr/bin/python3',str(release/'setup.py'),'install','--mount',payload['mount']]
 if payload.get('project'): args+=['--project',payload['project']]
 execute(args)
 print(json.dumps({'ok':True,'message':'Backup service connected. Existing snapshots and scheduling were preserved.'}))
except Exception as e:
 print(str(e),file=sys.stderr)
 sys.exit(1)
finally:
 shutil.rmtree(release)
`;
const ok = z.object({ ok: z.literal(true), message: z.string() });
export async function serverBackupAction(
  serverId: string,
  input: BackupMutation,
) {
  if (input.action === "install") {
    const output = await sshExec(
      serverId,
      (_docker, privileged) =>
        `${privileged}python3 -c ${shellQuote(installer)}`,
      {
        input: JSON.stringify({ ...input, files: await agentBundle() }),
        timeoutMs: 180000,
      },
    );
    return ok.parse(JSON.parse(output));
  }
  return ok.parse(await backupRequest(serverId, input));
}
