/** Handlers and state management for OpenID Connect related functionality. */

import { Log } from "../../log";
import { generators, Issuer, Client, IntrospectionResponse, IdTokenClaims, TokenSet } from "openid-client";
import { IOpenIdConfig, IOidcProviderConfig } from "../stage_com.famedly.login.sso";
import { TimedCache } from "../../structures/timedcache";

const log = new Log("OpenID");
// tslint:disable no-magic-numbers
const THIRTY_MINUTES = 30 * 60 * 1000;
// tslint:enable no-magic-numbers
// TODO: Define these error objects in a unified place
/** Matrix error for JSON data that is valid but malformed */
const M_BAD_JSON: string = "M_BAD_JSON";
/** Matrix error for unauthorized requests */
const M_UNAUTHORIZED: string = "M_UNAUTHORIZED";

/**
 * Return a matrix error object with the given message and the
 * `F_TOKEN_INACTIVE` error code
 */
function F_TOKEN_INACTIVE(error: string): {error: string, errcode: string} {
	return {errcode: "F_TOKEN_INACTIVE", error};
}

/**
 * Return a matrix error object with the given message and the
 * `M_UNKNOWN` error code
 */
function M_UNKNOWN(error: string): {error: string, errcode: string} {
	return {errcode: "M_UNKNOWN", error};
}

/** Data associated with an SSO login token. */
export interface IToken {
	/** The token ID. */
	token: string;
	/** The ID of the UIA session potentially associated with this SSO attempt. */
	uiaSession?: string;
	/** The user localpart this login token is valid for. */
	user: string,
	/** Update display name to this on login if set. */
	displayname?: string,
	/** Update admin status to the this value on login if set. */
	admin?: boolean,
}

/** Holds state and configuration for a set of OpenID Connect providers. */
export class Oidc {
	/**
	 * Constructs new OpenID Connect state and objects for providers using the
	 * provided configuration.
	 */
	public static async factory(config: IOpenIdConfig): Promise<Oidc> {
		const oidc = new Oidc(config);
		if (config.default && !config.providers[config.default]) {
			log.debug(`Didn't find default ${config.default} in ${Object.keys(config.providers)}`);
			throw new Error("Default points to non-existent OpenID provider");
		}
		for (const [id, provider] of Object.entries(oidc.config.providers)) {
			let issuer: Issuer<Client> | undefined;
			// Use autodiscovery if we've been provided with a url
			if (provider.autodiscover) {
				const {metadata} = await Issuer.discover(provider.issuer);
				// Override autodiscovery with hand-configured values.
				const keys = ["authorization_endpoint", "token_endpoint", "userinfo_endpoint", "introspection_endpoint", "jwks_uri"];
				for (const key of keys) {
					if (provider[key]) {
						metadata[key] = provider[key];
					}
				}
				issuer = new Issuer(metadata);
			} else {
				issuer = new Issuer({
					issuer: provider.issuer,
					authorization_endpoint: provider.authorization_endpoint,
					token_endpoint: provider.token_endpoint,
					userinfo_endpoint: provider.userinfo_endpoint,
					introspection_endpoint: provider.introspection_endpoint,
					jwks_uri: provider.jwks_uri,
				});
			}
			Oidc.provider[id] = new OidcProvider(provider, issuer, id, oidc.config.endpoints.callback);
		}
		return oidc;
	}

	/** The available OpenID providers. */
	public static provider: { [key: string]: OidcProvider | undefined } = {};
	/** The configuration of available OpenID providers */
	public config: IOpenIdConfig;
	/** Ongoing authentication sessions */
	public static session: { [key: string]: OidcSession | undefined } = {};

	private constructor(config: IOpenIdConfig) {
		this.config = config;
	}

	/** Returns the default OpenID provider object. */
	public default(): OidcProvider {
		return Oidc.provider[this.config.default!]!;
	}

	/** Delegate an SSO redirect to the appropriate provider */
	public ssoRedirect(providerId: string, redirectUrl: string, baseUrl: string, uiaSession?: string): string | null {
		if (!Oidc.provider[providerId]) {
			log.error(`Didn't find provider ${providerId} in ${Object.keys(Oidc.provider)}`);
			return null
		}
		const provider = Oidc.provider[providerId]!;

		const {session, authUrl} = provider.ssoRedirect(redirectUrl, baseUrl, uiaSession);

		Oidc.session[session.id] = session;
		return authUrl;
	}

