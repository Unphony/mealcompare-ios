import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt, createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import type { Job } from './domain.js';
const digest = (s:string) => createHash('sha256').update(s).digest('hex');
export class Store {
  private db:DatabaseSync;
  constructor(path:string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY, body TEXT NOT NULL);`);
    for (const job of this.jobs()) if (job.state === 'running') {
      this.saveJob({...job,state:'interrupted',message:'电脑重启中断了查询，请核对当前页面后重新发起。',updatedAt:new Date().toISOString()});
    }
  }
  saveJob(job:Job) { this.db.prepare('INSERT OR REPLACE INTO jobs VALUES (?,?)').run(job.id,JSON.stringify(job)); }
  jobs():Job[] { return this.db.prepare('SELECT body FROM jobs ORDER BY rowid DESC LIMIT 100').all().map(r=>JSON.parse(String(r.body))); }
  job(id:string):Job|undefined { const r=this.db.prepare('SELECT body FROM jobs WHERE id=?').get(id); return r ? JSON.parse(String(r.body)) : undefined; }
  saveRecord(id:string,body:unknown) { this.db.prepare('INSERT OR REPLACE INTO records VALUES (?,?)').run(id,JSON.stringify(body)); }
  records():unknown[] { return this.db.prepare('SELECT body FROM records ORDER BY rowid DESC LIMIT 100').all().map(r=>JSON.parse(String(r.body))); }
  saveHistory(platform:string,entries:unknown[]) {
    for (const entry of entries) {
      const body={platform,entry};
      this.db.prepare('INSERT OR REPLACE INTO history VALUES (?,?)').run(digest(JSON.stringify(body)),JSON.stringify(body));
    }
  }
  history():unknown[] { return this.db.prepare('SELECT body FROM history ORDER BY rowid DESC LIMIT 100').all().map(r=>JSON.parse(String(r.body))); }
  addDevice() { const token=randomBytes(32).toString('base64url'), id=randomUUID(); this.db.prepare('INSERT INTO devices VALUES (?,?)').run(id,digest(token)); return {id,token}; }
  authenticate(token:string):string|undefined { if (token.length !== 43) return; return this.db.prepare('SELECT id FROM devices WHERE hash=?').get(digest(token))?.id as string|undefined; }
  revokeDevices() { this.db.exec('DELETE FROM devices'); }
  close() { this.db.close(); }
}
export class Pairing {
  private code=''; private expires=0; private attempts=0;
  constructor(private store:Store) {}
  renew(now=Date.now()) { this.code=randomInt(10000000,100000000).toString(); this.expires=now+600000; this.attempts=0; return {code:this.code, expiresAt:new Date(this.expires).toISOString()}; }
  current() { return {code:this.code,expiresAt:new Date(this.expires).toISOString()}; }
  pair(code:unknown, now=Date.now()) {
    if (!this.code || now>this.expires || this.attempts>=5) throw Error('配对码已失效，请在电脑刷新');
    this.attempts++;
    if (typeof code !== 'string' || code.length!==8 || !timingSafeEqual(Buffer.from(code),Buffer.from(this.code))) throw Error('配对码错误');
    this.expires=0;
    return this.store.addDevice();
  }
}
