/*
Copyright (C) 2020 Famedly

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { IStage, ParamsData, AuthData, IAuthResponse, IStageUiaProxyVars, ensure_localpart } from "./stage";
import { IExtraSessionData } from "../session";
import { StageConfig } from "../config";
import { Oidc, IToken } from "./com.famedly.login.sso/openid";
import { STATUS_FOUND, STATUS_BAD_REQUEST, STATUS_UNAUTHORIZED, STATUS_OK } from "../webserver";
import { UsernameMapper } from "../usernamemapper";
import { Log } from "../log";

const log = new Log("OpenID inner");
/** The endpoint which redirects an end-user to an OpenID Connect authorization endpoint */
const DEFAULT_ENDPOINT_SSO_REDIRECT = "/_matrix/client/unstable/com.famedly/login/sso/redirect";
/**
 * The OpenID redirection/callback endpoint where the end user is redirected
 * along with an auth code once authorization at the authorization endpoint has
 * been completed.
 */
const DEFAULT_ENDPOINT_OIDC_CALLBACK = "/_uiap/oicd/callback";

/** Configuration for a set of available OpenID providers. */
export interface IOpenIdConfig extends StageConfig {
	/** The default provider to use when one wasn't specified. */
	default: string;
	/** A map of available providers. */
	providers: {[key: string]: IOidcProviderConfig};
	/** the endpoints */
	endpoints: {
		/** The Redirects should happen via json */
		json_redirects: boolean;
		/** The OpenID redirect endpoint */
		redirect: string;
		/** The OpenID callback endpoint */
		callback: string;
	}
}

// tslint:disable variable-name
/** Configuration for an individual OpenID provider. */
export interface IOidcProviderConfig {
	/** The issuer URL of this OpenID provider. Used for autodiscovery. */
	issuer: string;
	/** The relying party identifier at the OpenID provider */
	client_id: string;
	/** The secret which authorizes the relying party at the OP. */
	client_secret: string;
	/** The OpenID scope value. Determines what information the OP sends. */
	scopes: string;
	/** Autodiscovery url */
	autodiscover: boolean;
	/** Whether to perform token introspection */
	introspect: boolean;
	/** The OpenID authorization endpoint which the end user performs login with. */
	authorization_endpoint?: string;
	/** The token exchange endpoint where an auth code is exchanged for a token. */
	token_endpoint?: string;
	/** The provider's user info endpoint */
	userinfo_endpoint?: string;
	/** the endpoint where token introspection is performed */
	introspection_endpoint?: string;
	/** The URL where the OP publishes its JWK set of signing keys */
	jwks_uri?: string;
	/** The JWT claim which will be used to identify the user. Defaults to `sub` if unspecified. */
	subject_claim?: string;
	/** The JWT claim which will be used to set the user's display name */
	name_claim?: string;
	/** The JWT claim which determines whether a user is an admin */
	admin_claim?: string;
	/** A map of claims to their expected values */
	expected_claims?: {[key: string]: string | undefined};
	/** The namespace used for this provider to generate the mxids */
	namespace?: string;
}
// tslint:enable variable-name

/** Matrix error code for valid but malformed JSON. */
const M_BAD_JSON = "M_BAD_JSON";
/** Matrix error code for uncategorized errors. */
const M_UNKNOWN = "M_UNKNOWN";
/** Matrix error code for denied access, usually because of failed login */
const M_FORBIDDEN = "M_FORBIDDEN";

export class Stage implements IStage {
	public type: string = "com.famedly.login.sso";
	private config: IOpenIdConfig;
	private static openidMap: Map<string, Oidc> = new Map();

	private get openIdIdentifier() {
		return `${this.config.endpoints.redirect}|${this.config.endpoints.callback}`;
	}

	private setOpenid(oidc: Oidc) {
		Stage.openidMap.set(this.openIdIdentifier, oidc);
	}

	private get openid() {
		const openid = Stage.openidMap.get(this.openIdIdentifier);
		if (!openid) {
			throw new Error('OpenID handler unexpectedly does not exist');
		}
		return openid;
	}

