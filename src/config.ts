/*
Copyright (C) 2020, 2021 Famedly

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

// tslint:disable no-magic-numbers
const THIRTY_MIN = 30 * 60 * 1000;
const TWO_MIN = 120 * 1000;
const DEFAULT_RATE_LIMIT_WINDOW = 60000;
const DEFAULT_RATE_LIMIT_MAX = 5;
// tslint:enable no-magic-numbers

export class Config {
	public logging: LoggingConfig = new LoggingConfig();
	public webserver: WebserverConfig = new WebserverConfig();
	public session: SessionConfig = new SessionConfig();
	public usernameMapper: UsernameMapperConfig = new UsernameMapperConfig();
	public homeserver: HomeserverConfig = new HomeserverConfig();
	public stages: StagesTempalteConfig = new StagesTempalteConfig();
	public templates: TemplatesConfig = new TemplatesConfig();
	public uia: UiaConfig = new UiaConfig();
	public openid?: OpenIdConfig;

	// tslint:disable-next-line no-any
	public applyConfig(newConfig: {[key: string]: any}, layer: {[key: string]: any} = this) {
		for (const key in newConfig) {
			if (newConfig.hasOwnProperty(key)) {
				if (layer[key] instanceof Object && !(layer[key] instanceof Array)) {
					this.applyConfig(newConfig[key], layer[key]);
				} else {
					layer[key] = newConfig[key];
				}
			}
		}
	}
}

export class LoggingConfig {
	public console: string | LoggingInterfaceConfig = "info";
	public lineDateFormat: string = "MMM-D HH:mm:ss.SSS";
	public files: LoggingFileConfig[] = [];
}

export class LoggingInterfaceModuleConfig {
	public module: string;
	public regex: string;
}

export class LoggingInterfaceConfig {
	public level: string = "info";
	public enabled: (string | LoggingInterfaceModuleConfig)[] = [];
	public disabled: (string | LoggingInterfaceModuleConfig)[] = [];
}

export class LoggingFileConfig extends LoggingInterfaceConfig {
	public file: string;
	public maxFiles: string = "14d";
	public maxSize: string|number = "50m";
	public datePattern: string = "YYYY-MM-DD";
}

export class WebserverConfig {
	public host: string;
	public port: number;
}

export class FlowsConfig {
	public stages: string[] = [];
}

export class SessionConfig {
	public timeout: number = THIRTY_MIN;
}

export enum UsernameMapperModes {
	PLAIN = "PLAIN",
	HMAC_SHA256 = "HMAC-SHA256",
}

export class UsernameMapperConfig {
	public mode: UsernameMapperModes = UsernameMapperModes.HMAC_SHA256;
	public pepper: string;
	public folder: string;
}

export class HomeserverTokenConfig {
	public secret: string;
	public algorithm: string;
	public expires: number = TWO_MIN;
}

export class HomeserverConfig {
	public domain: string;
	public url: string;
	/** The reachable, external URL of the homeserver.  */
	public base?: string;
	public token: HomeserverTokenConfig = new HomeserverTokenConfig();
}

export class StagesTemplateSingleConfig {
	public type: string;
	public config: StageConfig;
}

export class StagesTempalteConfig {
	[key: string]: StagesTemplateSingleConfig;
}

export class TemplatesConfig {
	[key: string]: SingleUiaConfig;
}

export class StageConfig {
	public homeserver: HomeserverConfig = new HomeserverConfig();
	[key: string]: any; // tslint:disable-line no-any
}

export class RateLimitConfig {
	public enabled: boolean = true;
	public windowMs: number = DEFAULT_RATE_LIMIT_WINDOW;
	public max: number = DEFAULT_RATE_LIMIT_MAX;
}

export class SingleUiaConfig {
	public rateLimit: RateLimitConfig = new RateLimitConfig();
	public stages: {[key: string]: StageConfig} = {};
	public flows: FlowsConfig[] = [];
}

export class UiaConfig {
	public default: SingleUiaConfig = new SingleUiaConfig();
	public login: SingleUiaConfig | null = new SingleUiaConfig();
	public password: SingleUiaConfig | null = new SingleUiaConfig();
	public deleteDevice: SingleUiaConfig | null = new SingleUiaConfig();
	public deleteDevices: SingleUiaConfig | null = new SingleUiaConfig();
	public uploadDeviceSigningKeys: SingleUiaConfig | null = new SingleUiaConfig();
}

/** Configuration for a set of available OpenID providers. */
export class OpenIdConfig {
	/** The default provider to use when one wasn't specified. */
	public default: string;
	/** A map of available providers. */
	public providers: {[key: string]: OidcProviderConfig};
}

// tslint:disable variable-name
/** Configuration for an individual OpenID provider. */
export class OidcProviderConfig {
	/** The issuer URL of this OpenID provider. Used for autodiscovery. */
	public issuer: string;
	/** The relying party identifier at the OpenID provider */
	public client_id: string;
	/** The secret which authorizes the replying party at the OP. */
	public client_secret: string;
	/** The OpenID scope value. Determines what information the OP sends. */
	public scopes: string;
	/** Autodiscovery url */
	public autodiscover: boolean;
	/** The OpenID authorization endpoint which the end user performs login with. */
	public authorization_endpoint?: string;
	/** The token exchange endpoint where an auth code is exchanged for a token. */
	public token_endpoint?: string;
	/** The provider's user info endpoint */
	public userinfo_endpoint?: string;
	/** The URL where the OP publishes its JWK set of signing keys */
	public jwks_uri?: string;
	/** The JWT claim which will be used to identify the user. Defaults to `sub` if unspecified. */
	public subject_claim?: string;
	/** A map of claims to their expected values */
	public expected_claims?: {[key: string]: string | undefined};
}
// tslint:enable variable-name
