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

/**
 * Type definitions and deserialization logic for configuration file data.
 *
 * Deserialization logic is defined with the library io-ts. It works by defining
 * a codec, which is a structured description of how a data structure should be
 * represented.
 *
 * The way it's used here is by defining a static member on each configuration
 * class, describing how the class should be represented.
 */

import * as jwt from "jsonwebtoken";
import * as t from "io-ts";
import * as tx from "./fp"
import { fromNullable } from "io-ts-types";

// tslint:disable no-magic-numbers
const THIRTY_MIN = 30 * 60 * 1000;
const TWO_MIN = 120 * 1000;
const DEFAULT_RATE_LIMIT_WINDOW = 60000;
const DEFAULT_RATE_LIMIT_MAX = 5;
// tslint:enable no-magic-numbers

/** Configuraiion of the web server's behavior */
export class WebserverConfig {
	/** The host where the webserver should listen for requests */
	public host: string;
	/** The port where the webserver should listen for requests */
	public port: number;

	public static codec = t.type({
		host: t.string,
		port: t.number,
	});

	constructor(init: t.TypeOf<typeof WebserverConfig.codec>) {
		this.host = init.host;
		this.port = init.port;
	}
}

export class SessionConfig {
	/** Time in seconds before a login attempt gets discarded */
	public timeout: number = THIRTY_MIN;

	public static codec = t.partial({
		timeout: t.number,
	});

	constructor(init: t.TypeOf<typeof SessionConfig.codec>) {
		this.timeout = init.timeout ?? this.timeout;
	}
}

export class LoggingInterfaceModuleConfig {
	/** Configure log messages with this module name */
	public module: string;
	/** Match log messages with this regex */
	public regex: string;

	public static codec = t.type({
		module: t.string,
		regex: t.string,
	});

	constructor(init: t.TypeOf<typeof LoggingInterfaceModuleConfig.codec>) {
		this.module = init.module;
		this.regex = init.regex;
	}
}

export class LoggingInterfaceConfig {
	/** Noisiest allowed log level */
	public level: string = "info";
	/** A list of module names which should be enabled, or more detailed module configuration */
	public enabled: (string | LoggingInterfaceModuleConfig)[] = [];
	/** A list of module names which should be disabled, or more detailed module configuration */
	public disabled: (string | LoggingInterfaceModuleConfig)[] = [];

	public static codec = t.type({
		level: fromNullable(t.string, new LoggingInterfaceConfig().level),
		enabled: fromNullable(t.array(t.union([t.string, LoggingInterfaceModuleConfig.codec])), []),
		disabled: fromNullable(t.array(t.union([t.string, LoggingInterfaceModuleConfig.codec])), []),
	});

	constructor(init?: t.TypeOf<typeof LoggingInterfaceConfig.codec>) {
		this.level = init?.level ?? this.level;
		this.enabled = init?.enabled ?? this.enabled;
		this.disabled = init?.disabled ?? this.disabled;
	}
}

export class LoggingFileConfig extends LoggingInterfaceConfig {
	/** The path this log file should be written to */
	public file: string;
	/**
	 * Maximum number of log files to keep. If not set, no logs will be removed.
	 * This can be a number of files or number of days. If using days, add 'd'
	 * as the suffix. It uses auditFile to keep track of the log files in a json
	 * format. It won't delete any file not contained in it. It can be a number
	 * of files or number of days
	 */
	public maxFiles: string = "14d";
	/** Maximum allowed size for a log file.  */
	public maxSize: string|number = "50m";
	/**
	 * A string representing the moment.js date format to be used for rotating.
	 * The meta characters used in this string will dictate the frequency of the
	 * file rotation. For example, if your datePattern is simply 'HH' you will
	 * end up with 24 log files that are picked up and appended to every day.
	 */
	public datePattern: string = "YYYY-MM-DD";

	// TODO: make inheritance happy so we can avoid the awkward name
	public static codec2 = t.intersection([
		super.codec,
		t.type({
			file: t.string,
			maxFiles: fromNullable(t.string, "14d"),
			maxSize: fromNullable(t.union([t.string, t.number]), "50m"),
			datePattern: fromNullable(t.string, "YYYY-MM-DD"),
		}),
	]);

	constructor(init: t.TypeOf<typeof LoggingFileConfig.codec2>) {
		super(init);
		this.file = init.file;
		this.maxFiles = init.maxFiles ?? this.maxFiles;
		this.maxSize = init.maxSize ?? this.maxSize;
		this.datePattern = init.datePattern ?? this.datePattern;
	}
}

/** Configuration of what should be logged where */
export class LoggingConfig {
	/** Console logging configuration */
	public console: string | LoggingInterfaceConfig = "info";
	/** How the time of a log entry should be formatted */
	public lineDateFormat: string = "MMM-D HH:mm:ss.SSS";
	/** A list of files to log to, with associated configuration */
	public files: LoggingFileConfig[] = [];

