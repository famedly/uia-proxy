/** Handlers and state management for OpenID Connect related functionality. */

import { Log } from "./log";
import { generators, Issuer, Client } from "openid-client";
import { OpenIdConfig, OidcProviderConfig } from "./config";
import { TimedCache } from "./structures/timedcache";
import { ENDPOINT_OIDC_CALLBACK } from "./webserver";
import { UsernameMapper } from "./usernamemapper";

const log = new Log("OpenID");
// tslint:disable no-magic-numbers
const THIRTY_MINUTES = 30 * 60 * 1000;
// tslint:enable no-magic-numbers

/** A map of valid login tokens to an optional UIA session ID. */
export let tokens: TimedCache<string, IToken> = new TimedCache(THIRTY_MINUTES);

/** Data associated with an SSO login token. */
export interface IToken {
	/** The token ID. */
	token: string;
	/** The ID of the UIA session potentially associated with this SSO attempt. */
	uiaSession: string | null;
	/** The user localpart this login token is valid for. */
	user: string,
}

/** Holds state and configuration for a set of OpenID Connect providers. */
export class Oidc {
	/**
	 * Constructs new OpenID Connect state and objects for providers using the
	 * provided configuration.
	 */
	public static async factory(config: OpenIdConfig): Promise<Oidc> {
		const oidc = new Oidc(config);
		if (!config.providers[config.default]) {
			throw new Error("Default points to non-existant OpenID provider");
		}
		for (const [id, provider] of Object.entries(oidc.config.providers)) {
			let issuer: Issuer<Client> | undefined;
			// Use autodiscovery if we've been provided with a url
			if (provider.autodiscover) {
				issuer = await Issuer.discover(provider.issuer);
			} else {
				issuer = new Issuer({
					issuer: provider.issuer,
					authorization_endpoint: provider.authorization_endpoint,
					token_endpoint: provider.token_endpoint,
					userinfo_endpoint: provider.userinfo_endpoint,
					jwks_uri: provider.jwks_uri,
				});
			}
			oidc.provider[id] = new OidcProvider(provider, issuer, id);
		}
		return oidc;
	}

	/** The available OpenID providers. */
	public provider: {[key: string]: OidcProvider | undefined};
	/** The configuration of available OpenID providers */
	public config: OpenIdConfig;
	/** Ongoing authentication sessions */
	public session: {[key: string]: OidcSession | undefined} = {};

	private constructor(config: OpenIdConfig) {
		this.config = config;
		this.provider = {};
	}

	/** Returns the default OpenID provider object. */
	public default(): OidcProvider {
		return this.provider[this.config.default]!;
	}

	/** Delegate an SSO redirect to the appropriate provider */
	public ssoRedirect(providerId: string, redirectUrl: string, baseUrl: string, uiaSession?: string): string | null {
		if (!this.provider[providerId]) {
			return null
		}
		const provider = this.provider[providerId]!;

		const { session, authUrl } = provider.ssoRedirect(redirectUrl, baseUrl, uiaSession);

		this.session[session.id] = session;
		return authUrl;
	}

	/** Delegate responding to an OpenID callback to the appropriate provider. */
	public async oidcCallback(
		originalUrl: string,
		sessionId: string,
		baseUrl: string,
	): Promise<string | null> {
		// Get the session and provider
		const session = this.session[sessionId];
		if (!session) {
			return null;
		}
		// sessions only get stored for providers that exist, so we can use ! here
		const provider = this.provider[session.provider]!;

		// Perform token exchange.
		const redirectUrl = await provider.oidcCallback(originalUrl, session, baseUrl);

		if (!redirectUrl) {
			return null;
		}
		// Session is finished, so delete it.
		delete this.session[sessionId];
		// Return the redirect URL with the matrix token.
		return redirectUrl;
	}

}

/** Represents an individial OpenID connect provider. */
export class OidcProvider {
	constructor(
		/** Configuration for the provider */
		private config: OidcProviderConfig,
		/** Represents the OpenId provider and performs authentication tasks. */
		private issuer: Issuer<Client>,
		/** The id of the provider given in the config file */
		private id: string,
	) { }

	/**
	 * Redirects the end user to the OpenID authorization endpoint, and stores
	 * state for performing further steps in the `code` authentication flow.
	 *
	 * @param redirectUrl - The URL the end user should redirect themselves to
	 * when auth is finished.
	 * @param uiaSession - The UIA session id this auth is being performed for.
	 */
	public ssoRedirect(redirectUrl: string, baseUrl: string, uiaSession?: string): {session: OidcSession, authUrl: string} {
		const id = generators.state();
		log.info(`Initializing new OpenID code login flow with id ${id}`);

		// Construct the client
		const callbackUrl = new URL(ENDPOINT_OIDC_CALLBACK, baseUrl);
		const client = new this.issuer.Client({
			client_id: this.config.client_id,
			client_secret: this.config.client_secret,
			redirect_uris: [callbackUrl.toString()],
			response_types: ["code"],
		});
		// Construct the session
		const session = new OidcSession(id, this.id, redirectUrl, client, uiaSession);
		// generate the url to the authorization endpoint
		const authUrl = client.authorizationUrl({
			scope: this.config.scopes,
			state: session.id,
		});
		// redirect the user to the authorization url
		return {session, authUrl};
	}

	/**
	 * Handles the OpenID callback/redirection endpoint the end-user gets
	 * redirected to with an auth code after successful authentication.
	 *
	 * @param originalUrl - The path and query segment of the URL this endpoint.
	 * was invoked with
	 * @param session - The session belonging to this authorization attempt.
	 * @param baseUrl - The public facing base URL.
	 */
	public async oidcCallback(
		originalUrl: string,
		session: OidcSession,
		baseUrl: string,
	): Promise<string | null> {
		log.info(`Received callback for OpenID login session ${session.id}`);

		// Prepare parameters
		const params = session.client.callbackParams(originalUrl);
		const url = new URL(ENDPOINT_OIDC_CALLBACK, baseUrl);

		// Perform auth code/token exchange
		const tokenSet = await session.client.callback(url.toString(), params, {state: session.id});

		// Verify claims
		const claims = tokenSet.claims();
		const subjectClaim = claims[this.config.subject_claim || "sub"];
		if (typeof subjectClaim !== "string") {
			throw new TypeError("Expected subject claim to be a string");
		}
		for (const [key, value] of Object.entries(this.config.expected_claims || {})) {
			if (claims[key] !== value) {
				return null;
			}
		}

		// Generate and store matrix token
		const user = await UsernameMapper.usernameToLocalpart(subjectClaim);
		const matrixToken = generators.random();
		tokens.set(matrixToken, {
			token: matrixToken,
			uiaSession: session.uiaSession,
			user,
		});

		// Return the URL the end-user should redirect themselves to
		return `${session.redirectUrl}?loginToken=${matrixToken}`;
	}
}

/** An ongoing OpenID Connect login session. */
export class OidcSession {
	constructor(
		/** The id of this session, to be used in the `state` query parameter */
		public id: string,
		/** The OP this is a session for */
		public provider: string,
		/**
		 * The opaque redirection URL a matrix client sent us which it uses for
		 * finishing the auth flow
		 */
		public redirectUrl: string,
		/** The OpenID Connect client */
		public client: Client,
		/** The UIA session associated with this login attempt. */
		public uiaSession: string | null = null,
	) {
	}
}
