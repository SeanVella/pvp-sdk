// pvp-sdk: fair play (docs/FAIR_PLAY.md). Texts a code to a phone number and checks it.
// Twilio Verify keeps the code and its expiry, so nothing secret is stored here. Our server
// sends every text (behind Turnstile and the caps in web/pages/account.ts), which is what
// keeps an attacker from running up the owner's bill with texts to premium numbers.
import Environment from '#/util/Environment.js';

export type SendResult = { ok: true } | { ok: false; error: string };

export interface PhoneVerifier {
    send(phone: string): Promise<SendResult>;
    check(phone: string, code: string): Promise<boolean>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class TwilioVerify implements PhoneVerifier {
    constructor(
        private readonly accountSid: string,
        private readonly authToken: string,
        private readonly serviceSid: string,
        private readonly fetchImpl: Fetch = fetch
    ) {}

    async send(phone: string): Promise<SendResult> {
        const res = await this.post('Verifications', { To: phone, Channel: 'sms' });
        if (res.ok) return { ok: true };
        const body = (await res.json().catch(() => ({}))) as { code?: number };
        // https://www.twilio.com/docs/api/errors - the ones a player can do something about
        if (body.code === 60200 || body.code === 21211 || body.code === 21614) return { ok: false, error: "That doesn't look like a valid mobile number." };
        if (body.code === 60203) return { ok: false, error: 'Too many codes sent to that number. Try again later.' };
        if (body.code === 60605 || body.code === 60410 || body.code === 21408 || body.code === 21612) {
            return { ok: false, error: "We can't send texts to that number's country." };
        }
        if (body.code === 21608) {
            // A trial account, or an upgraded one without an approved Primary Customer Profile,
            // only texts the numbers listed as Verified Caller IDs in its console.
            console.warn('[accounts] Twilio refused an unverified number (21608): the Twilio account needs an approved Primary Customer Profile (Trust Hub); until then only Verified Caller IDs get texts');
            return { ok: false, error: 'Sign-up texts aren\'t switched on yet. Tell the server owner.' };
        }
        console.warn(`[accounts] Twilio send failed: ${res.status} ${body.code ?? ''}`);
        return { ok: false, error: "Couldn't send a text right now. Try again in a few minutes." };
    }

    async check(phone: string, code: string): Promise<boolean> {
        const res = await this.post('VerificationCheck', { To: phone, Code: code });
        if (!res.ok) return false; // 404 = no pending code (expired, used, or never sent)
        const body = (await res.json().catch(() => ({}))) as { status?: string };
        return body.status === 'approved';
    }

    private post(path: string, form: Record<string, string>): Promise<Response> {
        return this.fetchImpl(`https://verify.twilio.com/v2/Services/${this.serviceSid}/${path}`, {
            method: 'POST',
            headers: {
                Authorization: 'Basic ' + Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams(form).toString()
        });
    }
}

/** Local testing only: sends nothing and accepts 000000. */
export class DevVerify implements PhoneVerifier {
    async send(phone: string): Promise<SendResult> {
        console.log(`[accounts] PHONE_VERIFY=dev: the code for ${phone.slice(0, 4)}... is 000000`);
        return { ok: true };
    }

    async check(_phone: string, code: string): Promise<boolean> {
        return code === '000000';
    }
}

/** The configured verifier, or null when sign-up can't work yet (keys missing). */
export function phoneVerifier(): PhoneVerifier | null {
    if (Environment.PHONE_VERIFY === 'dev') return new DevVerify();
    if (!Environment.TWILIO_ACCOUNT_SID || !Environment.TWILIO_AUTH_TOKEN || !Environment.TWILIO_VERIFY_SERVICE_SID) return null;
    return new TwilioVerify(Environment.TWILIO_ACCOUNT_SID, Environment.TWILIO_AUTH_TOKEN, Environment.TWILIO_VERIFY_SERVICE_SID);
}

/**
 * Cloudflare Turnstile: proves a person (not a script) filled the form. Without a secret
 * key only PHONE_VERIFY=dev skips it; a live server refuses instead.
 */
export async function verifyTurnstile(token: string | null, ip: string | null, fetchImpl: Fetch = fetch): Promise<boolean> {
    const secret = Environment.TURNSTILE_SECRET_KEY;
    if (!secret) return Environment.PHONE_VERIFY === 'dev';
    if (!token) return false;
    const form = new URLSearchParams({ secret, response: token });
    if (ip) form.set('remoteip', ip);
    try {
        const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
        const body = (await res.json()) as { success?: boolean };
        return body.success === true;
    } catch {
        return false;
    }
}