	public static codec = fromNullable(t.partial({
		console: t.union([t.string, LoggingInterfaceConfig.codec]),
		lineDateFormat: t.string,
		files: t.array(LoggingFileConfig.codec2),
	}), {});

	constructor(init?: t.TypeOf<typeof LoggingConfig.codec>) {
		this.console = init?.console ?? this.console
		this.lineDateFormat = init?.lineDateFormat ?? this.lineDateFormat;
		this.files = init?.files ?? this.files;
	}
}

/** A possible flow of stages in a UIA configuration */
export class FlowsConfig {
	/** List of stages which must be completed */
	public stages: string[] = [];

	public static codec = t.type({
		stages: t.array(t.string)
	});

	constructor(init?: t.TypeOf<typeof FlowsConfig.codec>) {
		this.stages = init?.stages ?? this.stages;
	}
}

export enum UsernameMapperModes {
	PLAIN = "PLAIN",
	HMAC_SHA256 = "HMAC-SHA256",
}

/** How user names should be mapped to matrix IDs */
export class UsernameMapperConfig {
	/** The mapping mode to use for usernames */
	public mode: UsernameMapperModes = UsernameMapperModes.HMAC_SHA256;
	/** The pepper to use for HMAC */
	public pepper: string;
	/** The folder where the levelup database of mappings should be placed */
	public folder: string;
	/** Whether to UTF-8 decode binary persistent IDs */
	public binaryPid: boolean = false;

	/** Description of how to deserialize this object */
	public static codec = t.intersection([
		t.type({
			pepper: t.string,
			folder: t.string,
		}),
		t.partial({
			mode: t.keyof({
				[UsernameMapperModes.PLAIN]: null,
				[UsernameMapperModes.HMAC_SHA256]: null,
			} satisfies Record<UsernameMapperModes, null>),
			binaryPid: t.boolean,
		})
	]);

	constructor(init: t.TypeOf<typeof UsernameMapperConfig.codec>) {
		this.mode = init.mode ?? this.mode;
		this.pepper = init.pepper;
		this.folder = init.folder;
		this.binaryPid = init.binaryPid ?? this.binaryPid;
	}
}

export class HomeserverTokenConfig {
	/** The shared secret for the homeserver's tokens */
	public secret: string;
	/** The alogithm used for the homeserver's tokens */
	public algorithm: jwt.Algorithm;
	/** How long in milliseconds a JWT generated by UIA proxy should be valid for */
	public expires: number = TWO_MIN;

	public static codec = t.intersection([
		t.type({
			secret: t.string,
			algorithm: t.keyof({
				"HS256": null,
				"HS384": null,
				"HS512": null,
				"RS256": null,
				"RS384": null,
				"RS512": null,
				"ES256": null,
				"ES384": null,
				"ES512": null,
				"PS256": null,
				"PS384": null,
				"PS512": null,
				"none": null,
			} satisfies Record<jwt.Algorithm, null>),
			// The satisfies clause guarantees that we have exactly the possible
			// values of jwt.Algorithm as keys, no more, no less.
		}),
		t.partial({
			expires: t.number,
		})
	]);

	constructor(init: t.TypeOf<typeof HomeserverTokenConfig.codec>) {
		this.secret = init.secret;
		this.algorithm = init.algorithm;
		this.expires = init.expires ?? this.expires;
	}
}

/** Information about the proxied matrix homeserver */
export class HomeserverConfig {
	/** The homeserver's domain */
	public domain: string;
	/** The URL to send matrix API requests via */
	public url: string;
	/** The externally reachable URL of the homeserver.  */
	public base?: string;
	/** The homeserver's synapse token authenticator configuration */
	public token: HomeserverTokenConfig;

	public static codec = t.intersection([
		t.type({
			domain: t.string,
			url: t.string,
			token: HomeserverTokenConfig.codec,
		}),
		t.partial({
			base: t.string,
		}),
	]);

	constructor(init: t.TypeOf<typeof HomeserverConfig.codec>) {
		this.domain = init.domain;
		this.url = init.url;
		this.base = init.base ?? this.base;
		this.token = new HomeserverTokenConfig(init.token);
	}
}

/** Configuration of an individual stage */
export class StageConfig {
	/** A copy of the homeserver configuration */
	public homeserver: HomeserverConfig;
	[key: string]: unknown;

	public static codec = fromNullable(t.record(t.string, t.unknown), {});

	constructor(config: Record<string, unknown>, homeserver: HomeserverConfig) {
		Object.assign(this, config);
		this.homeserver = homeserver;
	}
}

/** Rate limiting settings */
export class RateLimitConfig {
	/** Whether rate limiting is enabled */
	public enabled: boolean = true;
	/** The windows in milliseconds in which hits should be grouped together */
	public windowMs: number = DEFAULT_RATE_LIMIT_WINDOW;
	/** The maximum number of hits in a window */
	public max: number = DEFAULT_RATE_LIMIT_MAX;

