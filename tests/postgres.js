import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {generate,identifier as q} from '../src/generator.js';
import {catalog} from '../src/catalog.js';
const host=process.env.PGHOST||'/tmp',port=process.env.PGPORT||'5544',user=process.env.PGUSER||'postgres';
if(!['/tmp','localhost','127.0.0.1'].includes(host))throw Error('Integration tests only run against a local, disposable PostgreSQL server.');
const tag=`pgg_${process.pid}`,db=`${tag}_db`,creator=`${tag}_owner`,member=`${tag}_app`,group=`${tag}_writer`,reader=`${tag}_reader`,readUser=`${tag}_readuser`,receiver=`${tag}_target`;
const roles=[creator,member,group,reader,readUser,receiver],ctx={platform:'postgres',version:17};
let count=0,created=false;
function run(sql,database=db,ok=true){const r=spawnSync('psql',['-X','-h',host,'-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:sql,encoding:'utf8'});if(ok&&r.status!==0)throw Error(r.stderr+'\n'+sql);if(!ok){assert.notEqual(r.status,0,'Expected permission failure');count++;}return r.stdout.trim();}
function check(value,expected='t'){assert.equal(value,expected);count++;}
const grant=op=>generate(ctx,[op]).sql;
try{
 console.log(run('SELECT version();','postgres'));
 const major=Number(run("SELECT current_setting('server_version_num')::int / 10000;",'postgres'));assert.equal(major,17,'This integration suite verifies PostgreSQL 17 syntax.');
 run(`CREATE DATABASE ${q(db)};`,'postgres');created=true;
 run(`CREATE ROLE ${q(creator)} NOLOGIN;CREATE ROLE ${q(member)} LOGIN;CREATE ROLE ${q(readUser)} LOGIN;CREATE ROLE ${q(receiver)} NOLOGIN;CREATE SCHEMA s AUTHORIZATION ${q(creator)}; SET ROLE ${q(creator)};CREATE TABLE s.existing (id serial PRIMARY KEY, value text); CREATE FUNCTION s.fn(integer) RETURNS integer LANGUAGE SQL AS 'SELECT $1';CREATE PROCEDURE s.proc(integer) LANGUAGE plpgsql AS 'BEGIN NULL; END;';CREATE TYPE s.mood AS ENUM ('ok'); CREATE DOMAIN s.positive AS integer CHECK(VALUE>0); RESET ROLE;`);
 const setup={kind:'profile',profile:'writer',group,database:db,schemas:'s',creators:creator,members:member};
 const setupSQL=grant(setup);run(setupSQL);run(setupSQL);check(run(`SELECT has_table_privilege('${member}','s.existing','SELECT,INSERT,UPDATE,DELETE');`));
 run(`SET ROLE ${q(member)};INSERT INTO s.existing(value) VALUES ('one'); UPDATE s.existing SET value='two';SELECT * FROM s.existing;DELETE FROM s.existing;RESET ROLE;`);count++;
 check(run(`SELECT has_sequence_privilege('${member}','s.existing_id_seq','USAGE');`));check(run(`SELECT has_sequence_privilege('${member}','s.existing_id_seq','UPDATE');`),'f');
 run(`SET ROLE ${q(member)};TRUNCATE s.existing;`,db,false);run(`SET ROLE ${q(member)};CREATE TABLE s.denied(x int);`,db,false);run(`SET ROLE ${q(member)};SELECT setval('s.existing_id_seq',100);`,db,false);
 run(`SET ROLE ${q(creator)};CREATE TABLE s.future(id serial,value text);RESET ROLE;`);check(run(`SELECT has_table_privilege('${member}','s.future','INSERT');`));check(run(`SELECT has_sequence_privilege('${member}','s.future_id_seq','USAGE');`));
 run(grant({...setup,profile:'reader',group:reader,members:readUser}));run(`SET ROLE ${q(readUser)};SELECT * FROM s.future;`,db);count++;run(`SET ROLE ${q(readUser)};INSERT INTO s.future(value) VALUES('no');`,db,false);
 check(run(`SELECT inherit_option AND NOT admin_option AND NOT set_option FROM pg_auth_members WHERE roleid='${group}'::regrole AND member='${member}'::regrole;`));
 run(grant({kind:'default',object:'routine',action:'revoke',privileges:['EXECUTE'],creators:creator,schemas:'',public:true}));
 run(grant({kind:'default',object:'routine',privileges:['EXECUTE'],creators:creator,schemas:'s',grantees:group}));
 run(`SET ROLE ${q(creator)};CREATE FUNCTION s.future_fn() RETURNS integer LANGUAGE SQL AS 'SELECT 1';CREATE PROCEDURE s.future_proc() LANGUAGE plpgsql AS 'BEGIN NULL; END;';RESET ROLE;`);
 check(run(`SELECT has_function_privilege('${member}','s.future_fn()','EXECUTE');`));check(run(`SELECT has_function_privilege('${member}','s.future_proc()','EXECUTE');`));check(run(`SELECT has_function_privilege('${readUser}','s.future_fn()','EXECUTE');`),'f');
 // Syntax and server acceptance across every current-object grant category.
 run(`CREATE FOREIGN DATA WRAPPER example_fdw;CREATE SERVER example_server FOREIGN DATA WRAPPER example_fdw;SELECT lo_create(12345);`);
 const targets={database:db,schema:'s',table:'s.existing',column:'s.existing',sequence:'s.existing_id_seq',function:'s.fn',procedure:'s.proc',routine:'s.fn',type:'s.mood',domain:'s.positive',language:'plpgsql',fdw:'example_fdw',server:'example_server',tablespace:'pg_default',largeobject:'12345',parameter:'work_mem'};
 for(const [object,entry]of Object.entries(catalog(17))){
  const operation={kind:'object',object,targets:targets[object],grantees:receiver,privileges:entry.privileges,columns:'value',argTypes:'integer',grantOption:true};
  run(grant(operation));count++;
  run(grant({...operation,grantOption:false,action:'revoke',optionOnly:true}));count++;
  run(grant({...operation,grantOption:false,action:'revoke',optionOnly:false}));count++;
 }
 for(const [object,e]of Object.entries(catalog(17)))if(e.defaults){
  const operation={kind:'default',object,schemas:object==='schema'?'':'s',creators:creator,grantees:receiver,privileges:e.privileges,grantOption:true};
  run(grant(operation));count++;run(grant({...operation,grantOption:false,action:'revoke',optionOnly:true}));count++;run(grant({...operation,grantOption:false,action:'revoke'}));count++;
 }
 for(const option of ['ADMIN','INHERIT','SET']){run(grant({kind:'membership',roles:group,members:receiver,admin:true,inherit:true,set:true}));run(grant({kind:'membership',roles:group,members:receiver,action:'revoke',revokeOption:option}));count++;}
 run(grant({kind:'membership',roles:group,members:receiver,action:'revoke'}));count++;
 // No authority to grant a new role: transaction must roll back its created group.
 const rollbackRole=`${tag}_rollback`;roles.push(rollbackRole);
 run(`SET ROLE ${q(member)};${grant({...setup,group:rollbackRole})}`,db,false);check(run(`SELECT EXISTS(SELECT FROM pg_roles WHERE rolname='${rollbackRole}');`),'f');
 // An existing LOGIN group must be rejected instead of silently repurposed.
 run(grant({...setup,group:member,members:receiver}),db,false);
 // Unusual quoted names, SQL-like text, and the DO delimiter remain inert identifiers.
 const odd=`${tag}_x$grantor$'\\";--`;roles.push(odd);run(grant({kind:'group',group:odd}));count++;
 check(run(`SELECT COUNT(*) FROM pg_roles WHERE rolname LIKE '${tag}_%'`),String(roles.length-1));
 console.log(`PASS: ${count} PostgreSQL integration checks (including ${Object.keys(catalog(17)).length} object categories).`);
}finally{
 if(created){run(`DROP DATABASE ${q(db)} WITH (FORCE);`,'postgres');for(const role of roles)run(`DROP ROLE IF EXISTS ${q(role)};`,'postgres');}
}
