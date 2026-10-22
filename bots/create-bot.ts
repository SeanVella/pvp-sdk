#!/usr/bin/env bun
import { cp, readFile, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

function generateRandomString(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function replaceInFile(filePath: string, replacements: Record<string, string>) {
    let content = await readFile(filePath, 'utf-8');
    for (const [key, value] of Object.entries(replacements)) {
        content = content.replaceAll(key, value);
    }
    await writeFile(filePath, content);
}

// pvp-sdk: fair play (docs/FAIR_PLAY.md). A server can give each player a few bots a season;
// then the server makes the account, in one of your slots, and needs your API key from its
// /account page (PVP_SDK_KEY in the project's .env, or --key=). Elsewhere, as before, the
// account registers itself on its first login with the password made here.
type FairPlay = { enabled: boolean; season: number; botsPerPlayer: number; signup: string };

function serverBase(server: string): string {
    return server === 'localhost' ? 'http://localhost:8888' : `https://${server}`;
}

async function fairPlay(base: string): Promise<FairPlay | null> {
    try {
        const res = await fetch(`${base}/api/accounts`, { signal: AbortSignal.timeout(5000) });
        return res.ok ? ((await res.json()) as FairPlay) : null;
    } catch {
        return null; // older server, or not running yet
    }
}

async function botApi(base: string, path: string, key: string, body: object): Promise<{ username?: string; password?: string; error?: string }> {
    const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { username?: string; password?: string; error?: string };
}

function needKey(base: string, rules: FairPlay): never {
    console.error(`This server gives each player ${rules.botsPerPlayer} bots a season (docs/FAIR_PLAY.md).`);
    console.error(`1. Sign in at ${base}${rules.signup} (with the invite code the server owner gave you) and create an API key there.`);
    console.error(`2. Put PVP_SDK_KEY=<key> in the project's .env (or pass --key=<key>), then run this again.`);
    process.exit(1);
}

/** Puts an existing bots/<name>/ (made before fair play) into one of your slots. */
async function claimBot(username: string, serverOverride: string | undefined, key: string | undefined) {
    const envPath = join(process.cwd(), 'bots', username, 'bot.env');
    if (!existsSync(envPath)) {
        console.error(`Error: no bots/${username}/bot.env to claim`);
        process.exit(1);
    }
    const env = await readFile(envPath, 'utf-8');
    const value = (name: string) => env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
    const base = serverBase(serverOverride ?? (value('SERVER') || 'pvp-sdk.fly.dev'));
    const rules = await fairPlay(base);
    if (!rules?.enabled) {
        console.log(`${base} doesn't use bot slots; nothing to claim.`);
        return;
    }
    if (!key) needKey(base, rules);
    const result = await botApi(base, '/api/bots/claim', key, { username: value('BOT_USERNAME') || username, password: value('PASSWORD') });
    if (result.error) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
    }
    console.log(`✓ "${result.username}" is now one of your ${rules.botsPerPlayer} bots for season ${rules.season}.`);
}

async function createBot(username?: string, serverOverride?: string, hideChat?: boolean, key?: string) {
    // Generate username if not provided
    let botUsername = username || generateRandomString(9);

    // Validate username
    if (botUsername.length > 12) {
        console.error('Error: Username must be 12 characters or less');
        process.exit(1);
    }

    if (!/^[a-zA-Z0-9]+$/.test(botUsername)) {
        console.error('Error: Username must be alphanumeric');
        process.exit(1);
    }

    const templateDir = join(process.cwd(), 'bots', '_template');

    // Check if template exists
    if (!existsSync(templateDir)) {
        console.error(`Error: Template directory not found at ${templateDir}`);
        process.exit(1);
    }

    // Check if bot already exists
    if (existsSync(join(process.cwd(), 'bots', botUsername))) {
        console.error(`Error: Bot directory already exists at ${join(process.cwd(), 'bots', botUsername)}`);
        process.exit(1);
    }

    // Generate random password, or have the server make the account in one of your slots
    let password = generateRandomString(12);
    const base = serverBase(serverOverride ?? 'pvp-sdk.fly.dev');
    const rules = await fairPlay(base);
    if (rules?.enabled) {
        if (!key) needKey(base, rules);
        const made = await botApi(base, '/api/bots', key, { username: botUsername });
        if (made.error || !made.username || !made.password) {
            console.error(`Error: ${made.error ?? 'the server did not return the new account'}`);
            process.exit(1);
        }
        botUsername = made.username;
        password = made.password;
        console.log(`Account "${botUsername}" made in one of your ${rules.botsPerPlayer} slots for season ${rules.season}.`);
    }
    const botDir = join(process.cwd(), 'bots', botUsername);

    // Copy template directory
    await cp(templateDir, botDir, { recursive: true });
    console.log(`Created bot directory: ${botDir}`);

    // Replace placeholders in all files
    const replacements = {
        '{{USERNAME}}': botUsername,
        '{{PASSWORD}}': password,
    };

    const files = await readdir(botDir);
    for (const file of files) {
        const filePath = join(botDir, file);
        await replaceInFile(filePath, replacements);
        console.log(`Created ${file}`);
    }

    const envPath = join(botDir, 'bot.env');

    // Override server if --local or --server= was passed
    if (serverOverride) {
        await replaceInFile(envPath, { 'pvp-sdk.fly.dev': serverOverride });
        console.log(`Server set to: ${serverOverride}`);
    }
    if (serverOverride === 'localhost') {
        // The lite runner builds its cache origin from SERVER, so a bare
        // 'localhost' dials port 80; and SERVER with a port would then be
        // mistaken for the gateway. Name both explicitly.
        // pvp-sdk: match either line ending. A Windows checkout gives the
        // template CRLF, and a '\n'-only match silently left SERVER=localhost.
        const env = await readFile(envPath, 'utf-8');
        await writeFile(envPath, env.replace(/^SERVER=localhost(\r?\n)/m, 'SERVER=localhost:8888$1GATEWAY_URL=ws://localhost:7780$1'));
        console.log(`Local stack: engine at localhost:8888, gateway at ws://localhost:7780`);
    }

    // Public chat is shown by default; disable it with --no-chat / --hide-chat
    if (hideChat) {
        await replaceInFile(envPath, { 'SHOW_CHAT=true': 'SHOW_CHAT=false' });
        console.log(`Public chat: disabled`);
    } else {
        console.log(`Public chat: enabled (default)`);
    }

    console.log(`\n✓ Bot "${botUsername}" created successfully!`);
    console.log(`\nCredentials saved in bots/${botUsername}/bot.env`);
    console.log(`\nTo get started:`);
    console.log(`  Use MCP execute_code on "${botUsername}" — it opens the browser client automatically.`);
    console.log(`  For a standalone script, first open the browser bot client using the credentials in bot.env and leave it running.`);
    console.log(`  Scripts do not start a game client. Once the browser is attached, run:`);
    console.log(`  bun bots/${botUsername}/script.ts`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const positional: string[] = [];
let serverOverride: string | undefined;
let hideChat = false;
let claim = false;
let key: string | undefined = process.env.PVP_SDK_KEY || undefined; // Bun loads the project's .env

for (const arg of args) {
    if (arg === '--claim') {
        claim = true;
    } else if (arg.startsWith('--key=')) {
        key = arg.slice('--key='.length);
    } else if (arg === '--local') {
        serverOverride = 'localhost';
    } else if (arg.startsWith('--server=')) {
        serverOverride = arg.slice('--server='.length);
    } else if (arg === '--no-chat' || arg === '--hide-chat') {
        hideChat = true;
    } else if (arg === '--show-chat') {
        // Public chat is now on by default; accepted as a no-op for back-compat.
    } else {
        positional.push(arg);
    }
}

if (claim) {
    if (!positional[0]) {
        console.error('Usage: bun bots/create-bot.ts <name> --claim');
        process.exit(1);
    }
    claimBot(positional[0], serverOverride, key).catch(console.error);
} else {
    createBot(positional[0], serverOverride, hideChat, key).catch(console.error);
}