	public async init(config: IOpenIdConfig, vars: IStageUiaProxyVars) {
		this.config = config;
		if (!this.config.endpoints) {
			this.config.endpoints = {
				json_redirects: false,
				redirect: '',
				callback: '',
			};
		}
		if (!this.config.endpoints.redirect) {
			this.config.endpoints.redirect = DEFAULT_ENDPOINT_SSO_REDIRECT;
		}
		if (!this.config.endpoints.callback) {
			this.config.endpoints.callback = DEFAULT_ENDPOINT_OIDC_CALLBACK;
		}
		if (this.config.endpoints.json_redirects) {
			this.type = "m.login.sso"
		}

		if (!Stage.openidMap.has(this.openIdIdentifier)) {
			this.setOpenid(await Oidc.factory(this.config));

			vars.express.get(`${this.config.endpoints.redirect}/:provider?`, (req, res) => {
				// Cast since we know we're using the simple query parser.
				const query = req.query as {[key: string]: string | string[] | undefined};
				let { redirectUrl, uiaSession } = query;
				if (!redirectUrl || !uiaSession) {
					res.status(STATUS_BAD_REQUEST);
					res.json({
						errcode: "M_UNRECOGNIZED",
						error: "Missing redirectUrl or uiaSession",
					});
					return;
				}
				// If the query parameter was supplied multiple times, pick the last one
				redirectUrl = Array.isArray(redirectUrl) ? redirectUrl[redirectUrl.length] : redirectUrl;
				uiaSession = Array.isArray(uiaSession) ? uiaSession[uiaSession.length] : uiaSession;
				const provider = req.params.provider || this.openid.config.default;
				const baseUrl = this.config.homeserver.base || `https://${this.config.homeserver.domain}`;

				const authUrl = this.openid.ssoRedirect(provider, redirectUrl, baseUrl, uiaSession);
				if (!authUrl) {
					res.status(STATUS_BAD_REQUEST);
					res.json({
						errcode: "M_UNRECOGNIZED",
						error: "Unknown OpenID provider",
					});
					return;
				}

				if (!this.config.endpoints.json_redirects) {
					res.redirect(STATUS_FOUND, authUrl);
				} else {
					res.status(STATUS_OK);
					res.json({
						location: authUrl,
					});
				}
			});
			// The OpenID callback/redirection endpoint
			vars.express.get(this.config.endpoints.callback, async (req, res) => {
				// Cast since we know we're using the simple query parser.
				const query = req.query as {[key: string]: string | string[] | undefined};
				let sessionId = query.state;
				if (!sessionId) {
					res.status(STATUS_BAD_REQUEST);
					res.json({
						errcode: "M_UNRECOGNIZED",
						error: "Missing state query parameter",
					});
					return;
				}
				// If the query parameter was supplied multiple times, pick the last one
				sessionId = Array.isArray(sessionId) ? sessionId[sessionId.length] : sessionId;
				const baseUrl = this.config.homeserver.base || `https://${this.config.homeserver.domain}`;

				const callbackResponse = await this.openid.oidcCallback(req.originalUrl, sessionId, baseUrl);
				if (typeof callbackResponse !== "string") {
					res.status(STATUS_UNAUTHORIZED);
					res.json(callbackResponse);
					return;
				}

				if (!this.config.endpoints.json_redirects) {
					res.redirect(STATUS_FOUND, callbackResponse);
				} else {
					res.status(STATUS_OK);
					res.json({
						location: callbackResponse,
					});
				}
			});
		}
	}

	public async getParams(_sessionData: IExtraSessionData): Promise<ParamsData> {
		const providers: {[key: string]: string} = {};
		const baseUrl = this.config.homeserver.base || `https://${this.config.homeserver.domain}`;
		for (const key of Object.keys(this.config.providers)) {
			providers[key] = `${baseUrl}${this.config.endpoints.redirect}/${key}?uiaSession=${_sessionData.sessionId}`;
		}
		return {
			providers,
		};
	}

	/**
	 * Performs authentication by checking that the supplied token is in the set
	 * of valid tokens, and also checks that we're in the right UIA session if
	 * necessary.
	 */
	public async auth(data: AuthData, _params: ParamsData | null): Promise<IAuthResponse> {
		const tokenId = data.token;
		// Make sure that username and token exist and are strings
		if (typeof tokenId !== "string") {
			return {
				success: false,
				errcode: M_BAD_JSON,
				error: "Missing login token",
			};
		}
		let success = false;
		const providerId = tokenId.split("|")[0];
		let token: IToken | undefined;
		let message: string | undefined;
		// tslint:disable-next-line label-position
		checkToken: {
			if (!this.openid.provider[providerId]) {
				message = "provider doesn't exist";
				break checkToken;
			}
			token = this.openid.provider[providerId]!.tokens.get(tokenId);
			if (!token) {
				message = "Token is invalid";
				break checkToken;
			}
			if (token.uiaSession !== data.session) {
				message = "Token is invalid";
				break checkToken;
			}
			success = true;
		}

		if (!success || !token) {
			return {
				success: false,
				errcode: M_FORBIDDEN,
				error: `Token login failed: ${message}`,
			};
		} else {
			const provider = this.openid.provider[providerId]!;
			provider.tokens.delete(tokenId);
			return {
				success: true,
				data: {
					username: await UsernameMapper.usernameToLocalpart(`${provider.namespace}/${token.user}`),
					displayname: token.displayname,
				},
			};
		}
	}
}
