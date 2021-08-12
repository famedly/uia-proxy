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

import { IStage, ParamsData, AuthData, IAuthResponse, ensure_localpart } from "./stage";
import { tokens } from "../openid";
import { StageConfig } from "../config";

/** Matrix error code for valid but malformed JSON. */
const M_BAD_JSON = "M_BAD_JSON";
/** Matrix error code for uncategorized errors. */
const M_UNKNOWN = "M_UNKNOWN";

export class Stage implements IStage {
	public type: string = "com.famedly.login.sso";
	private config: StageConfig;

	public async init(config: StageConfig) {
		this.config = config;
	}

	/**
	 * Performs authentication by checking that the supplied token is in the set
	 * of valid tokens, and also checks that we're in the right UIA session if
	 * necessary.
	 */
	public async auth(data: AuthData, _params: ParamsData | null): Promise<IAuthResponse> {
		// Synapse is off-spec and puts the user in the root dict
		let user = data.user;
		if (!user) {
			// first we check if this is the correct identifier
			if (!data.identifier || data.identifier.type !== "m.id.user") {
				return {
					success: false,
					errcode: M_UNKNOWN,
					error: "Bad identifier type.",
				};
			}
			user = data.identifier.user;
		}
		const tokenId = data.token;
		// Make sure that username and token exist and are strings
		if (typeof user !== "string" || typeof tokenId !== "string") {
			return {
				success: false,
				errcode: M_BAD_JSON,
				error: "Missing username or login token",
			};
		}
		user = ensure_localpart(user, this.config.homeserver.domain);
		if (user === null) {
			return {
				success: false,
				errcode: M_UNKNOWN,
				error: "Bad user",
			}
		}
		const token = tokens.get(tokenId);
		let success = false;

		// tslint:disable-next-line label-position
		checkToken: {
			if (!token) {
				break checkToken;
			}
			if (token.uiaSession && token.uiaSession !== data.session) {
				break checkToken;
			}
			if (token.user !== user) {
				break checkToken;
			}
			success = true;
		}

		if (!success) {
			return {
				success: false,
				errcode: M_UNKNOWN,
				error: "Token login failed",
			};
		} else {
			tokens.delete(tokenId);
			return { success: true };
		}
	}
}
