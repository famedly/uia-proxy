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

import * as express from "express";
import * as bodyParser from "body-parser";
import { Log } from "./log";
import { WebserverConfig, UiaConfig } from "./config";
import { Session } from "./session";
import { StageHandler } from "./stagehandler";
import { Api } from "./api";

const log = new Log("Webserver");

const ENDPOINT_LOGIN = "/login";
const ENDPOINT_REGISTER = "/register";
const API_PREFIX = "/_matrix/client/r0";

const STATUS_BAD_REQUEST = 400;
const STATUS_UNAUTHORIZED = 401;
const STATUS_INTERNAL_SERVER_ERROR = 500;

export class Webserver {
	private app: express.Application;
	private stageHandlers: {[key: string]: StageHandler};
	constructor(
		private config: WebserverConfig,
		private uiaConfig: UiaConfig,
		private session: Session,
		private api: Api,
	) {
		this.stageHandlers = {};
		this.app = express();
		this.app.use(bodyParser.json());
		this.app.use(this.validateJsonMiddleware);
		this.app.use(this.addHeaders);
	}

	public async start() {
		// init the stage handlers
		this.stageHandlers.login = new StageHandler("login", this.uiaConfig.login);
		await this.stageHandlers.login.load();

		this.app.get(API_PREFIX + ENDPOINT_LOGIN,
			this.stageHandlers.login.get.bind(this.stageHandlers.login),
		);
		this.app.post(API_PREFIX + ENDPOINT_LOGIN,
			this.sessionMiddleware(ENDPOINT_LOGIN).bind(this),
			this.stageHandlers.login.middleware.bind(this.stageHandlers.login),
			this.callApi("login"),
		);
		this.app.listen(this.config.port, this.config.host, () => {
			log.info(`Webserver listening on ${this.config.host}:${this.config.port}`);
		});
	}

	private sessionMiddleware(endpoint: string): express.RequestHandler {
		return (req: express.Request, res: express.Response, next: express.NextFunction) => {
			log.debug("Running session middleware...");
			if (req.body.auth && req.body.auth.session) {
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

	private validateJsonMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
		if (["POST", "PUT", "PATCH"].includes(req.method) && !(req.body instanceof Object)) {
			res.status(STATUS_BAD_REQUEST);
			res.json({
				errcode: "M_NOT_JSON",
				error: "No JSON submitted",
			});
			return;
		}
		next();
	}

	private addHeaders(req: express.Request, res: express.Response, next: express.NextFunction) {
		res.header("Access-Control-Allow-Origin", "*");
		res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
		res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
		next();
	}

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
