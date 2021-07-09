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

import * as express from "express";
import * as bodyParser from "body-parser";
import { Log } from "./log";
import { WebserverConfig, HomeserverConfig, UiaConfig } from "./config";
import { Session } from "./session";
import { StageHandler } from "./stagehandler";
import { Api } from "./api";
import got from "got";
import * as middleware from "famedly-matrix-middleware";
import * as proxy from "express-http-proxy";
import * as ConnectSequence from "connect-sequence";

const log = new Log("Webserver");

const ENDPOINT_LOGIN = "/login";
const ENDPOINT_PASSWORD = "/account/password";
const ENDPOINT_REGISTER = "/register";
const API_PREFIXES = ["/_matrix/client/r0", "/_matrix/client/unstable"];

const STATUS_BAD_REQUEST = 400;
const STATUS_UNAUTHORIZED = 401;
const STATUS_FORBIDDEN = 403;
const STATUS_INTERNAL_SERVER_ERROR = 500;

interface ILoginReply {
	user_id?: string;
}

export class Webserver {
	/** The express application which handles routing */
	private app: express.Application;
	/** A map of endpoint names to their associated stage handler. */
	private stageHandlers: {[key: string]: StageHandler};
	constructor(
		/** Port and host address for the http server */
		private config: WebserverConfig,
		/** Information about the proxied matrix server */
		private homeserverConfig: HomeserverConfig,
		/** Configuration for UIA flows and stages. */
		private uiaConfig: UiaConfig,
		/** UIA session state */
		private session: Session,
		private api: Api,
	) {
		this.stageHandlers = {};
		this.app = express();
		this.app.use(bodyParser.json());
		this.app.use(middleware.parseAccessToken());
		this.app.use(middleware.validateJson());
		this.app.use(middleware.accessControlHeaders());
	}

	/** Initialize handlers and start the http server. */
	public async start() {
		// If you add a new path to proxy, don't forget to add the stage handler
		// in the config.ts
		const pathsToProxy = [
			{
				method: "delete",
				path: "/devices/:deviceId",
				handler: "deleteDevice",
			},
			{
				method: "post",
				path: "/delete_devices",
				handler: "deleteDevices",
			},
			{
				method: "post",
				path: "/keys/device_signing/upload",
				handler: "uploadDeviceSigningKeys",
			},
		];
		// init the stage handlers
		const allStageHandlers = ["login", "password"];
		for (const path of pathsToProxy) {
			allStageHandlers.push(path.handler);
		}
		for (const sh of allStageHandlers) {
			// This adds a new stage handler for every route. Either the configure `uia.default`
			// template from the config, or a specific one for the `pathsToProxy.handler`
			this.stageHandlers[sh] = new StageHandler(sh, this.uiaConfig[sh] || this.uiaConfig.default);
			await this.stageHandlers[sh].load();
		}

		for (const apiPrefix of API_PREFIXES) {
			this.app.get(apiPrefix + ENDPOINT_LOGIN,
				this.stageHandlers.login.get.bind(this.stageHandlers.login),
			);
			// login
			this.app.post(apiPrefix + ENDPOINT_LOGIN,
				this.middlewareStageHandler("login"),
				this.callApi("login"),
			);
			// password
			this.app.post(apiPrefix + ENDPOINT_PASSWORD,
				this.middlewareStageHandler("password", true),
				this.callApi("password"),
			);
			// device management
			this.app.get(apiPrefix + "/devices", proxy(this.homeserverConfig.url));
			this.app.get(`${apiPrefix}/devices/:deviceId`, proxy(this.homeserverConfig.url));
			this.app.put(`${apiPrefix}/devices/:deviceId`, proxy(this.homeserverConfig.url));

			// proxied endpoints
			for (const path of pathsToProxy) {
				this.app[path.method.toLowerCase()](apiPrefix + path.path,
					this.middlewareStageHandler(path.handler, true),
					this.callApi("proxyRequest"),
				);
			}
		}
		this.app.listen(this.config.port, this.config.host, () => {
			log.info(`Webserver listening on ${this.config.host}:${this.config.port}`);
		});
	}

	/**
	 * Middleware which adds the Session object for an ongoing UIA session to
	 * the request if `auth.session` in the JSON body of the request matches a
	 * known UIA session for the given endpoint, or generates a new session if
	 * no session id was provided in the request.
	 *
	 * @param endpoint - The endpoint which the matrix client is trying to access
	 */
	private sessionMiddleware(endpoint: string): express.RequestHandler {
		return (req: express.Request, res: express.Response, next: express.NextFunction) => {
			if (req.body && req.body.auth && req.body.auth.session) {
				const sess = this.session.get(req.body.auth.session);
				if (!sess || sess.endpoint !== endpoint) {
					// session valid for other endpoint, return error
					res.status(STATUS_BAD_REQUEST);
					res.json({
						errcode: "M_UNRECOGNIZED",
						error: "Invalid session key",
					});
					return;
				}
				log.debug("Using existing session");
				req.session = sess;
			} else {
				log.debug("Creating new session");
				req.session = this.session.new(endpoint);
			}
			next();
		};
	}

	/**
	 * Middleware which gates an endpoint behind UIA.
	 *
	 * @param sh - The name of the gated endpoint as written in the UIA config.
	 * @param requireToken - Whether the endpoint requires the matrix client to
	 * have an access token
	 */
	private middlewareStageHandler(sh: string, requireToken: boolean = false): express.RequestHandler {
		return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
			const seq = new ConnectSequence(req, res, next);
			seq.append(middleware.rateLimit((this.uiaConfig[sh] || this.uiaConfig.default).rateLimit));

			if (requireToken) {
				seq.append(middleware.requireAccessToken(this.homeserverConfig.url));
			}

			seq.append(
				this.sessionMiddleware(sh).bind(this),
				this.stageHandlers[sh].middleware.bind(this.stageHandlers[sh]),
			);
			seq.run();
		};
	}

	/** Calls a method on the Api class and catches errors. */
	private callApi(endpoint: string): express.RequestHandler {
		return async (req: express.Request, res: express.Response) => {
			try {
				await this.api[endpoint](req, res);
			} catch (err) {
				log.error(`Error handling endpoint ${endpoint}`, err);
				res.status(STATUS_INTERNAL_SERVER_ERROR);
				res.send("ERROR 500: Internal Server Error");
			}
		};
	}
}
