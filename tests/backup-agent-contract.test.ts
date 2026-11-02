import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { backupOverviewSchema } from "../lib/backup-schemas";

test("the Python agent overview satisfies the browser contract without secret fields", () => {
  const source = `import json,tempfile,shutil
from pathlib import Path
from unittest.mock import patch
import backup_service as b
import control as c
with tempfile.TemporaryDirectory() as folder:
 root=Path(folder)
 config={'name':'test','project':'p','mount':str(root/'disk'),'disk_uuid':'backup-disk','state_dir':str(root/'state'),'password_file':str(root/'password')}
 service=b.Service(config)
 service.status(last_success=b.now().isoformat(),last_attempt=b.now().isoformat(),duration_seconds=28,retention='ok',snapshot_id='a'*64)
 b.atomic_json(service.state/'restore-verified.json',{'time':b.now().isoformat(),'snapshot_id':'a'*64})
 b.atomic_json(service.state/'restore-report.json',{'file_checksum_restore':True,'postgres_clone_sql':{'databases':5,'auth_users':3,'storage_objects':34,'storage_buckets':3}})
 raw=[{'id':'a'*64,'time':b.now().isoformat(),'tags':['test','complete'],'summary':{'total_bytes_processed':12345,'data_added':123,'total_files_processed':30,'total_duration':28}}]
 def run(args):
  if args[:2]==['systemctl','show']: return 'ActiveState=inactive\\nResult=success\\nExecMainStatus=0\\nUnitFileState=enabled\\n'
  if args[:2]==['systemctl','cat']: return '[Timer]\\nOnCalendar=*-*-* 02:00:00 Asia/Kathmandu\\n'
  raise RuntimeError('unexpected command')
 with patch.object(service,'disk',return_value=shutil.disk_usage(root)),patch.object(service,'restic',return_value=json.dumps(raw)),patch.object(c,'run',side_effect=run):
  print(json.dumps(c.overview(service)))`;
  const output = execFileSync("python3", ["-c", source], {
    cwd: join(process.cwd(), "backup-agent"),
    encoding: "utf8",
  });
  const data: unknown = JSON.parse(output);
  const result = backupOverviewSchema.parse(data);
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.equal(result.health, "healthy");
  assert.equal(result.snapshots[0]?.state, "complete");
  assert.equal(result.snapshots[0]?.bytes, 12345);
  assert.equal(result.restore.storageApiVerified, false);
  assert.ok(!output.includes("password_file"));
  assert.ok(!output.includes("runtime_config"));
});