	/**
	 * Delegate responding to an OpenID callback to the appropriate provider.
	 *
	 * @returns a redirect URL on success, and a matrix error object on
	 * failure.
	 */
	public async oidcCallback(
		originalUrl: string,
		sessionId: string,
		baseUrl: string,
	): Promise<string | {error: string, errcode: string}> {
		// Get the session and provider
		const session = Oidc.session[sessionId];
		if (!session) {
			return { errcode: M_BAD_JSON, error: "No session with this ID" };
		}
		// sessions only get stored for providers that exist, so we can use ! here
		const provider = Oidc.provider[session.provider]!;

		// Perform token exchange.
		const callbackResponse = await provider.oidcCallback(originalUrl, session, baseUrl);

		if (typeof callbackResponse === "string") {
			// Session was completed successfully, so delete it.
			log.debug(`Deleting finished session ${sessionId}`)
			delete Oidc.session[sessionId];
		}
		// Return the redirect URL with the matrix token.
		return callbackResponse;
	}

}

/** Represents an individual OpenID connect provider. */
export class OidcProvider {
	/** A map of valid login tokens to an optional UIA session ID. */
	public tokens: TimedCache<string, IToken> = new TimedCache(THIRTY_MINUTES);

	constructor(
		/** Configuration for the provider */
		private config: IOidcProviderConfig,
		/** Represents the OpenId provider and performs authentication tasks. */
		private issuer: Issuer<Client>,
		/** The id of the provider given in the config file */
		private id: string,
		/** The relying party oidc callback url */
		private oidcCallbackUrl: string,
	) { }

	/**
	 * The string to use for namespacing mxid's to a specific provider.
	 * Returns null if namespacing should not be done
	 */
	public get namespace(): string | null {
		if (this.config.namespace === false || this.config.namespace === 'false') {
			return null;
		}
		return this.config.namespace?.toString() ?? this.id;
	}

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
		const callbackUrl = new URL(this.oidcCallbackUrl, baseUrl);
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
			redirect_uri: redirectUrl
		});
		// redirect the user to the authorization url
		log.debug(`redirecting session ${id} to ${authUrl}`);
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
	): Promise<string | {error: string, errcode: string}> {
		log.info(`Received callback for OpenID login session ${session.id}`);

		// Prepare parameters
		const params = session.client.callbackParams(originalUrl);
		const url = new URL(this.oidcCallbackUrl, baseUrl);

		// Perform auth code/token exchange
		let tokenSet: TokenSet;
		try {
			tokenSet = await session.client.callback(url.toString(), params, {state: session.id});
		} catch (e) {
			log.error(`Callback failed: ${e.message ?? e}`);
			return M_UNKNOWN("OpenID callback failed");
		}
		log.debug(`Callback for session ${session.id} successful`);
		if (this.config.introspect) {
			let introspection: IntrospectionResponse;
			try {
				introspection = await session.client.introspect(tokenSet.id_token!);
			} catch (error) {
				log.error(error.message ?? error);
				return M_UNKNOWN("Introspection failed")
			}
			if (!introspection.active) {
				return F_TOKEN_INACTIVE("The JWT token is inactive");
			}
		}

		// Verify claims
		let claims: IdTokenClaims;
		try {
			claims = tokenSet.claims();
		} catch (e) {
			return M_UNKNOWN("OP gave invalid JWT");
		}
		const subjectClaim = claims[this.config.subject_claim || "sub"];
		const nameClaim = this.config.name_claim && claims[this.config.name_claim];
		const adminClaim = this.config.admin_claim && claims[this.config.admin_claim];
		if (nameClaim) {
			log.debug(`Displayname set by provider as ${nameClaim}`);
		}
		if (typeof subjectClaim !== "string") {
			throw new TypeError("Expected subject claim to be a string");
		}
		if (typeof nameClaim !== "undefined" && typeof nameClaim !== "string") {
			throw new TypeError("Expected name claim to be a string or undefined");
		}
		if (typeof adminClaim !== "undefined" && typeof adminClaim !== "boolean") {
			throw new TypeError("Expected admin claim to be a boolean or undefined");
		}
		for (const [key, value] of Object.entries(this.config.expected_claims || {})) {
			if (claims[key] !== value) {
				log.verbose(`Session ${session.id} claim '${key}' has value '${claims[key]}', expected '${value}'`)
				return {
					error: "User is not allowed to perform login",
					errcode: M_UNAUTHORIZED,
				};
			}
		}

		// Generate and store matrix token
		const matrixToken = `${this.id}|${generators.random()}`;
		this.tokens.set(matrixToken, {
			token: matrixToken,
			uiaSession: session.uiaSession,
			user: subjectClaim,
			displayname: nameClaim,
			admin: adminClaim,
		});

		// Return the URL the end-user should redirect themselves to
		log.debug(`Redirecting client to ${session.redirectUrl}?loginToken=<token>`);
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
		public uiaSession?: string,
	) {
	}
}