	public static codec = t.type({
		enabled: fromNullable(t.boolean, true),
		windowMs: fromNullable(t.number, DEFAULT_RATE_LIMIT_WINDOW),
		max: fromNullable(t.number, DEFAULT_RATE_LIMIT_MAX),
	})

	constructor(init?: t.TypeOf<typeof RateLimitConfig.codec>) {
		this.enabled = init?.enabled ?? this.enabled;
		this.windowMs = init?.windowMs ?? this.windowMs;
		this.max = init?.max ?? this.max;

	}
}

/** Full UIA configuration for an endpoint */
export class SingleUiaConfig {
	/** Rate limiting configuration for this endpoint */
	public rateLimit: RateLimitConfig = new RateLimitConfig();
	/** The stages configured for this endpoint */
	public stages: Record<string, StageConfig> = {};
	/** The flows available to this endpoint */
	public flows: FlowsConfig[] = [];

	public static codec = t.type({
		rateLimit: fromNullable(RateLimitConfig.codec, new RateLimitConfig()),
		stages: t.record(t.string, StageConfig.codec),
		flows: t.array(FlowsConfig.codec),
	})

	constructor(init: t.TypeOf<typeof SingleUiaConfig.codec>, homeserver: HomeserverConfig) {
		this.rateLimit = init.rateLimit ?? this.rateLimit;
		if (init.stages) {
			for (const [stage, config] of Object.entries(init.stages)) {
				this.stages[stage] = new StageConfig(config, homeserver)
			}
		}
		this.flows = init.flows ?? this.flows;
	}
}

/** UIA configuration for each endpoint */
export class UiaConfig {
	public login: SingleUiaConfig;
	public password: SingleUiaConfig;
	public deleteDevice: SingleUiaConfig;
	public deleteDevices: SingleUiaConfig;
	public uploadDeviceSigningKeys: SingleUiaConfig;

	public static codec = t.type({
		login: SingleUiaConfig.codec,
		password: SingleUiaConfig.codec,
		deleteDevice: SingleUiaConfig.codec,
		deleteDevices: SingleUiaConfig.codec,
		uploadDeviceSigningKeys: SingleUiaConfig.codec,
	})

	constructor(init: t.TypeOf<typeof UiaConfig.codec>, homeserver: HomeserverConfig) {
		this.login = new SingleUiaConfig(init.login, homeserver);
		this.password = new SingleUiaConfig(init.password, homeserver);
		this.deleteDevice = new SingleUiaConfig(init.deleteDevice, homeserver);
		this.deleteDevices = new SingleUiaConfig(init.deleteDevices, homeserver);
		this.uploadDeviceSigningKeys = new SingleUiaConfig(init.uploadDeviceSigningKeys, homeserver);
	}
}

export class Config {
	/** Logging configuration */
	public logging: LoggingConfig;
	/** Web server configuration */
	public webserver: WebserverConfig;
	/** Auth session configuration */
	public session: SessionConfig;
	/** Username mapper configuration */
	public usernameMapper: UsernameMapperConfig;
	/** Information about the proxied matrix homeserver */
	public homeserver: HomeserverConfig;
	/** UIA configurations for each endpoint */
	public uia: UiaConfig;

	static codec = t.type({
		logging: LoggingConfig.codec,
		webserver: WebserverConfig.codec,
		session: fromNullable(SessionConfig.codec, new SessionConfig({})),
		usernameMapper: UsernameMapperConfig.codec,
		homeserver: HomeserverConfig.codec,
		uia: UiaConfig.codec,
	});

	constructor(init: {
		logging: LoggingConfig;
		webserver: WebserverConfig;
		session: SessionConfig;
		usernameMapper: UsernameMapperConfig;
		homeserver: HomeserverConfig;
		uia: UiaConfig;
	}) {
		this.logging = init.logging;
		this.webserver = init.webserver;
		this.session = init.session;
		this.usernameMapper = init.usernameMapper;
		this.homeserver = init.homeserver;
		this.uia = init.uia;
	}

	/**
	 * Initializes a Config instance based on an unknown value
	 *
	 * @throws Error if the configuration is invalid, i.e. if it contains missing or wrongly typed keys
	 */
	public static from(init: unknown): Config {
		const decoded = tx.unwrap(this.codec.decode(init));
		const homeserver = new HomeserverConfig(decoded.homeserver);
		return new Config({
			logging: new LoggingConfig(decoded.logging),
			webserver: new WebserverConfig(decoded.webserver),
			session: new SessionConfig(decoded.session),
			usernameMapper: new UsernameMapperConfig(decoded.usernameMapper),
			homeserver,
			uia: new UiaConfig(decoded.uia, homeserver),
		});
	}
}
