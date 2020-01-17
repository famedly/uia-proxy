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
import { HomeserverConfig } from "./config";
import { Log } from "./log";
import * as jwt from "jsonwebtoken";
import * as request from "request-promise";

const log = new Log("Api");

const STATUS_OK = 200;
const STATUS_CREATED = 201;
const STATUS_BAD_REQUEST = 400;
const STATUS_UNAUTHORIZED = 401;
const STATUS_FORBIDDEN = 403;
const STATUS_NOT_FOUND = 404;
const STATUS_CONFLICT = 409;
const STATUS_INTERNAL_SERVER_ERROR = 500;

export class Api {
	constructor(
		private homeserverConfig: HomeserverConfig,
	) { }

	public async login(req: express.Request, res: express.Response) {
		log.info("Received login request");
		if (!req.session) {
			this.sendStatus(res, STATUS_BAD_REQUEST);
			res.json({
				errcode: "M_UNKNOWN",
				error: "No session",
			});
			return;
		}

		if (!req.session.data.username) {
			this.sendStatus(res, STATUS_BAD_REQUEST);
			res.json({
				errcode: "M_UNKNOWN",
				error: "No username found",
			});
			return;
		}

		log.verbose("Session seems valid, attempting login with matrix server...");
		try {
			const loginRes = await request({
				method: "POST",
				uri: this.homeserverConfig.url + "/_matrix/client/r0/login",
				json: {
					type: "com.famedly.login.token",
					identifier: {
						type: "m.id.user",
						user: req.session.data.username,
					},
					token: this.generateToken(req.session.data.username),
				},
			});
			log.info("Successfully logged in!");
			if (typeof loginRes === "string") {
				res.json(JSON.parse(loginRes));
			} else {
				res.json(loginRes);
			}
		} catch (err) {
			log.error("Couldn't reach matrix server!", err.error || err.body || err);
			res.json({
				errcode: "M_UNKNOWN",
				error: "Backend unreachable",
			});
			return;
		}
	}

	private generateToken(username: string): string {
		log.verbose(`Generating token for ${username}...`);
		return jwt.sign({
			iss: "Famedly Login Service",
			sub: username,
		}, this.homeserverConfig.token.secret, {
			algorithm: this.homeserverConfig.token.algorithm,
			expiresIn: this.homeserverConfig.token.expires / 1000, // tslint:disable-line no-magic-numbers
		});
	}

	private sendStatus(res: express.Response, status: number) {
		res.status(status);
		switch (status) {
			case STATUS_BAD_REQUEST:
				res.send("ERROR 400: Bad Request");
				break;
			case STATUS_UNAUTHORIZED:
				res.send("ERROR 401: Unauthorized");
				break;
			case STATUS_FORBIDDEN:
				res.send("ERROR 403: Forbidden");
				break;
			case STATUS_NOT_FOUND:
				res.send("ERROR 404: Not Found");
				break;
			case STATUS_CONFLICT:
				res.send("ERROR 409: Conflict");
				break;
			case STATUS_INTERNAL_SERVER_ERROR:
				res.send("ERROR 500: Internal Server Error");
				break;
		}
	}
}
