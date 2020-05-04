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
import got from "got";

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
			this.sendStatus(res, STATUS_BAD_REQUEST, "M_UNKNOWN", "No session");
			return;
		}

		if (!req.session.data.username) {
			this.sendStatus(res, STATUS_BAD_REQUEST, "M_UNKNOWN", "No username found");
			return;
		}

		log.verbose("Session seems valid, attempting login with matrix server...");
		try {
			const loginRes = await got({
				method: "POST",
				url: this.homeserverConfig.url + "/_matrix/client/r0/login",
				json: {
					type: "com.famedly.login.token",
					identifier: {
						type: "m.id.user",
						user: req.session.data.username,
					},
					token: this.generateToken(req.session.data.username),
					device_id: (req.body && req.body.device_id) || undefined,
					initial_device_display_name: (req.body && req.body.initial_device_display_name) || undefined,
				},
			}).json();
			log.info("Successfully logged in!");
			res.json(loginRes);
		} catch (err) {
			log.error("Couldn't reach matrix server!", err.error || err.body || err);
			this.sendStatus(res, STATUS_INTERNAL_SERVER_ERROR, "M_UNKNOWN", "Backend unreachable");
			return;
		}
	}

	public async password(req: express.Request, res: express.Response) {
		log.info("Received password change request");
		if (!req.session) {
			this.sendStatus(res, STATUS_BAD_REQUEST, "M_UNKNOWN", "No session");
			return;
		}

		if (
			!req.session.data.username ||
			!req.session.data.password ||
			!req.session.data.passwordProvider ||
			!req.session.data.passwordProvider.changePassword
		) {
			this.sendStatus(res, STATUS_BAD_REQUEST, "M_UNKNOWN", "No username/password found or bad password provider");
			return;
		}

		if (!req.body.new_password) {
			this.sendStatus(res, STATUS_BAD_REQUEST, "M_UNKNOWN", "Missing required fields");
			return;
		}

		const ret = await req.session.data.passwordProvider.changePassword(
			req.session.data.username,
			req.session.data.password,
			req.body.new_password,
		);

		if (!ret) {
			this.sendStatus(res, STATUS_BAD_REQUEST, "M_UNKNOWN", "Couldn't change password");
			return;
		}
		res.json({});
	}

	public async deleteDevice(req: express.Request, res: express.Response) {
		log.info("Received delete device request");
		if (!req.session) {
			this.sendStatus(res, STATUS_BAD_REQUEST, "M_UNKNOWN", "No session");
			return;
		}
		if (!req.session.data.username) {
			this.sendStatus(res, STATUS_BAD_REQUEST, "M_UNKNOWN", "No username/password found or bad password provider");
			return;
		}
		try {
			const hsRes = await got({
				method: "DELETE",
				url: `${this.homeserverConfig.url}/_matrix/client/r0/devices/${encodeURIComponent(req.params.deviceId)}`,
				headers: {
					Authorization: `Bearer ${req.accessToken}`,
				},
				json: { auth: {
					type: "com.famedly.login.token",
					identifier: {
						type: "m.id.user",
						user: req.session.data.username,
					},
					user: req.session.data.username,
					token: this.generateToken(req.session.data.username),
				}},
			}).json();
			log.info("Successfully deleted device!");
			res.json(hsRes);
		} catch (err) {
			log.error("Couldn't reach matrix server!", (err.response && err.response.body) || err);
			this.sendStatus(res, STATUS_INTERNAL_SERVER_ERROR, "M_UNKNOWN", "Backend unreachable");
			return;
		}
	}

	public async deleteDevices(req: express.Request, res: express.Response) {
		log.info("Received delete devices request");
		if (!req.session) {
			this.sendStatus(res, STATUS_BAD_REQUEST, "M_UNKNOWN", "No session");
			return;
		}
		if (!req.session.data.username) {
			this.sendStatus(res, STATUS_BAD_REQUEST, "M_UNKNOWN", "No username/password found or bad password provider");
			return;
		}
		try {
			const hsRes = await got({
				method: "POST",
				url: this.homeserverConfig.url + "/_matrix/client/r0/delete_devices",
				headers: {
					Authorization: `Bearer ${req.accessToken}`,
				},
				json: {
					devices: req.body.devices,
					auth: {
						type: "com.famedly.login.token",
						identifier: {
							type: "m.id.user",
							user: req.session.data.username,
						},
						user: req.session.data.username,
						token: this.generateToken(req.session.data.username),
					},
				},
			}).json();
			log.info("Successfully deleted devices!");
			res.json(hsRes);
		} catch (err) {
			log.error("Couldn't reach matrix server!", (err.response && err.response.body) || err);
			this.sendStatus(res, STATUS_INTERNAL_SERVER_ERROR, "M_UNKNOWN", "Backend unreachable");
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

	private sendStatus(res: express.Response, status: number, errcode?: string, error?: string) {
		res.status(status);
		if (errcode && error) {
			res.json({ errcode, error });
		}
	}
}
