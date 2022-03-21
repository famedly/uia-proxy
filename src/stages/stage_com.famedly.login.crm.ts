/*
Copyright (C) 2022 Famedly

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

import { AuthData, IAuthResponse, IStage, IStageUiaProxyVars, ParamsData } from "./stage";
import { Log } from "../log";
import got from "got";
import * as jwt from "jsonwebtoken";
import { StageConfig } from "../config";

const log = new Log("Stage com.famedly.login.crm");

/** Configuration for the CRM authentication stage */
export interface ICrmConfig extends StageConfig {
	/** Base url of the CRM */
	url: string;
	/** The expected pharmacy ID */
	pharmacy_id: string;
}

/** Stored data about a key */
interface IJwk {
	/** The actual key data */
	key: string;
	/** The algorithm of the key */
	algorithm: jwt.Algorithm;
}

/** Async adapter for jwt.verify() */
async function verifyAsync(token: string, key: jwt.Secret | jwt.GetPublicKeyOrSecret , options: jwt.VerifyOptions): Promise<jwt.Jwt | string | jwt.JwtPayload> {
	return new Promise((resolve, reject) => jwt.verify(token, key, options, (err, payload) => {
		if (err) {
			reject(err)
		} else {
			resolve(payload!)
		}
	}))
};

function M_NOT_JSON(error: string): IAuthResponse {
	return {
		success: false,
		error,
		errcode: "M_NOT_JSON",
	}
}

function M_BAD_JSON(error: string): IAuthResponse {
	return {
		success: false,
		error,
		errcode: "M_BAD_JSON",
	};
}

function M_UNAUTHORIZED(error: string): IAuthResponse {
	return {
		success: false,
		error,
		errcode: "M_UNAUTHORIZED",
	}
}

export class Stage implements IStage {
	public type: string = "com.famedly.login.crm";
	private key: IJwk | undefined;
	private config: ICrmConfig;

	public async init(config: ICrmConfig, _vars?: IStageUiaProxyVars) {
		this.config = config;
	}

	private async update_key() {
		const keyResponse = await got(new URL('jwt-key', this.config.url));
		const algResponse = await got(new URL('jwt-algorithm', this.config.url));
		this.key = {
			key: keyResponse.body,
			algorithm: algResponse.body as jwt.Algorithm,
		}
	}

	public async auth(data: AuthData, _params: ParamsData | null): Promise<IAuthResponse> {
		log.info("Performing CRM login");
		if (typeof data.token !== "string") {
			return M_BAD_JSON("CRM token missing");
		}
		// Check that we have a key
		if (!this.key) {
			log.debug("Fetching key");
			await this.update_key();
		}

		let token: jwt.JwtPayload | undefined;
		let keysUpdated = false;
		// Try verifying the token. if it fails refresh the key from the server and try again
		while (true) {
			try {
				const payload = await verifyAsync(data.token, this.key!.key, {algorithms: [this.key!.algorithm]});
				if (typeof payload === "string") {
					return M_NOT_JSON("CRM token payload was not valid JSON");
				}
				log.debug("Token payload validated");
				// We can coerce since by default only the payload is returned
				token = payload as jwt.JwtPayload;
				break;
			} catch (err) {
				if (err instanceof jwt.JsonWebTokenError && !keysUpdated) {
					log.debug("Validation failed, refreshing key");
					await this.update_key();
					keysUpdated = true;
					continue;
				} else {
					return M_UNAUTHORIZED(err.message);
				}
			}
		}
		// Assert the token has the right claims
		if (token.pharmacy_id !== this.config.pharmacy_id) {
			log.info(`Token was for pharmacy id '${token.pharmacy_id}', expected '${this.config.pharmacy_id}'`);
			return M_UNAUTHORIZED("Token is for a different pharmacy");
		}

		log.debug("login succeded");
		return {
			success: true,
			data: {
				username: token.sub,
				displayname: token.name,
				admin: token.pharmacy_admin,
			}
		}
	}
}
