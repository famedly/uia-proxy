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
import { WebserverConfig } from "./config";
import { Session } from "./session";
import { Stagehandler } from "./stagehandler";

const log = new Log("Webserver");

const ENDPOINT_LOGIN = "login";
const ENDPOINT_REGISTER = "register";

const STATUS_BAD_REQUEST = 400;
const STATUS_UNAUTHORIZED = 401;

export class Webserver {
	private app: express.Application;
	constructor(
		private config: WebserverConfig,
		private session: Session,
		private stageHandler: StageHandler,
	) {
		this.app = express();
		this.app.use(bodyParser.json());
		this.app.use(this.validateJsonMiddleware);
		this.app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
			this.sessionMiddleware(ENDPOINT_LOGIN, req, res, next);
		});
	}

	public start() {
		this.app.
		this.app.listen(this.config.port, this.config.host, () => {
			log.info(`Webserver listening on ${this.config.host}:${this.config.port}`);
		});
	}

	private sessionMiddleware(endpoint: string, req: express.Request, res: express.Response, next: express.NextFunction) {
		if (req.body.auth && req.body.auth.session) {
			const sess = this.session.get(req.body.auth.session);
			if (!sess || sess.endpoint !== endpoint) {
				// session valid for other endpoint, return error
				res.status(STATUS_BAD_REQUEST);
				res.json({
					errcode: "M_UNRECOGNIZED",
					error: "Invalid session key",
				})
				return;
			}
			req.session = sess;
		} else {
			req.session = this.session.new(endpoint);
		}
		next();
	}

	private validateJsonMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
		if (req.method === "POST" && !(req.body instanceof Object)){
			res.status(STATUS_BAD_REQUEST);
			res.json({
				errcode: "M_NOT_JSON",
				error: "No JSON submitted",
			});
			return;
		}
		next();
	}
}
