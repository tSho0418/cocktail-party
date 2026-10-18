// Local Postgres helper.
// - up: reuse a compatible Postgres already listening (e.g. another worktree's compose) instead of
//   failing on the port clash; otherwise start ours. Then make sure the app database exists.
// - reset: recreate the app database (DATABASE_URL) empty; `pnpm db:reset` then migrates it.
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const url = new URL(
	process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cocktail_party'
);
const name = decodeURIComponent(url.pathname.slice(1));
const server = new URL(url);
server.pathname = '/postgres';
const quoted = `"${name.replaceAll('"', '""')}"`;

async function query(sql) {
	const client = new pg.Client({ connectionString: server.href });
	await client.connect();
	try {
		return (await client.query(sql)).rows;
	} finally {
		await client.end();
	}
}

async function serverVersion() {
	try {
		return Number((await query('SHOW server_version_num'))[0].server_version_num);
	} catch {
		return null; // nothing (ready) on the port
	}
}

async function up() {
	const version = await serverVersion();
	if (version === null) {
		const { status } = spawnSync('docker', ['compose', 'up', '-d', '--wait'], { stdio: 'inherit' });
		if (status !== 0) process.exit(status ?? 1);
	} else if (version < 170000) {
		throw new Error(
			`Postgres on ${url.host} is ${version}; need 17+. Stop it or change DATABASE_URL.`
		);
	} else {
		console.log(`Using the Postgres already listening on ${url.host}.`);
	}
	const exists = await query(
		`SELECT 1 FROM pg_database WHERE datname = '${name.replaceAll("'", "''")}'`
	);
	if (exists.length === 0) await query(`CREATE DATABASE ${quoted}`);
}

const command = process.argv[2];
if (command === 'up') {
	await up();
} else if (command === 'reset') {
	await up();
	await query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
	await query(`CREATE DATABASE ${quoted}`);
} else {
	throw new Error('usage: node scripts/db.mjs up|reset');
}
